-- ============================================================================
-- 276: facturación electrónica ARCA (Slice 1) — schema base
-- ============================================================================
-- Toggle opt-in por org (preferencia, NO gating comercial → no va en
-- plans.feature_flags). Credenciales BYO cifradas (nunca al frontend).
-- comprobantes_fiscales guarda el resultado de cada emisión.
-- ============================================================================

-- 1) Preferencia opt-in por organización (default apagado)
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS facturacion_electronica_habilitada BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN organizations.facturacion_electronica_habilitada IS
  'Si true, la org habilitó la emisión de facturas electrónicas (opt-in). Requiere plan Profesional + pais=AR + credenciales conectadas.';

-- 2) Credenciales del proveedor (BYO), cifradas at-rest
CREATE TABLE IF NOT EXISTS facturacion_credenciales (
  organization_id       TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  apitoken_enc          TEXT NOT NULL,
  apikey_enc            TEXT NOT NULL,
  usertoken_enc         TEXT NOT NULL,
  punto_venta           INTEGER NOT NULL DEFAULT 1,
  condicion_fiscal      TEXT NOT NULL DEFAULT 'MONOTRIBUTO' -- MONOTRIBUTO | RESPONSABLE_INSCRIPTO
    CHECK (condicion_fiscal IN ('MONOTRIBUTO', 'RESPONSABLE_INSCRIPTO')),
  estado                TEXT NOT NULL DEFAULT 'conectado'   -- conectado | error
    CHECK (estado IN ('conectado', 'error')),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE facturacion_credenciales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS facturacion_credenciales_select ON facturacion_credenciales;
CREATE POLICY facturacion_credenciales_select ON facturacion_credenciales
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS facturacion_credenciales_all_service ON facturacion_credenciales;
CREATE POLICY facturacion_credenciales_all_service ON facturacion_credenciales
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS facturacion_credenciales_updated_at ON facturacion_credenciales;
CREATE TRIGGER facturacion_credenciales_updated_at
  BEFORE UPDATE ON facturacion_credenciales
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 3) Comprobantes fiscales emitidos
CREATE TABLE IF NOT EXISTS comprobantes_fiscales (
  id                    TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  venta_id              TEXT NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  tipo                  TEXT NOT NULL               -- 'B' | 'C'
    CHECK (tipo IN ('B', 'C')),
  punto_venta           INTEGER NOT NULL,
  numero                TEXT,
  cae                   TEXT,
  cae_vencimiento       TEXT,
  estado                TEXT NOT NULL DEFAULT 'pendiente' -- pendiente | emitido | rechazado
    CHECK (estado IN ('pendiente', 'emitido', 'rechazado')),
  pdf_url               TEXT,
  receptor_doc_tipo     TEXT,
  receptor_doc_nro      TEXT,
  receptor_condicion_iva TEXT,
  total                 NUMERIC(14,2) NOT NULL,
  provider              TEXT NOT NULL DEFAULT 'tusfacturas',
  provider_response     JSONB,
  error_msg             TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Una venta no puede tener dos comprobantes ACTIVOS a la vez (pendiente o
-- emitido). Esto bloquea la carrera de dos emisiones concurrentes a nivel DB
-- y a la vez permite reintentar después de un rechazo (estado 'rechazado'
-- queda fuera del índice).
DROP INDEX IF EXISTS uq_comprobante_venta_emitido;
CREATE UNIQUE INDEX IF NOT EXISTS uq_comprobante_venta_activo
  ON comprobantes_fiscales(venta_id) WHERE estado IN ('pendiente', 'emitido');

CREATE INDEX IF NOT EXISTS idx_comprobantes_org ON comprobantes_fiscales(organization_id);

ALTER TABLE comprobantes_fiscales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comprobantes_fiscales_select ON comprobantes_fiscales;
CREATE POLICY comprobantes_fiscales_select ON comprobantes_fiscales
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS comprobantes_fiscales_all_service ON comprobantes_fiscales;
CREATE POLICY comprobantes_fiscales_all_service ON comprobantes_fiscales
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS comprobantes_fiscales_updated_at ON comprobantes_fiscales;
CREATE TRIGGER comprobantes_fiscales_updated_at
  BEFORE UPDATE ON comprobantes_fiscales
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 4) Feature flag comercial en el plan Profesional
UPDATE plans
SET feature_flags = COALESCE(feature_flags, '{}'::jsonb) || '{"facturacion_electronica": true}'::jsonb
WHERE slug = 'profesional';
