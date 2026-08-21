-- 292_factura_venta_id.sql
-- Allows facturas to be sourced from a venta (POS sale) instead of only an
-- ordenes_servicio. orden_id becomes nullable; venta_id is added with a
-- UNIQUE + XOR check. items_factura and facturas RLS are rewritten to use
-- facturas.organization_id directly (added in migration 250) instead of
-- joining ordenes_servicio, which breaks for venta-sourced rows (orden_id
-- IS NULL never matches an EXISTS join). anular_factura_atomica and
-- eliminar_factura_atomica are recreated with a LEFT JOIN to both
-- ordenes_servicio and ventas so lifecycle actions keep working for either
-- origin — org_id now comes straight from facturas.organization_id;
-- cliente_id/sucursal_id are only used for the CUENTA_CORRIENTE re-credit
-- loop, which is always empty for venta-sourced invoices (they never write
-- pagos_parciales), so COALESCE is safe.
BEGIN;

-- ============================================================
-- (1) Schema: nullable orden_id + venta_id + XOR check
-- ============================================================
ALTER TABLE facturas ALTER COLUMN orden_id DROP NOT NULL;

ALTER TABLE facturas
  ADD COLUMN IF NOT EXISTS venta_id TEXT UNIQUE REFERENCES ventas(id) ON DELETE CASCADE;

ALTER TABLE facturas DROP CONSTRAINT IF EXISTS facturas_orden_xor_venta;
ALTER TABLE facturas ADD CONSTRAINT facturas_orden_xor_venta
  CHECK ((orden_id IS NOT NULL) <> (venta_id IS NOT NULL));

-- ============================================================
-- (2) RLS: facturas — rewrite to use organization_id directly
--     (previously joined ordenes_servicio via orden_id, migration 002)
-- ============================================================
DROP POLICY IF EXISTS "Users can view org invoices" ON facturas;
DROP POLICY IF EXISTS "Users can manage org invoices" ON facturas;

CREATE POLICY "Users can view org invoices" ON facturas FOR SELECT
  USING (facturas.organization_id = public.get_current_organization_id());
CREATE POLICY "Users can manage org invoices" ON facturas FOR ALL
  USING (facturas.organization_id = public.get_current_organization_id());

-- ============================================================
-- (3) RLS: items_factura — rewrite to use facturas.organization_id
--     (previously joined ordenes_servicio via facturas.orden_id, migration 053)
-- ============================================================
DROP POLICY IF EXISTS "items_factura_access" ON items_factura;

-- NOTE: do NOT use current_setting('app.organization_id') here — that GUC is
-- never set (see migration 287's comment); the hardened convention is
-- public.get_current_organization_id() (migration 251).
CREATE POLICY "items_factura_access" ON items_factura
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM facturas f
      WHERE f.id = items_factura.factura_id
        AND f.organization_id = public.get_current_organization_id()
    )
  );

