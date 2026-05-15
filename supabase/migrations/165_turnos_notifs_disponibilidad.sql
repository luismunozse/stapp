-- ============================================
-- Migration 165: Notificaciones, disponibilidad y recurrencia para turnos
-- ============================================

-- ============================================
-- 1) Log de notificaciones de turnos
-- ============================================
-- Tabla separada de notification_logs porque turnos pueden tener
-- cliente_snapshot (sin cliente_id NOT NULL como exige notification_logs).
CREATE TABLE IF NOT EXISTS turno_notificaciones (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  turno_id TEXT NOT NULL REFERENCES turnos(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  -- 'confirmacion' | 'recordatorio_24h' | 'recordatorio_1h'
  -- | 'reprogramado' | 'cancelado' | 'tecnico_en_camino'
  canal TEXT NOT NULL, -- 'whatsapp' | 'email'
  destinatario TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'ENVIADO', -- 'ENVIADO' | 'FALLIDO' | 'PENDIENTE'
  contenido TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS turno_notif_turno_idx
  ON turno_notificaciones(turno_id, created_at DESC);
CREATE INDEX IF NOT EXISTS turno_notif_org_tipo_idx
  ON turno_notificaciones(organization_id, tipo, created_at DESC);
CREATE INDEX IF NOT EXISTS turno_notif_turno_tipo_idx
  ON turno_notificaciones(turno_id, tipo);

ALTER TABLE turno_notificaciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org turno notifs" ON turno_notificaciones
  FOR SELECT USING (organization_id = public.get_current_organization_id());

CREATE POLICY "Users can manage org turno notifs" ON turno_notificaciones
  FOR ALL USING (organization_id = public.get_current_organization_id());

-- ============================================
-- 2) Horario laboral del técnico
-- ============================================
-- JSONB con estructura:
-- {
--   "lun": [{"de":"09:00","a":"13:00"},{"de":"14:00","a":"18:00"}],
--   "mar": [...], "mie": [...], "jue": [...], "vie": [...],
--   "sab": [], "dom": []
-- }
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS horario_laboral JSONB;

COMMENT ON COLUMN users.horario_laboral IS
  'Franjas horarias laborales por día de la semana. Usado para validar disponibilidad al agendar turnos.';

-- ============================================
-- 3) Recurrencia en turnos (mantenimiento periódico)
-- ============================================
-- Cuando un turno se agenda con recurrencia se crean varias filas
-- compartiendo serie_id. Cada fila es independiente (se puede cancelar
-- una sola sin afectar la serie).
ALTER TABLE turnos
  ADD COLUMN IF NOT EXISTS serie_id TEXT,
  ADD COLUMN IF NOT EXISTS recurrencia JSONB;
-- recurrencia ej:
-- {"frecuencia":"semanal","intervalo":2,"hasta":"2026-12-31","total":24}
-- frecuencia: 'diaria'|'semanal'|'mensual'

CREATE INDEX IF NOT EXISTS turnos_serie_idx
  ON turnos(organization_id, serie_id)
  WHERE serie_id IS NOT NULL;

COMMENT ON COLUMN turnos.serie_id IS
  'Identifica una serie de turnos recurrentes (mantenimiento preventivo).';
COMMENT ON COLUMN turnos.recurrencia IS
  'Config original de recurrencia (sólo en la primera ocurrencia de la serie).';
