-- ============================================================================
-- 290: entrega atomica de lote (recepcion multiple)
-- ============================================================================
-- Transiciona todas las ordenes REPARADO -> ENTREGADO de una recepcion y
-- registra el cobro prorateado (calculado app-side por lib/lote-utils) en
-- UNA sola transaccion. O se entrega y cobra el lote completo, o no se
-- mueve nada.
--
-- El UPDATE sobre ordenes_servicio replica exactamente las columnas que
-- escribe POST /api/ordenes/[id]/entregar (app/api/ordenes/[id]/entregar/route.ts)
-- en el camino simple REPARADO -> ENTREGADO, verificado linea por linea:
--   - estado                       (route.ts:132, nuevoEstado)
--   - fecha_entrega                (route.ts:133, siempre se pisa con NOW())
--   - costo_final                  (route.ts:134, solo si hay total confirmado)
--   - firma_cliente_entrega(+mime) (route.ts:135-136, siempre se fuerza a NULL
--                                    si no viene del body — el lote no captura
--                                    firma por equipo, asi que siempre es NULL)
--   - firma_encargado_entrega(+mime) (route.ts:137-138, misma logica)
--   - entregado_por_user_id        (route.ts:139)
--   - motivo_sin_cobro             (route.ts:141, NULL en el camino con cobro)
-- `notas_entrega` (route.ts:140) NO se replica: el body de la ruta original
-- lo asigna sin fallback (`data.notasEntrega`), asi que si no viene en el
-- request el campo queda SIN TOCAR (JSON.stringify descarta claves
-- `undefined`). El payload de este RPC no trae una nota por orden, asi que
-- "no tocar la columna" es el mirror correcto — no hay equivalente a NULL
-- forzado como con las firmas.
-- `updated_at` NO existe en ordenes_servicio (confirmado en
-- 179_backfill_fecha_completado.sql: "ordenes_servicio no tiene updated_at").
--
-- Ademas del UPDATE, route.ts:153-170 inserta en orden_eventos (fire-and-forget
-- en la ruta HTTP) para el timeline publico; ese insert SI se replica aca
-- (Step 1 lo identifico como "estado-history insert"), pero de forma atomica
-- (si falla, aborta todo el lote — mas estricto que el fire-and-forget de la
-- ruta HTTP, aceptable porque en este RPC nunca deberia fallar: mismos valores
-- fijos siempre validos).
--
-- fecha_completado NO la escribe /entregar: la escribe el PUT generico
-- (app/api/ordenes/[id]/route.ts:309-312) la primera vez que la orden llega a
-- REPARADO o a un estado ENTREGADO*, guardado con `!orden.fecha_completado`.
-- Como esta funcion exige estado REPARADO de origen, fecha_completado ya
-- deberia estar seteada. Igual se refuerza con COALESCE(fecha_completado, NOW())
-- como red de seguridad — mismo criterio que el backfill de la migracion 179 —
-- para no dejar ordenes entregadas sin fecha_completado si alguna vía atípica
-- (ej. un update masivo) dejó el REPARADO sin pasar por esa ruta.
--
-- Fuera de alcance de este RPC (se resuelven en la ruta HTTP de Tarea 6, igual
-- que ya hace /entregar con sus propios efectos "best effort"): garantia
-- (requiere diasGarantia, que no forma parte del payload de lote), debito a
-- cuenta corriente por saldo pendiente, consumo de stock reservado
-- (consumir_reservas_orden), auditoria (audit.update) y notificaciones. Todos
-- esos side effects ya son best-effort/no bloqueantes en la ruta original;
-- replicarlos aca adentro de una transaccion atomica los volveria bloqueantes
-- para las N ordenes del lote, cambiando su semantica actual.
--
-- registrar_cobros_orden_atomica (242_cobros_orden_atomico.sql) NO tiene
-- SECURITY DEFINER, ni tampoco crear_recepcion_multiple (288). Esta funcion
-- sigue esa misma convencion (se omite SECURITY DEFINER del template de la
-- tarea): agregarlo sin `SET search_path` es un antipatron de seguridad
-- conocido (schema injection), y el service role ya bypassea RLS, asi que no
-- aporta nada en este flujo.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION entregar_lote_recepcion(
  p_organization_id TEXT,
  p_recepcion_id    TEXT,
  p_usuario_id      TEXT,
  p_ordenes         JSONB,   -- [{"id": text, "costoFinal": numeric, "montoCobro": numeric}]
  p_metodo_pago     TEXT,
  p_referencia      TEXT DEFAULT NULL,
  p_observaciones   TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_item        JSONB;
  v_orden       RECORD;
  v_costo_final NUMERIC;
  v_monto       NUMERIC;
  v_entregadas  JSONB := '[]'::jsonb;
  v_pendientes  INTEGER;
BEGIN
  PERFORM 1 FROM recepciones
    WHERE id = p_recepcion_id AND organization_id = p_organization_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'LOTE_ERROR:RECEPCION_NOT_FOUND';
  END IF;

  IF p_ordenes IS NULL OR jsonb_array_length(p_ordenes) = 0 THEN
    RAISE EXCEPTION 'LOTE_ERROR:SIN_ORDENES';
  END IF;

  -- Toda orden miembro no entregada tiene que venir en el payload.
  SELECT COUNT(*) INTO v_pendientes
    FROM ordenes_servicio o
    WHERE o.recepcion_id = p_recepcion_id
      AND o.organization_id = p_organization_id
      AND o.estado NOT IN ('ENTREGADO','ENTREGADO_SIN_REPARACION','ENTREGADO_SIN_COBRO','CANCELADO')
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_ordenes) e WHERE e->>'id' = o.id
      );
  IF v_pendientes > 0 THEN
    RAISE EXCEPTION 'LOTE_ERROR:LOTE_INCOMPLETO';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_ordenes) LOOP
    SELECT * INTO v_orden FROM ordenes_servicio
      WHERE id = v_item->>'id'
        AND organization_id = p_organization_id
        AND recepcion_id = p_recepcion_id
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'LOTE_ERROR:ORDEN_FUERA_DE_LOTE:%', v_item->>'id';
    END IF;
    IF v_orden.estado <> 'REPARADO' THEN
      RAISE EXCEPTION 'LOTE_ERROR:ORDEN_NO_REPARADA:%:%', v_orden.id, v_orden.estado;
    END IF;

    -- NULL-safety: costoFinal es obligatorio en el payload (Tarea 6 lo valida
    -- con zod `.number().min(0)`), pero un NULL aca no debe pisar en silencio
    -- el costo_final existente de la orden (columna financiera) — se rechaza
    -- explicitamente en vez de dejar pasar `costo_final = NULL`.
    v_costo_final := (v_item->>'costoFinal')::numeric;
    IF v_costo_final IS NULL OR v_costo_final < 0 THEN
      RAISE EXCEPTION 'LOTE_ERROR:COSTO_FINAL_INVALIDO:%', v_orden.id;
    END IF;

    -- Mirror de las columnas que escribe POST /api/ordenes/[id]/entregar en
    -- el camino REPARADO -> ENTREGADO con cobro (ver header de este archivo).
    UPDATE ordenes_servicio
      SET estado = 'ENTREGADO',
          fecha_entrega = NOW(),
          fecha_completado = COALESCE(fecha_completado, NOW()),
          costo_final = v_costo_final,
          entregado_por_user_id = p_usuario_id,
          firma_cliente_entrega = NULL,
          firma_cliente_entrega_mime = NULL,
          firma_encargado_entrega = NULL,
          firma_encargado_entrega_mime = NULL,
          motivo_sin_cobro = NULL
      WHERE id = v_orden.id;

    -- Mirror del insert a orden_eventos que hace la ruta HTTP para el
    -- timeline publico (route.ts:153-170), version atomica.
    INSERT INTO orden_eventos (
      orden_id, organization_id, tipo, estado_anterior, estado_nuevo, descripcion, created_by
    ) VALUES (
      v_orden.id, p_organization_id, 'CAMBIO_ESTADO', v_orden.estado::text, 'ENTREGADO',
      'Estado cambiado de ' || v_orden.estado::text || ' a ENTREGADO (entrega en lote)',
      p_usuario_id
    );

    -- NULL-safety: si montoCobro no viene en el item, tratarlo como "no cobrar
    -- nada de esta orden ahora" (0) en vez de dejar que `NULL > 0` se evalue
    -- como falso de forma implicita. Tambien se rechaza un monto negativo.
    v_monto := COALESCE((v_item->>'montoCobro')::numeric, 0);
    IF v_monto < 0 THEN
      RAISE EXCEPTION 'LOTE_ERROR:MONTO_COBRO_INVALIDO:%', v_orden.id;
    END IF;

    IF v_monto > 0 THEN
      PERFORM registrar_cobros_orden_atomica(
        p_organization_id,
        v_orden.id,
        p_usuario_id,
        jsonb_build_array(jsonb_build_object(
          'monto', v_monto,
          'metodo', p_metodo_pago,
          'referencia', p_referencia
        )),
        p_observaciones,
        NULL,
        CASE WHEN p_idempotency_key IS NULL THEN NULL
             ELSE p_idempotency_key || ':' || v_orden.id END
      );
    END IF;

    v_entregadas := v_entregadas || jsonb_build_object(
      'id', v_orden.id, 'numeroOrden', v_orden.numero_orden, 'montoCobrado', v_monto
    );
  END LOOP;

  RETURN jsonb_build_object('recepcionId', p_recepcion_id, 'ordenes', v_entregadas);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION entregar_lote_recepcion(TEXT,TEXT,TEXT,JSONB,TEXT,TEXT,TEXT,TEXT) IS
  'Entrega atomica de todas las ordenes REPARADO de una recepcion multiple, '
  'con cobro prorateado por orden via registrar_cobros_orden_atomica (242). '
  'Columnas de ordenes_servicio espejadas de POST /api/ordenes/[id]/entregar '
  '(camino REPARADO->ENTREGADO con cobro). Excepciones con prefijo '
  'LOTE_ERROR: para que la ruta HTTP (Tarea 6) las mapee a status codes. '
  'Migracion 290.';

COMMIT;