-- ============================================================
-- (4) RPC: crear_factura_venta_atomica
--     Mirrors crear_factura_atomica (migration 250) for the venta path:
--     no cotizacion_id, no seña/pagos_parciales (venta payments live in
--     pagos_venta, tracked on the venta itself).
-- ============================================================
CREATE OR REPLACE FUNCTION crear_factura_venta_atomica(
  p_venta_id       TEXT,
  p_numero_factura TEXT,
  p_subtotal       DECIMAL,
  p_iva            DECIMAL,
  p_total          DECIMAL,
  p_monto_abonado  DECIMAL,
  p_estado_pago    TEXT,
  p_items          JSONB
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_factura_id  TEXT;
  v_org_id      TEXT;
  v_item        JSONB;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM ventas
  WHERE id = p_venta_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Venta no encontrada: %', p_venta_id;
  END IF;

  INSERT INTO facturas (
    venta_id,
    organization_id,
    numero_factura,
    subtotal,
    iva,
    total,
    monto_abonado,
    estado_pago
  ) VALUES (
    p_venta_id,
    v_org_id,
    p_numero_factura,
    p_subtotal,
    p_iva,
    p_total,
    p_monto_abonado,
    p_estado_pago::estado_pago
  )
  RETURNING id INTO v_factura_id;

  IF jsonb_array_length(p_items) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      INSERT INTO items_factura (
        factura_id,
        descripcion,
        cantidad,
        precio_unitario,
        subtotal,
        tipo
      ) VALUES (
        v_factura_id,
        (v_item->>'descripcion')::TEXT,
        (v_item->>'cantidad')::INTEGER,
        (v_item->>'precio_unitario')::NUMERIC,
        (v_item->>'subtotal')::NUMERIC,
        (v_item->>'tipo')::TEXT
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object('id', v_factura_id);
END;
$$;

COMMENT ON FUNCTION crear_factura_venta_atomica(TEXT, TEXT, DECIMAL, DECIMAL, DECIMAL, DECIMAL, TEXT, JSONB) IS
  'Atomically creates a venta-sourced factura with its items_factura rows. '
  'Derives organization_id from ventas. Mirrors crear_factura_atomica '
  '(migration 250) but for the venta_id path: no cotizacion_id, no seña/'
  'pagos_parciales (venta payments live in pagos_venta). Migration 292.';

-- ============================================================
-- (5) RPC: anular_factura_atomica — LEFT JOIN both origins
-- ============================================================
CREATE OR REPLACE FUNCTION anular_factura_atomica(
  p_org_id     TEXT,
  p_factura_id TEXT,
  p_user_id    TEXT
) RETURNS JSONB AS $$
DECLARE
  v_factura RECORD;
  v_pago    RECORD;
BEGIN
  SELECT
    f.*,
    f.organization_id AS org_id,
    COALESCE(o.cliente_id, v.cliente_id) AS cliente_id,
    COALESCE(o.sucursal_id, v.sucursal_id) AS orden_sucursal_id
    INTO v_factura
    FROM facturas f
    LEFT JOIN ordenes_servicio o ON o.id = f.orden_id
    LEFT JOIN ventas v ON v.id = f.venta_id
    WHERE f.id = p_factura_id
    FOR UPDATE OF f;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factura no encontrada';
  END IF;

  IF v_factura.org_id <> p_org_id THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF v_factura.estado_pago::text = 'ANULADA' THEN
    RAISE EXCEPTION 'La factura ya esta anulada';
  END IF;

  FOR v_pago IN
    SELECT monto, metodo_pago
      FROM pagos_parciales
      WHERE factura_id = p_factura_id
  LOOP
    IF v_pago.metodo_pago::text = 'CUENTA_CORRIENTE' AND v_factura.cliente_id IS NOT NULL THEN
      PERFORM devolver_cuenta_corriente(
        p_org_id,
        v_factura.cliente_id,
        v_pago.monto,
        'FACTURA',
        p_factura_id,
        p_user_id,
        'Anulacion factura ' || v_factura.numero_factura,
        v_factura.orden_sucursal_id
      );
    END IF;
  END LOOP;

  UPDATE facturas
    SET estado_pago = 'ANULADA'::estado_pago
    WHERE id = p_factura_id;

  RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION anular_factura_atomica(TEXT,TEXT,TEXT) IS
  'Voids a factura atomically. Guards: not-found, org mismatch, already-ANULADA. '
  'Re-credits CUENTA_CORRIENTE partial payments via devolver_cuenta_corriente. '
  'Sets estado_pago=ANULADA. org_id/cliente_id/sucursal_id resolved via LEFT '
  'JOIN to both ordenes_servicio and ventas (migration 292) — org_id reads '
  'facturas.organization_id directly; cliente_id/sucursal_id fall back to '
  'whichever origin is populated. Migration 248/269 base behavior preserved.';

-- ============================================================
-- (6) RPC: eliminar_factura_atomica — LEFT JOIN both origins
-- ============================================================
CREATE OR REPLACE FUNCTION eliminar_factura_atomica(
  p_org_id     TEXT,
  p_factura_id TEXT,
  p_user_id    TEXT
) RETURNS JSONB AS $$
DECLARE
  v_factura RECORD;
  v_pago    RECORD;
BEGIN
  SELECT
    f.*,
    f.organization_id AS org_id,
    COALESCE(o.cliente_id, v.cliente_id) AS cliente_id,
    COALESCE(o.sucursal_id, v.sucursal_id) AS orden_sucursal_id
    INTO v_factura
    FROM facturas f
    LEFT JOIN ordenes_servicio o ON o.id = f.orden_id
    LEFT JOIN ventas v ON v.id = f.venta_id
    WHERE f.id = p_factura_id
    FOR UPDATE OF f;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factura no encontrada';
  END IF;

  IF v_factura.org_id <> p_org_id THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  FOR v_pago IN
    SELECT monto, metodo_pago
      FROM pagos_parciales
      WHERE factura_id = p_factura_id
  LOOP
    IF v_pago.metodo_pago::text = 'CUENTA_CORRIENTE' AND v_factura.cliente_id IS NOT NULL THEN
      PERFORM devolver_cuenta_corriente(
        p_org_id,
        v_factura.cliente_id,
        v_pago.monto,
        'FACTURA',
        p_factura_id,
        p_user_id,
        'Eliminacion factura ' || v_factura.numero_factura,
        v_factura.orden_sucursal_id
      );
    END IF;
  END LOOP;

  DELETE FROM pagos_parciales WHERE factura_id = p_factura_id;
  DELETE FROM facturas WHERE id = p_factura_id;

  RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION eliminar_factura_atomica(TEXT,TEXT,TEXT) IS
  'Deletes a factura atomically. Guards: not-found, org mismatch. '
  'Re-credits CUENTA_CORRIENTE partial payments, then deletes pagos_parciales '
  'and the factura in the same transaction. org_id/cliente_id/sucursal_id '
  'resolved via LEFT JOIN to both ordenes_servicio and ventas (migration 292). '
  'Migration 248/269 base behavior preserved.';

COMMIT;
