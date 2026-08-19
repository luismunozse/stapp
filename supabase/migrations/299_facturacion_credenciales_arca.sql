-- ============================================================================
-- 299: facturación ARCA directa — credenciales fiscales (PR2, Phase 1)
-- ============================================================================
-- Agrega el soporte de credenciales para el proveedor 'arca' (certificado +
-- clave privada X.509, cifrados at-rest) sobre facturacion_credenciales
-- (migración 296), sin tocar ninguna columna existente de TusFacturas —
-- quedan NULLABLE para que una org que siga en 'tusfacturas' conserve sus
-- credenciales legibles (design ADR-04; spec "Organization Fiscal Identity":
-- "no column is dropped").
--
-- `provider` default 'arca': toda fila escrita desde este cambio en adelante
-- es ARCA. facturacion_credenciales está efectivamente vacía en producción
-- (ninguna org llegó a ver la tarjeta de facturación electrónica todavía),
-- así que no hace falta backfill de filas existentes.
-- ============================================================================

ALTER TABLE facturacion_credenciales
  ADD COLUMN IF NOT EXISTS provider               TEXT NOT NULL DEFAULT 'arca',
  ADD COLUMN IF NOT EXISTS cert_pem_enc            TEXT,
  ADD COLUMN IF NOT EXISTS key_pem_enc             TEXT,
  ADD COLUMN IF NOT EXISTS cuit                    TEXT,
  ADD COLUMN IF NOT EXISTS cert_not_after          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cert_not_before         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cert_subject            TEXT,
  ADD COLUMN IF NOT EXISTS cert_fingerprint        TEXT,
  ADD COLUMN IF NOT EXISTS punto_venta_default     INTEGER,
  ADD COLUMN IF NOT EXISTS puntos_venta            JSONB,
  ADD COLUMN IF NOT EXISTS puntos_venta_sync_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ultimo_error            TEXT,
  ADD COLUMN IF NOT EXISTS ultima_verificacion_at  TIMESTAMPTZ;

-- Una org ARCA-only no tiene tokens de TusFacturas; las tres columnas legacy
-- nunca se eliminan, solo dejan de ser obligatorias.
ALTER TABLE facturacion_credenciales
  ALTER COLUMN apitoken_enc  DROP NOT NULL,
  ALTER COLUMN apikey_enc    DROP NOT NULL,
  ALTER COLUMN usertoken_enc DROP NOT NULL;

-- 296 creó `estado` como CHECK column-level -> nombre auto-generado
-- <tabla>_<columna>_check (verificado contra pg_constraint antes de aplicar).
ALTER TABLE facturacion_credenciales DROP CONSTRAINT IF EXISTS facturacion_credenciales_estado_check;
ALTER TABLE facturacion_credenciales ADD  CONSTRAINT facturacion_credenciales_estado_check
  CHECK (estado IN ('conectado', 'error', 'cert_vencido', 'sin_configurar'));

ALTER TABLE facturacion_credenciales ADD CONSTRAINT facturacion_credenciales_provider_check
  CHECK (provider IN ('arca', 'tusfacturas'));

-- Una fila 'arca' recién creada nunca queda a medio configurar: cert, key y
-- CUIT viajan juntos en el mismo PUT (endpoint write-only, ver route.ts).
ALTER TABLE facturacion_credenciales ADD CONSTRAINT facturacion_credenciales_arca_completa
  CHECK (provider <> 'arca'
         OR (cert_pem_enc IS NOT NULL AND key_pem_enc IS NOT NULL AND cuit IS NOT NULL));
