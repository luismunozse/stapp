-- ============================================================================
-- 328 · BACKFILL: crear el CARGO faltante de ordenes entregadas con saldo
-- ============================================================================
-- CORRER PRIMERO 328_auditoria_cc_ordenes_sin_cargo.sql Y REVISAR LA SALIDA.
--
-- QUE ARREGLA
--
-- Una orden entregada con saldo pendiente deberia tener su deuda en la cuenta
-- corriente del cliente. `entregar` crea ese CARGO SOLO en el instante de la
-- entrega, y solo si en ese momento el pendiente era > 0. Si el costo_final
-- estaba vacio al entregar y se cargo despues, el CARGO nunca se crea y nada
-- posterior lo genera.
--
-- Efecto para el taller: la deuda SE SIGUE VIENDO (la lista de clientes y el
-- recordatorio de pago la calculan desde la orden, no desde el libro — ver
-- mig 318). Lo que queda mal es el RESUMEN DE CUENTA del cliente y el
-- clientes.saldo_cuenta: les falta esa deuda.
--
-- QUE NO CAMBIA
--
-- El total que el cliente debe. La mig 318 excluye de deuda_ordenes cualquier
-- orden que ya tenga CARGO, asi que la deuda se MUEVE de "contada por la orden"
-- a "contada por el libro". La suma queda igual.
--
-- DIFERENCIA CON LA MIG 236 (backfill anterior, mismo criterio)
--
-- La 236 NO escribia sucursal_id en el CARGO. get_deuda_cliente_sucursal filtra
-- `(p_sucursal_id IS NULL OR cc.sucursal_id = p_sucursal_id)`: un CARGO sin
-- sucursal desaparece de deuda_fiado cuando se consulta por una sucursal, y la
-- orden ya no suma en deuda_ordenes por tener CARGO. Resultado: la deuda se
-- evapora de esa consulta. Este backfill SI escribe sucursal_id desde la orden.
--
-- SEGURIDAD
--
--   * Idempotente: solo toca ordenes SIN un CARGO previo. Correrlo dos veces
--     no duplica nada.
--   * Anti doble-conteo: si la orden ya tenia PAGOs imputados, el cargo se
--     agranda por ese monto (misma logica que la 236), para que el saldo
--     posterior quede bien.
--   * Saldo corrido por cliente con FOR UPDATE, ordenado por fecha.
--   * Atomico: si algo falla, no queda nada a medias.
--   * El CARGO se fecha con la ENTREGA, no con hoy, para que el resumen de
--     cuenta del cliente lea en orden cronologico.
--
-- COMO CORRERLO
--
--   npm run db:dry   -- supabase/migrations/backfill/328_backfill_cc_ordenes_sin_cargo.sql
--   npm run db:apply -- supabase/migrations/backfill/328_backfill_cc_ordenes_sin_cargo.sql
--
-- En el editor SQL de Supabase se puede pegar tal cual (corre en su propia
-- transaccion). El RAISE NOTICE del final dice cuantos CARGOs se crearon.
-- ============================================================================

DO $$
DECLARE
  r           RECORD;
  v_cliente   TEXT := NULL;
  v_saldo     DECIMAL := 0;
  v_pagos     DECIMAL;
  v_cargo     DECIMAL;
  v_creados   INT := 0;
  v_total     DECIMAL := 0;
BEGIN
  FOR r IN
    SELECT
      o.organization_id AS org_id,
      o.cliente_id      AS cliente_id,
      o.id              AS ref_id,
      o.sucursal_id     AS sucursal_id,
      (COALESCE(o.costo_final,0)
       - COALESCE(o.descuento_cobro,0)
       - COALESCE(o.total_cobrado,0))                      AS pendiente,
      COALESCE(o.fecha_entrega, o.fecha_completado, NOW()) AS fecha
    FROM ordenes_servicio o
    WHERE o.estado::text IN ('ENTREGADO', 'ENTREGADO_SIN_REPARACION')
      AND o.cliente_id IS NOT NULL
      AND (COALESCE(o.costo_final,0)
           - COALESCE(o.descuento_cobro,0)
           - COALESCE(o.total_cobrado,0)) > 0.01
      AND NOT EXISTS (
        SELECT 1 FROM cuenta_corriente cc
        WHERE cc.referencia_tipo = 'ORDEN'
          AND cc.referencia_id   = o.id
          AND cc.tipo            = 'CARGO')
    ORDER BY o.cliente_id, COALESCE(o.fecha_entrega, o.fecha_completado, NOW())
  LOOP
    -- Cambio de cliente: cerrar el saldo del anterior y tomar el del nuevo.
    IF v_cliente IS DISTINCT FROM r.cliente_id THEN
      IF v_cliente IS NOT NULL THEN
        UPDATE clientes SET saldo_cuenta = v_saldo WHERE id = v_cliente;
      END IF;
      SELECT saldo_cuenta INTO v_saldo FROM clientes WHERE id = r.cliente_id FOR UPDATE;
      v_saldo   := COALESCE(v_saldo, 0);
      v_cliente := r.cliente_id;
    END IF;

    -- Si ya habia PAGOs imputados a esta orden, el cargo original era mayor
    -- que el pendiente de hoy. Sin esto el saldo queda corto por esos pagos.
    v_pagos := COALESCE((
      SELECT SUM(cc.monto) FROM cuenta_corriente cc
      WHERE cc.referencia_tipo = 'ORDEN'
        AND cc.referencia_id   = r.ref_id
        AND cc.tipo            = 'PAGO'), 0);

    v_cargo := r.pendiente + v_pagos;
    v_saldo := v_saldo - v_cargo;

    INSERT INTO cuenta_corriente (
      organization_id, cliente_id, sucursal_id, tipo, monto, saldo_posterior,
      referencia_tipo, referencia_id, observaciones, created_at
    ) VALUES (
      r.org_id, r.cliente_id, r.sucursal_id, 'CARGO', -v_cargo, v_saldo,
      'ORDEN', r.ref_id,
      'Deuda de orden entregada que no se habia registrado (backfill 328)',
      r.fecha
    );

    v_creados := v_creados + 1;
    v_total   := v_total + v_cargo;
  END LOOP;

  -- Cerrar el saldo del ultimo cliente.
  IF v_cliente IS NOT NULL THEN
    UPDATE clientes SET saldo_cuenta = v_saldo WHERE id = v_cliente;
  END IF;

  RAISE NOTICE 'CARGOs creados: % · total cargado: %', v_creados, v_total;
END $$;
