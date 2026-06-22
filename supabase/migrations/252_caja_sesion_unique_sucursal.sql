-- applied manually in Supabase SQL editor
DROP INDEX IF EXISTS idx_sesiones_caja_org_abierta;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sesiones_caja_sucursal_abierta
  ON sesiones_caja(organization_id, sucursal_id) WHERE estado = 'ABIERTA';
