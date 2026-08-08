-- ============================================================================
-- 294: entrega atomica de lote (recepcion multiple)
-- ============================================================================
-- Transiciona todas las ordenes REPARADO -> ENTREGADO de una recepcion y
-- registra el cobro prorateado (calculado app-side por lib/lote-utils) en
-- UNA sola transaccion. O se entrega y cobra el lote completo, o no se
-- mueve nada.
--
-- SIN BEGIN/COMMIT propio a proposito. scripts/db-run.mjs detecta si un
-- archivo "trae su propia transaccion" con
-- `/^\s*BEGIN\s*;/im.test(sql.split("\n").slice(0, 40).join("\n"))` — solo
-- mira las primeras 40 LINEAS. Un header largo (como el de este archivo)
-- empuja un `BEGIN;` de apertura mas alla de esa ventana: el script no lo
-- detecta, abre su propia transaccion de dry-run, el `BEGIN;` del archivo
-- queda anidado (Postgres NO crea subtransacciones, sigue en la misma
-- transaccion externa) y el `COMMIT;` del archivo termina confirmando esa
-- transaccion externa — un dry-run sin --apply aplicaria el cambio de
-- verdad. Se leyo el runner completo (existe en la rama
-- feat/servicios-en-ordenes, commit 74aa49e9, no en esta) para confirmar
-- este comportamiento exacto antes de decidir sacar el wrapper. Mismo
-- criterio que `288_crear_recepcion_multiple.sql` (tampoco lo usa):
-- CREATE OR REPLACE FUNCTION, COMMENT ON FUNCTION y los REVOKE/GRANT de
-- abajo son cada uno una sentencia atomica de por si; no necesitan una
-- transaccion explicita, y asi el runner decide la ejecucion.
--
-- rollback: DROP FUNCTION entregar_lote_recepcion(TEXT,TEXT,TEXT,JSONB,TEXT,TEXT,TEXT,TEXT);
--
-- El UPDATE sobre ordenes_servicio replica exactamente las columnas que
-- escribe POST /api/ordenes/[id]/entregar (app/api/ordenes/[id]/entregar/route.ts)
-- en el camino simple REPARADO -> ENTREGADO, verificado linea por linea:
--   - estado                       (route.ts:132, nuevoEstado)
--   - fecha_entrega                (route.ts:133, siempre se pisa con NOW())
--   - costo_final                  (route.ts:134, solo si hay total confirmado;
--                                    redondeado a 2 decimales como hace la ruta)
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
-- "no tocar la columna" es el mirror correcto.
-- `fecha_completado` NO se escribe: /entregar nunca la toca. La escribe el
-- PUT generico (app/api/ordenes/[id]/route.ts:309-312) la primera vez que la
-- orden llega a REPARADO o a un estado ENTREGADO*, guardado con
-- `!orden.fecha_completado`. Como esta funcion exige estado REPARADO de
-- origen, fecha_completado ya deberia estar seteada por esa via.
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
-- Fuera de alcance de este RPC (se resuelven en la ruta HTTP de Tarea 6, igual
-- que ya hace /entregar con sus propios efectos "best effort"): garantia
-- (requiere diasGarantia, que no forma parte del payload de lote), debito a
-- cuenta corriente por saldo pendiente, consumo de stock reservado
-- (consumir_reservas_orden), auditoria (audit.update) y notificaciones. Todos
-- esos side effects ya son best-effort/no bloqueantes en la ruta original;
-- replicarlos aca adentro de una transaccion atomica los volveria bloqueantes
-- para las N ordenes del lote, cambiando su semantica actual.
--
-- DESCUENTO POR ORDEN: costo_final se escribe siempre entero (el total real
-- del equipo), pero solo se cobra el share prorateado (montoCobro, ya neto
-- del descuento de lote). La diferencia (costoFinal - montoCobro) se pasa
-- como p_descuento a registrar_cobros_orden_atomica para que quede como
-- descuento_cobro de ESA orden — si no, recalcular_estado_cobro ve
-- pendiente = costo_final - 0 - montoCobro > 0 y la orden queda PARCIAL para
-- siempre con un saldo fantasma que ademas alimenta las pantallas de deuda de
-- cliente (migracion 273). Se llama a registrar_cobros_orden_atomica SIEMPRE,
-- incluso con montoCobro = 0 (orden 100% bonificada por el descuento del
-- lote): 242 soporta p_pagos vacio ('[]'::jsonb) sin error — el loop de pagos
-- simplemente no itera y el SUM de validacion usa COALESCE(...,0) — asi que
-- ese caso solo aplica el descuento_cobro completo y recalcula el estado de
-- cobro, sin insertar ningun cobro. Confirmado leyendo 242 completo antes de
-- decidir esto (no hizo falta escribir descuento_cobro a mano).
--
-- SEÑAS/PAGOS PREVIOS: si una orden del lote ya tiene un cobro parcial previo
-- (deposito tomado antes de entrar al lote), el pendiente real es menor al
-- costo_final y el share prorateado (calculado sobre el costo_final completo)
-- puede superarlo. 242 lo detecta y hace
-- `RAISE EXCEPTION 'El monto total (%) excede el pendiente (%)'` (mensaje
-- plano, sin prefijo LOTE_ERROR:), lo que abortaria el lote entero con un 500
-- generico e inmapeable para la Tarea 6. Se envuelve el PERFORM en un bloque
-- BEGIN/EXCEPTION que reconoce ese mensaje puntual y lo relanza como
-- LOTE_ERROR:COBRO_EXCEDE_PENDIENTE:<id> (409 mapeable); cualquier otra
-- excepcion se re-lanza sin tocar. En v1, un lote con una orden que ya tiene
-- seña queda sin soportar: el operador recibe un error accionable y entrega
-- esa orden individualmente por /api/ordenes/[id]/entregar.
--
-- ORDEN DE LAS OPERACIONES (invariante, no reordenar): dentro del loop, cada
-- orden se cobra ANTES de que su estado pase a ENTREGADO.
--   1. UPDATE costo_final           (la orden sigue en REPARADO)
--   2. PERFORM registrar_cobros_orden_atomica
--   3. UPDATE estado = 'ENTREGADO' + fecha_entrega + resto de columnas
--   4. INSERT orden_eventos
-- El paso 6 de 242 (fiado) acredita el cobro no-CC a la cuenta corriente del
-- cliente si `v_orden.estado IN ('ENTREGADO','ENTREGADO_SIN_REPARACION')` —
-- y 242 lee ese estado de la fila EN LA MISMA TRANSACCION (paso 1, SELECT ...
-- FOR UPDATE). En el flujo de una sola orden eso esta balanceado por el CARGO
-- previo que deja el debito a cuenta corriente de la ruta HTTP; el lote NUNCA
-- emite ese cargo, asi que si la orden ya estuviera en ENTREGADO al cobrar, el
-- cliente terminaria con un saldo a favor fantasma por el total del lote. Con
-- estado 'REPARADO' la condicion del paso 6 es falsa y el fiado ni se evalua.
--
-- registrar_cobros_orden_atomica (242_cobros_orden_atomico.sql) NO tiene
-- SECURITY DEFINER, ni tampoco crear_recepcion_multiple (288). Esta funcion
-- sigue esa misma convencion: agregarlo sin `SET search_path` es un
-- antipatron de seguridad conocido (schema injection), y el service role ya
-- bypassea RLS, asi que no aporta nada en este flujo.
--
-- HARDENING: PostgREST expone toda funcion en `public` con GRANT EXECUTE a
-- `anon`/`authenticated` por default. Esta funcion cobra dinero y cambia
-- estado de ordenes — invocable directo con la anon key (viaja en el bundle
-- del browser) o con un JWT de cualquier usuario autenticado seria un agujero
-- serio. Mismo patron que `267_deuda_cliente_sucursal_rpc.sql` (REVOKE de
-- PUBLIC + anon + authenticated, GRANT solo a service_role).
-- ============================================================================

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
  v_descuento   NUMERIC;
  v_pagos       JSONB;
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

  -- Toda orden miembro ELEGIBLE (no excluida del lote) tiene que venir en el
  -- payload. La lista NOT IN espeja ESTADOS_EXCLUIDOS_LOTE de lib/lote-estados.ts:
  -- las entregadas ya salieron por su propio flujo, y CANCELADO /
  -- SIN_REPARACION / SIN_FALLA_DETECTADA quedaron cerradas sin entrega con
  -- cobro. Ninguna de ellas se exige aca, y si igual llegara en el payload el
  -- guard por orden (ORDEN_NO_REPARADA) la rechaza.
  SELECT COUNT(*) INTO v_pendientes
    FROM ordenes_servicio o
    WHERE o.recepcion_id = p_recepcion_id
      AND o.organization_id = p_organization_id
      AND o.estado NOT IN (
        'ENTREGADO','ENTREGADO_SIN_REPARACION','ENTREGADO_SIN_COBRO',
        'CANCELADO','SIN_REPARACION','SIN_FALLA_DETECTADA'
      )
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
    -- IS DISTINCT FROM (no <>): un estado NULL debe rechazar la entrega, no
    -- colarse. `NULL <> 'REPARADO'` evalua a NULL, y plpgsql trata un IF con
    -- condicion NULL como falso — dejaria pasar una fila con estado NULL sin
    -- levantar la excepcion.
    IF v_orden.estado IS DISTINCT FROM 'REPARADO' THEN
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
    -- Redondeo a 2 decimales, mismo criterio que route.ts:126 aplica sobre
    -- costoFinalConfirmado antes de persistirlo.
    v_costo_final := ROUND(v_costo_final, 2);

    -- PASO 1 — costo_final ANTES del cobro: registrar_cobros_orden_atomica
    -- valida el monto contra `costo_final - descuento_cobro - total_cobrado`
    -- (242, paso 2), asi que la columna tiene que tener ya el costo confirmado
    -- del lote. El estado sigue siendo REPARADO a proposito (ver PASO 3).
    UPDATE ordenes_servicio
      SET costo_final = v_costo_final
      WHERE id = v_orden.id;

    -- NULL-safety: si montoCobro no viene en el item, tratarlo como "no cobrar
    -- nada de esta orden ahora" (0) en vez de dejar que `NULL > 0` se evalue
    -- como falso de forma implicita. Tambien se rechaza un monto negativo, y
    -- se redondea por la misma razon que costo_final.
    v_monto := COALESCE((v_item->>'montoCobro')::numeric, 0);
    IF v_monto < 0 THEN
      RAISE EXCEPTION 'LOTE_ERROR:MONTO_COBRO_INVALIDO:%', v_orden.id;
    END IF;
    v_monto := ROUND(v_monto, 2);

    -- Descuento de lote que le toca a ESTA orden: la diferencia entre su
    -- costo real y lo que efectivamente se cobra ahora. GREATEST(...,0) es
    -- una red de seguridad — el invariante de prorrateo (share_i <= costoFinal_i,
    -- porque totalCobrado <= subtotal por construccion de calcularTotalLote)
    -- ya garantiza que nunca deberia ser negativo.
    v_descuento := GREATEST(ROUND(v_costo_final - v_monto, 2), 0);

    v_pagos := CASE WHEN v_monto > 0
      THEN jsonb_build_array(jsonb_build_object(
        'monto', v_monto, 'metodo', p_metodo_pago, 'referencia', p_referencia
      ))
      ELSE '[]'::jsonb
    END;

    -- PASO 2 — cobrar CON LA ORDEN TODAVIA EN 'REPARADO'.
    -- Se llama siempre (incluso con v_pagos vacio): es la unica via que deja
    -- descuento_cobro y estado_cobro consistentes con lo que se acaba de
    -- cobrar (ver nota "DESCUENTO POR ORDEN" arriba).
    BEGIN
      PERFORM registrar_cobros_orden_atomica(
        p_organization_id,
        v_orden.id,
        p_usuario_id,
        v_pagos,
        p_observaciones,
        v_descuento,
        CASE WHEN p_idempotency_key IS NULL THEN NULL
             ELSE p_idempotency_key || ':' || v_orden.id END
      );
    EXCEPTION
      WHEN raise_exception THEN
        -- Mapear el unico error de negocio de 242 que puede disparar una
        -- orden con seña previa (ver nota "SEÑAS/PAGOS PREVIOS" arriba) a un
        -- codigo LOTE_ERROR: mapeable; cualquier otra excepcion se relanza tal cual.
        IF SQLERRM LIKE 'El monto total%excede el pendiente%' THEN
          RAISE EXCEPTION 'LOTE_ERROR:COBRO_EXCEDE_PENDIENTE:%', v_orden.id;
        ELSE
          RAISE;
        END IF;
    END;

    -- PASO 3 — recien ahora el estado pasa a ENTREGADO, dentro de la MISMA
    -- transaccion. Ver nota "ORDEN DE LAS OPERACIONES" en el header: hacerlo
    -- antes del PASO 2 dispara el paso 6 de 242 (fiado) y le acredita al
    -- cliente el cobro completo como saldo a favor.
    -- Mirror de las columnas que escribe POST /api/ordenes/[id]/entregar en
    -- el camino REPARADO -> ENTREGADO con cobro (ver header de este archivo).
    UPDATE ordenes_servicio
      SET estado = 'ENTREGADO',
          fecha_entrega = NOW(),
          entregado_por_user_id = p_usuario_id,
          firma_cliente_entrega = NULL,
          firma_cliente_entrega_mime = NULL,
          firma_encargado_entrega = NULL,
          firma_encargado_entrega_mime = NULL,
          motivo_sin_cobro = NULL
      WHERE id = v_orden.id;

    -- PASO 4 — mirror del insert a orden_eventos que hace la ruta HTTP para el
    -- timeline publico (route.ts:153-170), version atomica. v_orden.estado es
    -- la foto previa al PASO 3 ('REPARADO'), que es justo el estado anterior
    -- que corresponde registrar.
    INSERT INTO orden_eventos (
      orden_id, organization_id, tipo, estado_anterior, estado_nuevo, descripcion, created_by
    ) VALUES (
      v_orden.id, p_organization_id, 'CAMBIO_ESTADO', v_orden.estado::text, 'ENTREGADO',
      'Estado cambiado de ' || v_orden.estado::text || ' a ENTREGADO (entrega en lote)',
      p_usuario_id
    );

    v_entregadas := v_entregadas || jsonb_build_object(
      'id', v_orden.id, 'numeroOrden', v_orden.numero_orden, 'montoCobrado', v_monto
    );
  END LOOP;

  RETURN jsonb_build_object('recepcionId', p_recepcion_id, 'ordenes', v_entregadas);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION entregar_lote_recepcion(TEXT,TEXT,TEXT,JSONB,TEXT,TEXT,TEXT,TEXT) IS
  'Entrega atomica de todas las ordenes REPARADO de una recepcion multiple, '
  'con descuento y cobro prorateado por orden via registrar_cobros_orden_atomica '
  '(242). Columnas de ordenes_servicio espejadas de POST /api/ordenes/[id]/entregar '
  '(camino REPARADO->ENTREGADO con cobro). Excepciones con prefijo '
  'LOTE_ERROR: para que la ruta HTTP (Tarea 6) las mapee a status codes. '
  'Migracion 290.';

-- Invocable solo por service_role — ver nota HARDENING arriba.
REVOKE EXECUTE ON FUNCTION entregar_lote_recepcion(TEXT,TEXT,TEXT,JSONB,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION entregar_lote_recepcion(TEXT,TEXT,TEXT,JSONB,TEXT,TEXT,TEXT,TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION entregar_lote_recepcion(TEXT,TEXT,TEXT,JSONB,TEXT,TEXT,TEXT,TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION entregar_lote_recepcion(TEXT,TEXT,TEXT,JSONB,TEXT,TEXT,TEXT,TEXT) TO service_role;
