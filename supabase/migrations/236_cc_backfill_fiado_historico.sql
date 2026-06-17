-- Fase 3: backfill de fiado historico en cuenta corriente.
-- Inserta los CARGO faltantes de ordenes entregadas y ventas impagas que nunca
-- debitaron la cuenta corriente (ordenes pre-Fase-1 / ventas pre-mig-225).
-- Idempotente: solo procesa documentos SIN un CARGO previo. Running balance por
-- cliente con lock. La migracion es atomica (todo o nada).
DO $$
DECLARE
  r RECORD;
  v_cliente TEXT := NULL;
  v_saldo   DECIMAL := 0;
  v_pagos   DECIMAL;
  v_cargo   DECIMAL;
BEGIN
  FOR r IN
    SELECT * FROM (
      SELECT o.organization_id AS org_id, o.cliente_id AS cliente_id,
             'ORDEN'::text AS ref_tipo, o.id AS ref_id,
             (o.costo_final - COALESCE(o.descuento_cobro,0) - COALESCE(o.total_cobrado,0)) AS pendiente,
             o.fecha_entrega AS fecha
      FROM ordenes_servicio o
      WHERE o.estado IN ('ENTREGADO','ENTREGADO_SIN_REPARACION')
        AND o.cliente_id IS NOT NULL
        AND (o.costo_final - COALESCE(o.descuento_cobro,0) - COALESCE(o.total_cobrado,0)) > 0
        AND NOT EXISTS (
          SELECT 1 FROM cuenta_corriente cc
          WHERE cc.referencia_tipo='ORDEN' AND cc.referencia_id=o.id AND cc.tipo='CARGO')
      UNION ALL
      SELECT v.organization_id, v.cliente_id,
             'VENTA'::text, v.id,
             (v.total - COALESCE(v.monto_abonado,0)),
             v.created_at
      FROM ventas v
      WHERE v.estado = 'COMPLETADA'
        AND v.cliente_id IS NOT NULL
        AND (v.total - COALESCE(v.monto_abonado,0)) > 0
        AND NOT EXISTS (
          SELECT 1 FROM cuenta_corriente cc
          WHERE cc.referencia_tipo='VENTA' AND cc.referencia_id=v.id AND cc.tipo='CARGO')
    ) docs
    ORDER BY cliente_id, fecha
  LOOP
    -- Cambio de cliente: flush del anterior, cargar saldo del nuevo (con lock)
    IF v_cliente IS DISTINCT FROM r.cliente_id THEN
      IF v_cliente IS NOT NULL THEN
        UPDATE clientes SET saldo_cuenta = v_saldo WHERE id = v_cliente;
      END IF;
      SELECT saldo_cuenta INTO v_saldo FROM clientes WHERE id = r.cliente_id FOR UPDATE;
      v_saldo := COALESCE(v_saldo, 0);
      v_cliente := r.cliente_id;
    END IF;

    -- cargo = pendiente + SUM(PAGO previos del doc)  (anti doble-conteo)
    v_pagos := COALESCE(
      (SELECT SUM(cc.monto) FROM cuenta_corriente cc
       WHERE cc.referencia_tipo = r.ref_tipo AND cc.referencia_id = r.ref_id AND cc.tipo='PAGO'), 0);
    v_cargo := r.pendiente + v_pagos;
    v_saldo := v_saldo - v_cargo;

    INSERT INTO cuenta_corriente (
      organization_id, cliente_id, tipo, monto, saldo_posterior,
      referencia_tipo, referencia_id, observaciones, created_at
    ) VALUES (
      r.org_id, r.cliente_id, 'CARGO', -v_cargo, v_saldo,
      r.ref_tipo, r.ref_id, 'Backfill fiado historico', COALESCE(r.fecha, NOW())
    );
  END LOOP;

  -- flush del ultimo cliente
  IF v_cliente IS NOT NULL THEN
    UPDATE clientes SET saldo_cuenta = v_saldo WHERE id = v_cliente;
  END IF;
END $$;
