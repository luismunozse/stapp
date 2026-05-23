-- ============================================
-- EMAIL TEMPLATES + KILL SWITCH
-- ----------------------------------------------
-- Templates de emails de lifecycle editables desde superadmin.
-- Kill switch: cron sólo envía si status='PUBLISHED'.
-- Tipos existentes seedeados como PUBLISHED con html_body='' para
-- preservar el comportamiento actual (fallback al template hardcoded).
-- Tipos nuevos (GHOST, WIN_BACK_EXLIMBO, RE_ENGAGEMENT_INACTIVE) quedan
-- en DRAFT: NO se envían hasta que se editen y se publiquen.
-- ============================================

CREATE TABLE IF NOT EXISTS email_templates (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  type TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (category IN ('onboarding','conversion','retention','engagement','reactivation')),
  label TEXT NOT NULL,
  description TEXT,
  subject TEXT NOT NULL,
  html_body TEXT NOT NULL,
  variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  notes TEXT,
  custom_overrides BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);

CREATE INDEX IF NOT EXISTS email_templates_status_idx ON email_templates(status);
CREATE INDEX IF NOT EXISTS email_templates_category_idx ON email_templates(category);

-- RLS: solo service_role
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_email_templates" ON email_templates FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Audit history
CREATE TABLE IF NOT EXISTS email_template_history (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  template_id TEXT NOT NULL REFERENCES email_templates(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  subject TEXT NOT NULL,
  html_body TEXT NOT NULL,
  status_before TEXT,
  status_after TEXT,
  action TEXT NOT NULL CHECK (action IN ('CREATED','EDITED','PUBLISHED','UNPUBLISHED','ARCHIVED')),
  changed_by TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS email_template_history_template_idx ON email_template_history(template_id, changed_at DESC);
ALTER TABLE email_template_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_email_template_history" ON email_template_history FOR ALL TO service_role USING (true) WITH CHECK (true);

-- SEED: tipos existentes ya en producción → PUBLISHED para no romper crons activos.
-- Subject/html_body se dejan vacíos — el código caerá al fallback hardcoded
-- cuando html_body='' Y status='PUBLISHED', preservando comportamiento actual.
INSERT INTO email_templates (type, category, label, description, subject, html_body, variables, status, notes) VALUES
  ('WELCOME',              'onboarding',   'Bienvenida',                 'Se envía 1 día después del registro', '', '', '["nombre","organizacion","slug"]'::jsonb, 'PUBLISHED', 'Seed: usa fallback hardcoded hasta edición'),
  ('TIP_DAY_3',            'onboarding',   'Tip día 3',                  'Tips de WhatsApp, cotizaciones, tracking', '', '', '["nombre","organizacion","slug"]'::jsonb, 'PUBLISHED', 'Seed: fallback'),
  ('TIP_DAY_7',            'onboarding',   'Tip día 7',                  'Inventario, ventas, garantías, reportes', '', '', '["nombre","organizacion","slug"]'::jsonb, 'PUBLISHED', 'Seed: fallback'),
  ('TIP_DAY_14',           'onboarding',   'Tip día 14',                 'Tips avanzados', '', '', '["nombre","organizacion","slug"]'::jsonb, 'PUBLISHED', 'Seed: fallback'),
  ('TRIAL_EXPIRING_5',     'conversion',   'Trial -5 días',              'Alerta 5 días antes de vencer', '', '', '["nombre","organizacion","slug","diasRestantes"]'::jsonb, 'PUBLISHED', 'Seed: fallback'),
  ('TRIAL_EXPIRING_1',     'conversion',   'Trial -1 día',               'Último día de prueba', '', '', '["nombre","organizacion","slug","diasRestantes"]'::jsonb, 'PUBLISHED', 'Seed: fallback'),
  ('TRIAL_EXPIRED',        'conversion',   'Trial expirado',             'Prueba vencida', '', '', '["nombre","organizacion","slug"]'::jsonb, 'PUBLISHED', 'Seed: fallback'),
  ('TRIAL_AUTO_EXTENDED',  'reactivation', 'Trial auto-extendido',       'Extensión automática activada', '', '', '["nombre","organizacion","slug"]'::jsonb, 'PUBLISHED', 'Seed: fallback'),
  ('TRIAL_LAST_CHANCE',    'reactivation', 'Trial última chance',        'Ya extendido, sin segundo', '', '', '["nombre","organizacion","slug"]'::jsonb, 'PUBLISHED', 'Seed: fallback'),
  ('WIN_BACK_7',           'retention',    'Win-back 7 días',            'Inactividad 7 días', '', '', '["nombre","organizacion","slug"]'::jsonb, 'PUBLISHED', 'Seed: fallback'),
  ('WIN_BACK_30',          'retention',    'Win-back 30 días',           'Inactividad 30 días', '', '', '["nombre","organizacion","slug"]'::jsonb, 'PUBLISHED', 'Seed: fallback'),
  ('MILESTONE',            'engagement',   'Milestone',                  'Hito alcanzado', '', '', '["nombre","organizacion","slug","milestone"]'::jsonb, 'PUBLISHED', 'Seed: fallback'),
  ('TRIAL_REACTIVATION_INVITE','reactivation','Invitación reactivación', 'Trial venció, invita /reactivar', '', '', '["nombre","organizacion","slug","reactivarUrl"]'::jsonb, 'PUBLISHED', 'Seed: usado por trial-management cron'),
  ('TRIAL_DAY_25_REMINDER','conversion',   'Trial día 25',               'Recordatorio 5 días antes (lifecycle-emails)', '', '', '["nombre","organizacion","slug","diasRestantes","billingUrl"]'::jsonb, 'PUBLISHED', 'Seed: usado por lifecycle-emails cron'),
  ('TRIAL_DAY_28_URGENCY', 'conversion',   'Trial día 28 urgencia',      'Urgencia 2 días antes', '', '', '["nombre","organizacion","slug","diasRestantes","billingUrl"]'::jsonb, 'PUBLISHED', 'Seed: usado por lifecycle-emails cron'),
  ('WIN_BACK_EXLIMBO',     'reactivation', 'Ex-limbo win-back',          'Te bajamos a Free, volvé', '', '', '["nombre","organizacion","slug","appUrl","reactivarUrl"]'::jsonb, 'DRAFT', 'NO publicado: editar antes de enviar a 33 ex-limbo'),
  ('RE_ENGAGEMENT_INACTIVE','retention',   'Re-engagement inactivos',    'Org sin actividad 14 días', '', '', '["nombre","organizacion","slug","appUrl"]'::jsonb, 'DRAFT', 'NO publicado'),
  ('GHOST',                'onboarding',   'Ghost (cuenta vacía)',       'Cuenta creada pero sin órdenes/clientes/ventas', '', '', '["nombre","organizacion","slug","accountAgeDays","appUrl"]'::jsonb, 'DRAFT', 'NO publicado: cuenta vacía hace >30 días')
ON CONFLICT (type) DO NOTHING;
