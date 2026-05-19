-- ========================================
-- 178: TEMPLATES DE ETIQUETAS TÉRMICAS (ZPL/EPL/PDF)
-- ========================================
-- Almacena plantillas de etiquetas por organización. ZPL es el lenguaje de las
-- impresoras Zebra modernas; EPL es el legacy. PDF queda para compat con el
-- generador HTML existente (labels-print-dialog actual).
--
-- Placeholders en `template`: {{codigo}}, {{nombre}}, {{barcode}}, {{precio}},
-- {{org_nombre}}. La sustitución se hace client-side al generar el spool.
--
-- Default por org+formato: índice parcial único asegura que sólo 1 template
-- pueda ser es_default=true por formato dentro de la organización (ignora
-- soft-deleted).
--
-- Backfill idempotente: por cada org sin templates ZPL, inserta 2 defaults:
--   1. 50x30mm con Code128, nombre truncado y precio (es_default=true)
--   2. 38x25mm más simple (es_default=false)

-- ========================================
-- 1. TABLA label_templates
-- ========================================

CREATE TABLE IF NOT EXISTS label_templates (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  formato TEXT NOT NULL CHECK (formato IN ('ZPL', 'EPL', 'PDF')),
  ancho_mm NUMERIC(5,2) NOT NULL DEFAULT 50,
  alto_mm NUMERIC(5,2) NOT NULL DEFAULT 30,
  dpi INTEGER NOT NULL DEFAULT 203 CHECK (dpi IN (152, 203, 300)),
  template TEXT NOT NULL,
  es_default BOOLEAN NOT NULL DEFAULT false,
  notas TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS label_templates_org_idx ON label_templates(organization_id);
CREATE INDEX IF NOT EXISTS label_templates_formato_idx ON label_templates(formato);

-- Sólo 1 default por (org, formato), ignorando soft-deleted
CREATE UNIQUE INDEX IF NOT EXISTS label_templates_default_unique
  ON label_templates(organization_id, formato)
  WHERE es_default = true AND deleted_at IS NULL;

-- ========================================
-- 2. RLS
-- ========================================

ALTER TABLE label_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS label_templates_select ON label_templates;
CREATE POLICY label_templates_select ON label_templates
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS label_templates_all_service ON label_templates;
CREATE POLICY label_templates_all_service ON label_templates
  FOR ALL USING (true) WITH CHECK (true);

-- ========================================
-- 3. TRIGGER updated_at (idempotente)
-- ========================================

DROP TRIGGER IF EXISTS label_templates_updated_at ON label_templates;
CREATE TRIGGER label_templates_updated_at
  BEFORE UPDATE ON label_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ========================================
-- 4. BACKFILL: 2 templates ZPL default por org
-- ========================================
-- NOT EXISTS hace la inserción idempotente: si ya hay algún template ZPL para
-- la org (incluido por re-run de la migración), no inserta nada.

INSERT INTO label_templates (organization_id, nombre, formato, ancho_mm, alto_mm, dpi, template, es_default, notas)
SELECT
  o.id,
  'ZPL 50x30 estándar',
  'ZPL',
  50,
  30,
  203,
  E'^XA\n^PW400\n^LL240\n^CI28\n^FO20,15^A0N,28,28^FD{{nombre}}^FS\n^FO20,55^BY2,2,80^BCN,80,N,N,N^FD{{barcode}}^FS\n^FO20,150^A0N,22,22^FD{{codigo}}^FS\n^FO230,150^A0N,32,32^FD${{precio}}^FS\n^XZ',
  true,
  'Plantilla por defecto: nombre arriba, Code128, código y precio en la base.'
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM label_templates lt
  WHERE lt.organization_id = o.id AND lt.formato = 'ZPL'
);

INSERT INTO label_templates (organization_id, nombre, formato, ancho_mm, alto_mm, dpi, template, es_default, notas)
SELECT
  o.id,
  'ZPL 38x25 compacto',
  'ZPL',
  38,
  25,
  203,
  E'^XA\n^PW304\n^LL200\n^CI28\n^FO15,10^A0N,22,22^FD{{nombre}}^FS\n^FO15,40^BY2,2,60^BCN,60,N,N,N^FD{{barcode}}^FS\n^FO15,120^A0N,24,24^FD${{precio}}^FS\n^XZ',
  false,
  'Compacta: nombre + barcode + precio. Sin código separado.'
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM label_templates lt
  WHERE lt.organization_id = o.id
    AND lt.formato = 'ZPL'
    AND lt.nombre = 'ZPL 38x25 compacto'
);
