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
-- `provider` default 'arca': toda fila NUEVA escrita desde este cambio en
-- adelante es ARCA. CORRECCIÓN (review PR2, 2026-08-19): la premisa original
-- de esta migración — "facturacion_credenciales está efectivamente vacía en
-- producción" — es FALSA. La migración 296 activó
-- feature_flags.facturacion_electronica=true para el plan Profesional en
-- producción, y la tarjeta de TusFacturas en Configuración es alcanzable
-- hoy por cualquier org Profesional + pais='AR'; puede existir una fila real
-- con tokens de TusFacturas cargados. Por eso este archivo hace el backfill
-- defensivo que ADR-04 ya anticipaba como contingencia («if the probe finds
-- rows, add UPDATE … SET provider='tusfacturas' WHERE apitoken_enc IS NOT
-- NULL before the CHECK») ANTES de agregar el CHECK de completitud de abajo:
-- sin el backfill, una fila real de TusFacturas heredaría el default
-- 'arca' de la columna nueva y haría fallar la migración entera contra
-- `facturacion_credenciales_arca_completa` (cert/key/cuit NULL en esa fila).
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

-- Backfill defensivo (ver comentario del encabezado): cualquier fila con un
-- token legacy cargado es, por definición, una fila de TusFacturas real —
-- nunca puede quedar taggeada 'arca' por el default de la columna. Corre
-- ANTES del CHECK de completitud de abajo a propósito.
UPDATE facturacion_credenciales SET provider = 'tusfacturas' WHERE apitoken_enc IS NOT NULL;

-- Una fila 'arca' recién creada nunca queda a medio configurar: cert, key y
-- CUIT viajan juntos en el mismo PUT (endpoint write-only, ver route.ts).
ALTER TABLE facturacion_credenciales ADD CONSTRAINT facturacion_credenciales_arca_completa
  CHECK (provider <> 'arca'
         OR (cert_pem_enc IS NOT NULL AND key_pem_enc IS NOT NULL AND cuit IS NOT NULL));
