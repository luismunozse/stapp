-- ========================================
-- Migration 259: recargos_metodo_pago
-- ========================================
-- % por método de pago que sube el PRECIO EFECTIVO de la venta (ingreso del
-- negocio), no interés bancario. Config por organización. Método sin fila => 0%.

CREATE TABLE IF NOT EXISTS recargos_metodo_pago (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  metodo_pago TEXT NOT NULL,
  porcentaje DECIMAL(5,2) NOT NULL DEFAULT 0 CHECK (porcentaje >= 0),
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, metodo_pago)
);

CREATE INDEX IF NOT EXISTS recargos_metodo_pago_org_idx
  ON recargos_metodo_pago(organization_id);

ALTER TABLE recargos_metodo_pago ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_recargos_metodo_pago" ON recargos_metodo_pago
  FOR ALL TO authenticated
  USING (organization_id = (
    SELECT organization_id FROM users WHERE id = auth.uid()::text
  ))
  WITH CHECK (organization_id = (
    SELECT organization_id FROM users WHERE id = auth.uid()::text
  ));

CREATE POLICY "service_role_recargos_metodo_pago" ON recargos_metodo_pago
  FOR ALL TO service_role USING (true) WITH CHECK (true);
