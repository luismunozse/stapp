-- ============================================
-- Migration 040: Enhanced Order Tracking Portal
-- ============================================

-- Tabla de eventos de orden (timeline detallado)
CREATE TABLE IF NOT EXISTS orden_eventos (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  orden_id TEXT REFERENCES ordenes_servicio(id) ON DELETE CASCADE NOT NULL,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  tipo text NOT NULL, -- CAMBIO_ESTADO, FOTO_AGREGADA, PRESUPUESTO_DEFINIDO, PRESUPUESTO_APROBADO, NOTA, REPUESTO_AGREGADO
  estado_anterior text,
  estado_nuevo text,
  descripcion text,
  metadata jsonb DEFAULT '{}',
  created_by TEXT REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_orden_eventos_orden ON orden_eventos(orden_id);
CREATE INDEX idx_orden_eventos_org ON orden_eventos(organization_id);
CREATE INDEX idx_orden_eventos_created ON orden_eventos(created_at DESC);

-- Campos de aprobación de presupuesto desde portal
ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS presupuesto_aprobado_portal boolean DEFAULT false;
ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS presupuesto_firma_url text;
ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS presupuesto_firma_path text;
ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS presupuesto_fecha_aprobacion timestamptz;

-- Colores de branding para páginas públicas
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS brand_color_primary text DEFAULT '#3b82f6';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS brand_color_secondary text DEFAULT '#1d4ed8';

-- RLS para orden_eventos
ALTER TABLE orden_eventos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_eventos_select" ON orden_eventos
  FOR SELECT USING (organization_id IN (
    SELECT organization_id FROM users WHERE id = auth.uid()::text
  ));

CREATE POLICY "org_eventos_insert" ON orden_eventos
  FOR INSERT WITH CHECK (organization_id IN (
    SELECT organization_id FROM users WHERE id = auth.uid()::text
  ));
