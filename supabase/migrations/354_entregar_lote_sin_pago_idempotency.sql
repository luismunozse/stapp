-- ============================================================================
-- 354: entregar_lote_recepcion sin pago_idempotency + fecha_completado
-- ============================================================================
-- CREATE OR REPLACE de entregar_lote_recepcion (353) con la MISMA firma. Parte
-- del cuerpo que esta en produccion y cambia dos cosas, nada mas:
--
-- 1. IDEMPOTENCIA. 353 le pasaba a registrar_cobros_orden_atomica la clave
--    p_idempotency_key || ':' || orden. Esa funcion (242/269) hace
--    INSERT INTO pago_idempotency cuando la clave no es NULL, y esa tabla NO
--    existe en produccion: toda entrega de lote con clave fallaba con
--    "relation pago_idempotency does not exist" (el dialogo siempre manda una
--    clave). Ahora se llama SIEMPRE con clave NULL. No se crea ni se toca
--    pago_idempotency (otro flujo depende de que siga ausente).
--    El parametro p_idempotency_key se conserva en la firma por compatibilidad
--    con la ruta y con 353, pero hoy NO SE USA. La proteccion ante un reintento
--    sigue siendo el guard por orden: una segunda llamada encuentra las
--    ordenes en ENTREGADO, falla con LOTE_ERROR:ORDEN_NO_REPARADA y, al ser
--    una sola transaccion, no escribe nada.
--
-- 2. FECHA_COMPLETADO. Al pasar cada orden a ENTREGADO se escribe
--    fecha_completado = COALESCE(fecha_completado, NOW()), igual que
--    POST /api/ordenes/[id]/entregar desde #399. Sin esto, una orden que llego
--    a REPARADO sin que nadie seteara fecha_completado queda fuera de los
--    reportes de resultados y de comisiones. No pisa el devengo original.
--
-- YA APLICADA EN PRODUCCION (2026-10-12) bajo el numero 353; se renumero a
-- 354 al mergear porque 351 lo tomo otra migracion de main.
--
-- Sin BEGIN/COMMIT propios (ver nota de 353 sobre la ventana de 40 lineas de
-- scripts/db-run.mjs): el runner decide la transaccion y el dry-run revierte.
-- Permisos, comentario y resto del cuerpo: identicos a 353.
--
-- rollback: supabase/migrations/rollback/354_rollback.sql (restaura el cuerpo de 353)
-- verify:   supabase/migrations/verify/354_probes.sql
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
        NULL  -- ver nota IDEMPOTENCIA del header de 354
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
          fecha_completado = COALESCE(fecha_completado, NOW()),
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

-- Invocable solo por service_role: la funcion cobra dinero y cambia el estado
-- de ordenes, y PostgREST expone por defecto toda funcion de public a anon y
-- authenticated. Mismo hardening que 353 (REVOKE de PUBLIC, anon y
-- authenticated; GRANT solo a service_role).
REVOKE EXECUTE ON FUNCTION entregar_lote_recepcion(TEXT,TEXT,TEXT,JSONB,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION entregar_lote_recepcion(TEXT,TEXT,TEXT,JSONB,TEXT,TEXT,TEXT,TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION entregar_lote_recepcion(TEXT,TEXT,TEXT,JSONB,TEXT,TEXT,TEXT,TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION entregar_lote_recepcion(TEXT,TEXT,TEXT,JSONB,TEXT,TEXT,TEXT,TEXT) TO service_role;
