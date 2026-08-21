-- Estado de salud de servicios de plataforma (no por organización).
--
-- Contexto: el servidor Evolution compartido estuvo caído ~23h (2026-07-28 22:11
-- UTC en adelante) sin que nadie se enterara. El estado por org en
-- whatsapp_config sólo se refrescaba cuando un admin abría la pantalla de
-- configuración, así que seguía diciendo "open" semanas después de la caída.
--
-- Esta tabla guarda una fila por servicio para que el cron de health check pueda
-- distinguir "se acaba de caer" de "sigue caído" y no mandar una alerta por hora
-- durante todo un corte.

CREATE TABLE IF NOT EXISTS platform_health_state (
  -- Identificador del servicio monitoreado, ej. 'evolution'
  service TEXT PRIMARY KEY,
  -- 'up' | 'down'
  state TEXT NOT NULL,
  -- Último detalle de error observado (para el mail de alerta)
  last_error TEXT,
  -- Cuándo se observó el estado actual por última vez
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Cuándo se cambió de estado (up->down o down->up)
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Cuándo se mandó la última alerta al superadmin (throttle)
  last_alert_at TIMESTAMPTZ
);

COMMENT ON TABLE platform_health_state IS
  'Salud de servicios compartidos de plataforma. Escrita sólo por /api/cron/whatsapp-health con service_role.';

-- Sin políticas de acceso para usuarios: es infraestructura de plataforma y se
-- escribe/lee exclusivamente con la service_role key desde los cron. RLS activo
-- y sin policies deja la tabla inaccesible para anon/authenticated.
ALTER TABLE platform_health_state ENABLE ROW LEVEL SECURITY;
