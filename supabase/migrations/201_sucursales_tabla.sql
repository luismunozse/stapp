-- ========================================
-- 201: SUCURSALES (FASE 1) — tabla + backfill Casa Central
-- ========================================
-- Introduce el concepto de sucursal (local físico) por organización.
-- Molde: 169_multi_deposito.sql. Idempotente: re-ejecutar no duplica.
-- Cada org recibe una sucursal principal "Casa Central" vía backfill.

-- ========================================
-- 1. TABLA sucursales
-- ========================================

CREATE TABLE IF NOT EXISTS sucursales (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  codigo TEXT,
  direccion TEXT,
  telefono TEXT,
  notas TEXT,
  principal BOOLEAN NOT NULL DEFAULT false,
  activo BOOLEAN NOT NULL DEFAULT true,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Nombre único por org (entre activos)
CREATE UNIQUE INDEX IF NOT EXISTS sucursales_org_nombre_unique
  ON sucursales(organization_id, LOWER(nombre))
  WHERE deleted_at IS NULL;

-- Solo 1 principal por org
CREATE UNIQUE INDEX IF NOT EXISTS sucursales_org_principal_unique
  ON sucursales(organization_id)
  WHERE principal = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS sucursales_org_idx
  ON sucursales(organization_id) WHERE deleted_at IS NULL;

ALTER TABLE sucursales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sucursales_select ON sucursales;
CREATE POLICY sucursales_select ON sucursales
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS sucursales_all_service ON sucursales;
CREATE POLICY sucursales_all_service ON sucursales
  FOR ALL USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS sucursales_updated_at ON sucursales;
CREATE TRIGGER sucursales_updated_at
  BEFORE UPDATE ON sucursales
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ========================================
-- 2. BACKFILL: sucursal "Casa Central" por org
-- ========================================

INSERT INTO sucursales (organization_id, nombre, principal, activo)
SELECT o.id, 'Casa Central', true, true
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM sucursales s
  WHERE s.organization_id = o.id
    AND s.principal = true
    AND s.deleted_at IS NULL
);
