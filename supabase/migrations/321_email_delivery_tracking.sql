-- ============================================================================
-- 321: seguimiento de entrega del correo al cliente + lista de supresion
-- ============================================================================
-- Contexto: hasta ahora notification_logs registraba el INTENTO de envio, no
-- el resultado. estado='ENVIADO' significa "el proveedor acepto el POST", no
-- "el correo llego". Nadie volvia a tocar la fila: si un aviso rebotaba, el
-- taller no se enteraba nunca.
--
-- POR QUE NO SE EXTIENDE EL ENUM estado_notificacion
-- Dos motivos. Primero, scripts/db-run.mjs manda el archivo como multi-command
-- string y PostgreSQL rechaza ALTER TYPE ... ADD en ese contexto. Segundo, y
-- mas importante: son dos hechos distintos. `estado` responde "lo acepto el
-- proveedor"; `estado_entrega` responde "que paso despues". Separarlos deja
-- intacta la semantica de estado y a todos sus consumidores.
--
-- POR QUE LA SUPRESION ES GLOBAL Y NO POR ORGANIZACION
-- Las organizaciones comparten el subdominio de envio avisos.stapp.com.ar, asi
-- que comparten reputacion. Si la organizacion A cobra un hard bounce y la B
-- sigue pegandole a esa misma casilla inexistente, el que se degrada es el
-- dominio de todas. organization_id queda para auditoria -saber quien origino
-- la supresion- pero la CONSULTA es por email solo.
-- ============================================================================

-- ── notification_logs: resultado post-envio ────────────────────────────────

ALTER TABLE notification_logs
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT,
  ADD COLUMN IF NOT EXISTS proveedor TEXT NOT NULL DEFAULT 'envialosimple',
  ADD COLUMN IF NOT EXISTS estado_entrega TEXT,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bounced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bounce_tipo TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notification_logs_estado_entrega_check'
  ) THEN
    ALTER TABLE notification_logs
      ADD CONSTRAINT notification_logs_estado_entrega_check
      CHECK (estado_entrega IS NULL OR estado_entrega IN ('ENTREGADO', 'REBOTADO', 'QUEJA'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notification_logs_bounce_tipo_check'
  ) THEN
    ALTER TABLE notification_logs
      ADD CONSTRAINT notification_logs_bounce_tipo_check
      CHECK (bounce_tipo IS NULL OR bounce_tipo IN ('HARD', 'SOFT', 'QUEJA'));
  END IF;
END $$;

-- El webhook busca por este id en cada evento. Sin indice hace full scan de
-- toda la tabla por evento recibido. Parcial porque las filas viejas lo tienen
-- en NULL y no se van a consultar nunca.
CREATE INDEX IF NOT EXISTS notification_logs_provider_msg_idx
  ON notification_logs (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

COMMENT ON COLUMN notification_logs.provider_message_id IS
  'Id que asigno el proveedor al aceptar el envio. Clave de correlacion con el webhook. Hasta la 321 vivia dentro de metadata, que es TEXT y no se puede indexar.';
COMMENT ON COLUMN notification_logs.proveedor IS
  'Proveedor que curso el envio: envialosimple o resend. Necesaria mientras el kill switch permita que convivan filas de ambos.';
COMMENT ON COLUMN notification_logs.estado_entrega IS
  'Resultado POSTERIOR al envio, informado por webhook: ENTREGADO, REBOTADO o QUEJA. NULL = todavia sin novedades. Distinto de estado, que solo dice si el proveedor acepto el POST.';
COMMENT ON COLUMN notification_logs.bounce_tipo IS
  'HARD, SOFT o QUEJA. Cubre tambien la queja por spam a proposito: operativamente es el mismo hecho (esta direccion no debe recibir mas correo) y duplicar columnas solo para la queja agregaria estado sin agregar informacion.';

-- ── email_suprimidos: direcciones que no deben recibir mas correo ──────────

CREATE TABLE IF NOT EXISTS email_suprimidos (
  id                  TEXT PRIMARY KEY DEFAULT generate_cuid(),
  email               TEXT NOT NULL,
  motivo              TEXT NOT NULL,
  proveedor           TEXT,
  organization_id     TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  notification_log_id TEXT REFERENCES notification_logs(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT email_suprimidos_motivo_check
    CHECK (motivo IN ('HARD_BOUNCE', 'QUEJA', 'MANUAL'))
);

-- La consulta del envio es por email, case-insensitive. El unique tambien
-- hace idempotente el ON CONFLICT DO NOTHING del webhook ante reintentos.
CREATE UNIQUE INDEX IF NOT EXISTS email_suprimidos_email_idx
  ON email_suprimidos (lower(email));

COMMENT ON TABLE email_suprimidos IS
  'Direcciones a las que no se envia mas correo al cliente. GLOBAL, no por organizacion: todas comparten el subdominio avisos.stapp.com.ar y por lo tanto la reputacion. organization_id es solo auditoria de quien la origino.';

-- Tabla global sin organization_id obligatorio: expuesta via PostgREST
-- filtraria direcciones de clientes de TODAS las organizaciones. Solo la
-- service role la toca.
ALTER TABLE email_suprimidos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON email_suprimidos FROM anon, authenticated;
