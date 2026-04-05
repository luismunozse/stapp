-- ============================================
-- Migration 089: Sistema completo de Caja
-- - Sesiones de caja (apertura/cierre)
-- - Movimientos manuales (ingresos/egresos)
-- - Arqueo de caja
-- ============================================

-- ========================================
-- 1. Sesiones de Caja
-- ========================================

CREATE TABLE IF NOT EXISTS sesiones_caja (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  usuario_apertura_id TEXT NOT NULL REFERENCES users(id),
  usuario_cierre_id TEXT REFERENCES users(id),
  estado TEXT NOT NULL DEFAULT 'ABIERTA' CHECK (estado IN ('ABIERTA', 'CERRADA')),
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  saldo_inicial DECIMAL(10,2) NOT NULL DEFAULT 0,
  -- Campos populados al cerrar:
  total_ingresos DECIMAL(10,2),
  total_egresos DECIMAL(10,2),
  total_ingresos_efectivo DECIMAL(10,2),
  total_egresos_efectivo DECIMAL(10,2),
  conteo_fisico DECIMAL(10,2),
  diferencia DECIMAL(10,2),
  observaciones_cierre TEXT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Solo 1 sesión abierta por organización a la vez
CREATE UNIQUE INDEX idx_sesiones_caja_org_abierta
  ON sesiones_caja(organization_id) WHERE estado = 'ABIERTA';

CREATE INDEX idx_sesiones_caja_org_fecha ON sesiones_caja(organization_id, fecha DESC);
CREATE INDEX idx_sesiones_caja_org_estado ON sesiones_caja(organization_id, estado);

ALTER TABLE sesiones_caja ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_sesiones_caja" ON sesiones_caja
  FOR ALL TO authenticated
  USING (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()::text))
  WITH CHECK (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()::text));
CREATE POLICY "service_role_sesiones_caja" ON sesiones_caja
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER sesiones_caja_updated_at
  BEFORE UPDATE ON sesiones_caja
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ========================================
-- 2. Movimientos Manuales de Caja
-- ========================================

CREATE TABLE IF NOT EXISTS movimientos_caja (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sesion_caja_id TEXT REFERENCES sesiones_caja(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('INGRESO', 'EGRESO')),
  monto DECIMAL(10,2) NOT NULL CHECK (monto > 0),
  metodo_pago TEXT NOT NULL,
  concepto TEXT NOT NULL,
  observaciones TEXT,
  usuario_id TEXT REFERENCES users(id),
  fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_movimientos_caja_org_fecha ON movimientos_caja(organization_id, fecha DESC);
CREATE INDEX idx_movimientos_caja_sesion ON movimientos_caja(sesion_caja_id);

ALTER TABLE movimientos_caja ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_movimientos_caja" ON movimientos_caja
  FOR ALL TO authenticated
  USING (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()::text))
  WITH CHECK (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()::text));
CREATE POLICY "service_role_movimientos_caja" ON movimientos_caja
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER movimientos_caja_updated_at
  BEFORE UPDATE ON movimientos_caja
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
