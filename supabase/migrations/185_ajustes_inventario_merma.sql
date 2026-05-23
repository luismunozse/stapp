-- ============================================
-- 185: Ajustes de inventario (merma, rotura, obsolescencia, etc.)
-- ============================================
-- Stock baja sólo al consumir (venta/orden). Pérdidas por rotura, robo,
-- vencimiento, obsolescencia no se registran ni afectan rentabilidad.
-- Esta tabla captura ajustes con clasificación + costo snapshot.
-- ============================================

CREATE TABLE IF NOT EXISTS ajustes_inventario (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  inventario_id TEXT NOT NULL REFERENCES inventario(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN (
    'MERMA',         -- producto en mal estado / vencido
    'ROTURA',        -- daño físico / accidente
    'ROBO',          -- sustracción
    'OBSOLESCENCIA', -- producto descontinuado / fuera de moda
    'DONACION',      -- donado / regalado
    'AJUSTE_FISICO', -- conteo físico encontró diferencia (puede ser ENTRADA o SALIDA)
    'OTRO'
  )),
  direccion TEXT NOT NULL CHECK (direccion IN ('SALIDA', 'ENTRADA')),
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  costo_unitario_snapshot DECIMAL(10,2),
  motivo TEXT,
  comprobante_url TEXT,
  user_id TEXT REFERENCES users(id),
  fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  afecta_rentabilidad BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ajustes_inventario_org_fecha_idx
  ON ajustes_inventario(organization_id, fecha DESC);
CREATE INDEX IF NOT EXISTS ajustes_inventario_inv_idx
  ON ajustes_inventario(inventario_id, fecha DESC);
CREATE INDEX IF NOT EXISTS ajustes_inventario_tipo_idx
  ON ajustes_inventario(organization_id, tipo, fecha DESC);

-- RLS
ALTER TABLE ajustes_inventario ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_ajustes_inventario" ON ajustes_inventario
  FOR ALL TO authenticated
  USING (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()::text))
  WITH CHECK (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()::text));
CREATE POLICY "service_role_ajustes_inventario" ON ajustes_inventario
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE ajustes_inventario IS
  'Registro de ajustes que afectan stock y/o rentabilidad. Reportes financieros incluyen los SALIDA con afecta_rentabilidad=true como costo del período (suma cantidad × costo_unitario_snapshot).';

-- ============================================
-- RPC atómico: aplicar ajuste + actualizar stock + movimiento_inventario
-- ============================================
CREATE OR REPLACE FUNCTION aplicar_ajuste_inventario(
  p_inventario_id TEXT,
  p_tipo TEXT,
  p_direccion TEXT,
  p_cantidad INTEGER,
  p_motivo TEXT,
  p_comprobante_url TEXT,
  p_afecta_rentabilidad BOOLEAN,
  p_user_id TEXT
)
RETURNS JSON AS $$
DECLARE
  v_stock INTEGER;
  v_org_id TEXT;
  v_precio_compra NUMERIC;
  v_ajuste_id TEXT;
  v_delta INTEGER;
  v_nuevo_stock INTEGER;
BEGIN
  SELECT stock, organization_id, precio_compra
  INTO v_stock, v_org_id, v_precio_compra
  FROM inventario
  WHERE id = p_inventario_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Item no encontrado');
  END IF;

  v_delta := CASE WHEN p_direccion = 'SALIDA' THEN -p_cantidad ELSE p_cantidad END;
  v_nuevo_stock := v_stock + v_delta;

  IF v_nuevo_stock < 0 THEN
    RETURN json_build_object('error', format('Stock insuficiente. Stock actual: %s', v_stock));
  END IF;

  INSERT INTO ajustes_inventario (
    organization_id, inventario_id, tipo, direccion, cantidad,
    costo_unitario_snapshot, motivo, comprobante_url, user_id, afecta_rentabilidad
  ) VALUES (
    v_org_id, p_inventario_id, p_tipo, p_direccion, p_cantidad,
    COALESCE(v_precio_compra, 0), p_motivo, p_comprobante_url, p_user_id, p_afecta_rentabilidad
  )
  RETURNING id INTO v_ajuste_id;

  UPDATE inventario SET stock = v_nuevo_stock WHERE id = p_inventario_id;

  INSERT INTO movimientos_inventario (
    inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
    referencia_id, referencia_tipo, observaciones, organization_id, usuario_id
  ) VALUES (
    p_inventario_id, 'AJUSTE', p_cantidad, v_stock, v_nuevo_stock,
    v_ajuste_id, 'ajuste_inventario',
    format('Ajuste %s %s: %s', p_tipo, p_direccion, COALESCE(p_motivo, 'sin motivo')),
    v_org_id, p_user_id
  );

  RETURN json_build_object('success', true, 'id', v_ajuste_id, 'nuevoStock', v_nuevo_stock);
END;
$$ LANGUAGE plpgsql;
