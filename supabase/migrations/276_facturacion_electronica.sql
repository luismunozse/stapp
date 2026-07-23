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
  condicion_fiscal      TEXT NOT NULL DEFAULT 'MONOTRIBUTO', -- MONOTRIBUTO | RESPONSABLE_INSCRIPTO
  estado                TEXT NOT NULL DEFAULT 'conectado',   -- conectado | error
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3) Comprobantes fiscales emitidos
CREATE TABLE IF NOT EXISTS comprobantes_fiscales (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  venta_id              TEXT NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  tipo                  TEXT NOT NULL,               -- 'B' | 'C'
  punto_venta           INTEGER NOT NULL,
  numero                TEXT,
  cae                   TEXT,
  cae_vencimiento       TEXT,
  estado                TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | emitido | rechazado
  pdf_url               TEXT,
  receptor_doc_tipo     TEXT,
  receptor_doc_nro      TEXT,
  receptor_condicion_iva TEXT,
  total                 NUMERIC(14,2) NOT NULL DEFAULT 0,
  provider              TEXT NOT NULL DEFAULT 'tusfacturas',
  provider_response     JSONB,
  error_msg             TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Una venta no puede tener dos comprobantes EMITIDOS
CREATE UNIQUE INDEX IF NOT EXISTS uq_comprobante_venta_emitido
  ON comprobantes_fiscales(venta_id) WHERE estado = 'emitido';

CREATE INDEX IF NOT EXISTS idx_comprobantes_org ON comprobantes_fiscales(organization_id);

-- 4) Feature flag comercial en el plan Profesional
UPDATE plans
SET feature_flags = COALESCE(feature_flags, '{}'::jsonb) || '{"facturacion_electronica": true}'::jsonb
WHERE slug = 'profesional';
