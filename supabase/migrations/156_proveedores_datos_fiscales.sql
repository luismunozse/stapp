-- ========================================
-- 156: Proveedores — datos fiscales y condiciones comerciales (AR)
-- ========================================
-- Campos requeridos para facturación A en Argentina y para condiciones
-- de pago habituales (contado / cta cte con días).
-- ========================================

ALTER TABLE proveedores
  ADD COLUMN IF NOT EXISTS razon_social     TEXT,
  ADD COLUMN IF NOT EXISTS cuit             TEXT,
  ADD COLUMN IF NOT EXISTS condicion_iva    TEXT,
  ADD COLUMN IF NOT EXISTS ingresos_brutos  TEXT,
  ADD COLUMN IF NOT EXISTS condicion_pago   TEXT,
  ADD COLUMN IF NOT EXISTS dias_pago        INTEGER;

-- Validación de condición IVA (whitelist).
ALTER TABLE proveedores DROP CONSTRAINT IF EXISTS proveedores_condicion_iva_chk;
ALTER TABLE proveedores ADD CONSTRAINT proveedores_condicion_iva_chk
  CHECK (
    condicion_iva IS NULL OR condicion_iva IN (
      'RESPONSABLE_INSCRIPTO',
      'MONOTRIBUTO',
      'EXENTO',
      'NO_RESPONSABLE',
      'CONSUMIDOR_FINAL'
    )
  );

-- Validación de condición de pago (whitelist).
ALTER TABLE proveedores DROP CONSTRAINT IF EXISTS proveedores_condicion_pago_chk;
ALTER TABLE proveedores ADD CONSTRAINT proveedores_condicion_pago_chk
  CHECK (
    condicion_pago IS NULL OR condicion_pago IN (
      'CONTADO',
      'CTA_CTE',
      'TRANSFERENCIA',
      'CHEQUE',
      'OTRO'
    )
  );

-- Días de pago no negativos.
ALTER TABLE proveedores DROP CONSTRAINT IF EXISTS proveedores_dias_pago_chk;
ALTER TABLE proveedores ADD CONSTRAINT proveedores_dias_pago_chk
  CHECK (dias_pago IS NULL OR dias_pago >= 0);

-- Índice parcial para buscar por CUIT (sólo cuando está cargado).
CREATE INDEX IF NOT EXISTS idx_proveedores_cuit
  ON proveedores(organization_id, cuit)
  WHERE cuit IS NOT NULL;

COMMENT ON COLUMN proveedores.razon_social IS
  'Razón social legal. nombre se mantiene como nombre comercial.';
COMMENT ON COLUMN proveedores.cuit IS
  'CUIT del proveedor (11 dígitos, formato libre admitido).';
COMMENT ON COLUMN proveedores.condicion_iva IS
  'Condición frente al IVA. Valores: RESPONSABLE_INSCRIPTO, MONOTRIBUTO, EXENTO, NO_RESPONSABLE, CONSUMIDOR_FINAL.';
COMMENT ON COLUMN proveedores.ingresos_brutos IS
  'Número de Ingresos Brutos / IIBB (provincial).';
COMMENT ON COLUMN proveedores.condicion_pago IS
  'Modalidad habitual de pago. Valores: CONTADO, CTA_CTE, TRANSFERENCIA, CHEQUE, OTRO.';
COMMENT ON COLUMN proveedores.dias_pago IS
  'Días de pago si la condición es a plazo (0 = contado).';
