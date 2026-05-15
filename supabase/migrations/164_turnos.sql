-- ============================================
-- Migration 164: Turnos (agenda) y pre-orden
-- ============================================
-- Turno = visita/cita programada (servicios on-site:
-- gastronómico, refrigeración, heladería, etc.).
-- Recepción agenda primero el turno (datos mínimos).
-- Al realizarse la visita, se genera una orden de servicio
-- copiando datos del turno (sin re-ingresar info).
-- Una orden puede tener múltiples turnos (visita diagnóstico
-- + visita reparación = misma orden).
-- ============================================

CREATE TABLE IF NOT EXISTS turnos (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Cliente (opcional al crear el turno: puede ser cliente nuevo no registrado aún)
  cliente_id TEXT REFERENCES clientes(id) ON DELETE SET NULL,
  cliente_snapshot JSONB,
  -- ej: {"nombre":"Bar La Esquina","telefono":"+541133334444","email":null}

  -- Asignación
  tecnico_id TEXT REFERENCES users(id) ON DELETE SET NULL,

  -- Ventana de la visita
  inicio TIMESTAMPTZ NOT NULL,
  fin TIMESTAMPTZ,
  direccion TEXT,

  -- Tipo de turno
  tipo TEXT NOT NULL DEFAULT 'visita_diagnostico',
  -- 'visita_diagnostico' | 'reparacion_onsite' | 'retiro' | 'entrega' | 'mantenimiento'

  -- Datos del equipo (se copian a la orden al confirmarse)
  tipo_dispositivo TEXT,
  marca TEXT,
  modelo TEXT,
  problema_reportado TEXT,
  fotos_previas TEXT[] DEFAULT '{}',

  -- Workflow
  estado TEXT NOT NULL DEFAULT 'agendado',
  -- 'agendado' | 'confirmado' | 'en_camino' | 'realizado'
  -- | 'orden_generada' | 'cancelado' | 'no_show'

  -- Vínculo con orden generada (se llena al hacer "Generar orden")
  orden_id TEXT REFERENCES ordenes_servicio(id) ON DELETE SET NULL,

  notas TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT turnos_fin_after_inicio CHECK (fin IS NULL OR fin > inicio),
  CONSTRAINT turnos_cliente_o_snapshot CHECK (
    cliente_id IS NOT NULL OR cliente_snapshot IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS turnos_org_inicio_idx
  ON turnos(organization_id, inicio);
CREATE INDEX IF NOT EXISTS turnos_org_estado_inicio_idx
  ON turnos(organization_id, estado, inicio);
CREATE INDEX IF NOT EXISTS turnos_tecnico_inicio_idx
  ON turnos(tecnico_id, inicio)
  WHERE tecnico_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS turnos_orden_idx
  ON turnos(orden_id)
  WHERE orden_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS turnos_cliente_idx
  ON turnos(cliente_id)
  WHERE cliente_id IS NOT NULL;

CREATE TRIGGER turnos_updated_at
  BEFORE UPDATE ON turnos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- RLS
-- ============================================
ALTER TABLE turnos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org turnos" ON turnos
  FOR SELECT USING (organization_id = public.get_current_organization_id());

CREATE POLICY "Users can manage org turnos" ON turnos
  FOR ALL USING (organization_id = public.get_current_organization_id());

-- ============================================
-- Toggle de módulo agenda por organización
-- ============================================
-- Se activa por rubro (servicios on-site lo necesitan,
-- reparación de celulares en local no).
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS modulo_agenda BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN organizations.modulo_agenda IS
  'Si está activo, la org usa /agenda para programar turnos (visitas on-site) antes de crear orden.';

-- ============================================
-- Trigger: cuando se genera la orden desde un turno,
-- sincronizar estado del turno
-- ============================================
CREATE OR REPLACE FUNCTION sync_turno_on_orden_link()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.orden_id IS NOT NULL AND (OLD.orden_id IS NULL OR OLD.orden_id <> NEW.orden_id) THEN
    NEW.estado := 'orden_generada';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER turnos_sync_orden_link
  BEFORE UPDATE OF orden_id ON turnos
  FOR EACH ROW EXECUTE FUNCTION sync_turno_on_orden_link();
