-- 346: inscripcion a la beta de Android dentro de la app.
--
-- Aditiva y re-ejecutable. Sin BEGIN/COMMIT (db-run.mjs hace dry-run en una
-- transaccion propia). No toca tablas existentes.
--
-- Google Play no tiene API para agregar testers a una prueba cerrada: la lista
-- de correos se carga a mano en Play Console. Esta tabla es la cola de ese
-- trabajo: el usuario deja el correo de su cuenta de Google desde STApp y el
-- superadmin la copia a Play Console y marca la fila como AGREGADO.
--
-- Una fila por usuario (user_id UNIQUE): volver a anotarse actualiza el correo.
-- Estados: PENDIENTE (esperando que lo agreguen), AGREGADO (ya esta en la lista
-- de Play, puede aceptar la invitacion), DESCARTADO (el superadmin lo saco).
--
-- Solo el service role la toca (supabaseAdmin): RLS activo y SIN policies,
-- ademas REVOKE a anon/authenticated para que PostgREST no la exponga. Guarda
-- correos de usuarios de TODOS los talleres.

CREATE TABLE IF NOT EXISTS android_beta_testers (
  id              TEXT PRIMARY KEY DEFAULT generate_cuid(),
  user_id         TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  estado          TEXT NOT NULL DEFAULT 'PENDIENTE'
                  CHECK (estado IN ('PENDIENTE', 'AGREGADO', 'DESCARTADO')),
  agregado_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS android_beta_testers_estado_idx
  ON android_beta_testers (estado);

CREATE INDEX IF NOT EXISTS android_beta_testers_org_idx
  ON android_beta_testers (organization_id);

DROP TRIGGER IF EXISTS android_beta_testers_updated_at ON android_beta_testers;
CREATE TRIGGER android_beta_testers_updated_at
  BEFORE UPDATE ON android_beta_testers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE android_beta_testers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.android_beta_testers FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE android_beta_testers IS
  'Cola de inscriptos a la beta de Android. Una fila por usuario. El superadmin copia los PENDIENTE a la lista de testers de Play Console y los marca AGREGADO. Solo service role. v346.';
