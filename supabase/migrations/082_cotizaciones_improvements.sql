-- =============================================
-- 082: Cotizaciones Improvements
-- Adds: soft-delete, rejection reason, read tracking,
-- templates, PDF cache, venta link, multi-currency
-- =============================================

-- 1. Soft-delete
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_cotizaciones_active ON cotizaciones(organization_id) WHERE deleted_at IS NULL;

-- 2. Rejection reason
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS motivo_rechazo TEXT DEFAULT NULL;

-- 3. Read confirmation tracking
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS visto_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS visto_count INTEGER DEFAULT 0;

-- 4. PDF cache reference
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS pdf_cache_path TEXT DEFAULT NULL;

-- 5. Link cotizacion → venta
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS venta_id TEXT DEFAULT NULL;

-- 6. Multi-currency support
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS tipo_cambio DECIMAL DEFAULT NULL;
ALTER TABLE items_cotizacion ADD COLUMN IF NOT EXISTS moneda_item TEXT DEFAULT NULL;

-- 7. Templates tables
CREATE TABLE IF NOT EXISTS cotizacion_templates (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  nombre TEXT NOT NULL,
  descripcion TEXT,
  notas TEXT,
  terminos TEXT,
  descuento_global_tipo TEXT DEFAULT 'porcentaje',
  descuento_global_valor DECIMAL DEFAULT 0,
  iva_porcentaje DECIMAL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS items_template_cotizacion (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  template_id TEXT NOT NULL REFERENCES cotizacion_templates(id) ON DELETE CASCADE,
  descripcion TEXT NOT NULL,
  cantidad INTEGER NOT NULL DEFAULT 1,
  precio_unitario DECIMAL NOT NULL DEFAULT 0,
  unidad TEXT DEFAULT 'Unidad',
  descuento_tipo TEXT DEFAULT 'porcentaje',
  descuento_valor DECIMAL DEFAULT 0,
  orden INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_cotizacion_templates_org ON cotizacion_templates(organization_id);
CREATE INDEX IF NOT EXISTS idx_items_template_cotizacion_template ON items_template_cotizacion(template_id);

-- 8. RLS for templates
ALTER TABLE cotizacion_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE items_template_cotizacion ENABLE ROW LEVEL SECURITY;

-- Admin full access to templates via supabaseAdmin (service role bypasses RLS)
-- These policies are for potential future direct client access
CREATE POLICY "cotizacion_templates_org_read" ON cotizacion_templates
  FOR SELECT USING (true);

CREATE POLICY "cotizacion_templates_org_write" ON cotizacion_templates
  FOR ALL USING (true);

CREATE POLICY "items_template_cotizacion_read" ON items_template_cotizacion
  FOR SELECT USING (true);

CREATE POLICY "items_template_cotizacion_write" ON items_template_cotizacion
  FOR ALL USING (true);
