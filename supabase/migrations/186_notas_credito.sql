-- ============================================
-- 186: Notas de crédito (reembolsos, devoluciones, ajustes)
-- ============================================
-- Hoy anular venta resta todo. Reembolso parcial (devolución de 1 producto,
-- ajuste de precio post-venta, ajuste por garantía) no existe → ingresos
-- sobreestimados en reportes.
--
-- Modelo: una NC se asocia a UNA venta O UNA orden. Tiene items opcionales
-- (para devolución parcial con restock). Si no hay items detallados, NC es
-- "ajuste global" (resta del total sin restock).
-- ============================================

CREATE TABLE IF NOT EXISTS notas_credito (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  numero TEXT NOT NULL,
  venta_id TEXT REFERENCES ventas(id) ON DELETE SET NULL,
  orden_id TEXT REFERENCES ordenes_servicio(id) ON DELETE SET NULL,
  motivo TEXT NOT NULL CHECK (motivo IN (
    'DEVOLUCION',         -- cliente devolvió producto
    'AJUSTE_PRECIO',      -- precio acordado post-venta
    'GARANTIA',           -- reposición por garantía
    'ERROR_FACTURACION',  -- error de cobro
    'DESCUENTO_RETRO',    -- descuento aplicado tras la venta
    'OTRO'
  )),
  monto DECIMAL(12,2) NOT NULL CHECK (monto > 0),
  metodo_devolucion TEXT CHECK (metodo_devolucion IN (
    'EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'MERCADOPAGO',
    'CUENTA_CORRIENTE', 'NOTA_CREDITO_INTERNA', 'OTRO'
  )),
  fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id TEXT REFERENCES users(id),
  notas TEXT,
  anulada BOOLEAN NOT NULL DEFAULT FALSE,
  anulada_at TIMESTAMPTZ,
  anulada_por TEXT REFERENCES users(id),
  anulada_motivo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (venta_id IS NOT NULL AND orden_id IS NULL) OR
    (venta_id IS NULL AND orden_id IS NOT NULL)
  ),
  UNIQUE (organization_id, numero)
);

CREATE INDEX IF NOT EXISTS notas_credito_org_fecha_idx
  ON notas_credito(organization_id, fecha DESC) WHERE anulada = FALSE;
CREATE INDEX IF NOT EXISTS notas_credito_venta_idx
  ON notas_credito(venta_id) WHERE venta_id IS NOT NULL AND anulada = FALSE;
CREATE INDEX IF NOT EXISTS notas_credito_orden_idx
  ON notas_credito(orden_id) WHERE orden_id IS NOT NULL AND anulada = FALSE;

ALTER TABLE notas_credito ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_notas_credito" ON notas_credito
  FOR ALL TO authenticated
  USING (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()::text))
  WITH CHECK (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()::text));
CREATE POLICY "service_role_notas_credito" ON notas_credito
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Items detallados (opcional, para restock)
CREATE TABLE IF NOT EXISTS items_nota_credito (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  nota_credito_id TEXT NOT NULL REFERENCES notas_credito(id) ON DELETE CASCADE,
  item_venta_id TEXT REFERENCES items_venta(id),
  inventario_id TEXT REFERENCES inventario(id),
  descripcion TEXT NOT NULL,
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  precio_unitario DECIMAL(10,2) NOT NULL,
  restock BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS items_nota_credito_nc_idx ON items_nota_credito(nota_credito_id);

ALTER TABLE items_nota_credito ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_items_nota_credito" ON items_nota_credito
  FOR ALL TO authenticated
  USING (
    nota_credito_id IN (
      SELECT id FROM notas_credito
      WHERE organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()::text)
    )
  );
CREATE POLICY "service_role_items_nota_credito" ON items_nota_credito
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================
-- Contador atómico para numeración por org
-- ============================================
CREATE TABLE IF NOT EXISTS notas_credito_counter (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  next_number INTEGER NOT NULL DEFAULT 1
);

CREATE OR REPLACE FUNCTION get_next_nota_credito_number(p_org_id TEXT)
RETURNS TEXT AS $$
DECLARE
  v_num INTEGER;
BEGIN
  INSERT INTO notas_credito_counter (organization_id, next_number)
  VALUES (p_org_id, 1)
  ON CONFLICT (organization_id) DO UPDATE
    SET next_number = notas_credito_counter.next_number + 1
  RETURNING next_number INTO v_num;
  RETURN 'NC-' || LPAD(v_num::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- RPC: crear NC con items, restock atómico
-- ============================================
CREATE OR REPLACE FUNCTION crear_nota_credito(
  p_org_id TEXT,
  p_venta_id TEXT,
  p_orden_id TEXT,
  p_motivo TEXT,
  p_monto NUMERIC,
  p_metodo_devolucion TEXT,
  p_notas TEXT,
  p_user_id TEXT,
  p_items JSONB  -- array de {item_venta_id?, inventario_id?, descripcion, cantidad, precio_unitario, restock}
)
RETURNS JSON AS $$
DECLARE
  v_nc_id TEXT;
  v_numero TEXT;
  v_item JSONB;
  v_inv_id TEXT;
  v_cant INTEGER;
  v_restock BOOLEAN;
BEGIN
  v_numero := get_next_nota_credito_number(p_org_id);

  INSERT INTO notas_credito (
    organization_id, numero, venta_id, orden_id, motivo, monto,
    metodo_devolucion, user_id, notas
  ) VALUES (
    p_org_id, v_numero, p_venta_id, p_orden_id, p_motivo, p_monto,
    p_metodo_devolucion, p_user_id, p_notas
  )
  RETURNING id INTO v_nc_id;

  IF p_items IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_inv_id := v_item->>'inventario_id';
      v_cant := (v_item->>'cantidad')::INTEGER;
      v_restock := COALESCE((v_item->>'restock')::BOOLEAN, TRUE);

      INSERT INTO items_nota_credito (
        nota_credito_id, item_venta_id, inventario_id,
        descripcion, cantidad, precio_unitario, restock
      ) VALUES (
        v_nc_id,
        v_item->>'item_venta_id',
        v_inv_id,
        v_item->>'descripcion',
        v_cant,
        (v_item->>'precio_unitario')::NUMERIC,
        v_restock
      );

      -- Restock atómico
      IF v_restock AND v_inv_id IS NOT NULL THEN
        UPDATE inventario SET stock = stock + v_cant WHERE id = v_inv_id;
        INSERT INTO movimientos_inventario (
          inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
          referencia_id, referencia_tipo, observaciones, organization_id, usuario_id
        )
        SELECT
          v_inv_id, 'DEVOLUCION', v_cant, stock - v_cant, stock,
          v_nc_id, 'nota_credito',
          'Restock por nota de crédito ' || v_numero, p_org_id, p_user_id
        FROM inventario WHERE id = v_inv_id;
      END IF;
    END LOOP;
  END IF;

  RETURN json_build_object('success', true, 'id', v_nc_id, 'numero', v_numero);
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE notas_credito IS
  'Reembolsos / devoluciones / ajustes de precio post-venta. Reportes restan monto del ingreso devengado/cash del período.';
