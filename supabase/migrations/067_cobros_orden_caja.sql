-- ============================================
-- COBROS DIRECTOS EN ORDENES DE SERVICIO
-- Permite registrar pagos sin necesidad de factura
-- ============================================

CREATE TABLE IF NOT EXISTS cobros_orden (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  orden_id TEXT NOT NULL REFERENCES ordenes_servicio(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  monto DECIMAL(10,2) NOT NULL,
  metodo_pago TEXT NOT NULL, -- EFECTIVO, TRANSFERENCIA, etc.
  numero_referencia TEXT,
  observaciones TEXT,
  cuotas INTEGER,
  recargo_porcentaje DECIMAL(5,2),
  monto_original DECIMAL(10,2),
  usuario_id TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cobros_orden_orden ON cobros_orden(orden_id);
CREATE INDEX idx_cobros_orden_org ON cobros_orden(organization_id, created_at DESC);

-- RLS
ALTER TABLE cobros_orden ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_cobros_orden" ON cobros_orden
  FOR ALL TO authenticated
  USING (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()::text))
  WITH CHECK (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()::text));
CREATE POLICY "service_role_cobros_orden" ON cobros_orden
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================
-- Campos adicionales en ordenes_servicio
-- ============================================

-- Método de pago de la seña
ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS metodo_pago_sena TEXT DEFAULT 'EFECTIVO';

-- Total cobrado y estado de cobro (sin factura)
ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS total_cobrado DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS estado_cobro TEXT NOT NULL DEFAULT 'PENDIENTE'
  CHECK (estado_cobro IN ('PENDIENTE', 'PARCIAL', 'COBRADO'));

-- Descuento al cobrar
ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS descuento_cobro DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Backfill: ordenes con seña ya tienen cobros parciales
UPDATE ordenes_servicio
SET total_cobrado = COALESCE(sena, 0),
    estado_cobro = CASE
      WHEN COALESCE(sena, 0) >= COALESCE(costo_final, 0) AND COALESCE(costo_final, 0) > 0 THEN 'COBRADO'
      WHEN COALESCE(sena, 0) > 0 THEN 'PARCIAL'
      ELSE 'PENDIENTE'
    END
WHERE COALESCE(sena, 0) > 0;

-- Crear cobro inicial para seña existentes
INSERT INTO cobros_orden (orden_id, organization_id, monto, metodo_pago, observaciones, created_at)
SELECT id, organization_id, sena, 'EFECTIVO', 'Seña al ingreso del equipo', fecha_ingreso
FROM ordenes_servicio
WHERE COALESCE(sena, 0) > 0;

-- ============================================
-- Función para recalcular estado de cobro
-- ============================================
CREATE OR REPLACE FUNCTION recalcular_estado_cobro(p_orden_id TEXT)
RETURNS VOID AS $$
DECLARE
  v_total_cobrado DECIMAL;
  v_costo_final DECIMAL;
  v_descuento DECIMAL;
  v_estado TEXT;
BEGIN
  SELECT COALESCE(SUM(monto), 0) INTO v_total_cobrado
  FROM cobros_orden WHERE orden_id = p_orden_id;

  SELECT COALESCE(costo_final, 0), COALESCE(descuento_cobro, 0)
  INTO v_costo_final, v_descuento
  FROM ordenes_servicio WHERE id = p_orden_id;

  -- Considerar descuento
  v_costo_final := v_costo_final - v_descuento;

  IF v_costo_final <= 0 THEN
    v_estado := 'PENDIENTE';
  ELSIF v_total_cobrado >= v_costo_final THEN
    v_estado := 'COBRADO';
  ELSIF v_total_cobrado > 0 THEN
    v_estado := 'PARCIAL';
  ELSE
    v_estado := 'PENDIENTE';
  END IF;

  UPDATE ordenes_servicio
  SET total_cobrado = v_total_cobrado,
      estado_cobro = v_estado
  WHERE id = p_orden_id;
END;
$$ LANGUAGE plpgsql;
