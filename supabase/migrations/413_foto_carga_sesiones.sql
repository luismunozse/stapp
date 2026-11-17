-- 413: sesiones para cargar fotos de una orden desde el celular con un enlace temporal (QR).
--
-- Desde la PC un usuario con permiso sobre la orden genera un enlace que vence; quien lo abre
-- (sin login) solo puede subir fotos a ESA orden, hasta un tope, mientras la sesión siga viva.
--
-- Reglas que viven en la base:
--   1. Solo se guarda el hash (SHA-256) del token: una lectura de la tabla no sirve para subir.
--   2. Una sesión vale mientras no venció ni fue revocada y le queda cupo.
--   3. El cupo se reserva de forma atómica ANTES de subir (reservar_foto_carga_sesion) y se
--      devuelve si la subida falla (liberar_foto_carga_sesion): dos subidas simultáneas no pasan el tope.
--
-- Aditiva: tabla nueva y dos funciones. No toca tablas existentes.
-- Numeración: 410 está en main y 412 en feat/multimoneda-s5; se usa 413 para no pisarlas.

CREATE TABLE IF NOT EXISTS public.foto_carga_sesiones (
  id              TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  orden_id        TEXT NOT NULL REFERENCES ordenes_servicio(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  tipo            TEXT NOT NULL DEFAULT 'REPARACION'
                  CHECK (tipo IN ('INGRESO', 'DIAGNOSTICO', 'COMPONENTE', 'REPARACION', 'ENTREGA')),
  max_fotos       INT NOT NULL DEFAULT 30 CHECK (max_fotos BETWEEN 1 AND 100),
  fotos_subidas   INT NOT NULL DEFAULT 0 CHECK (fotos_subidas >= 0),
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS foto_carga_sesiones_orden_idx ON public.foto_carga_sesiones (orden_id);
CREATE INDEX IF NOT EXISTS foto_carga_sesiones_expires_idx ON public.foto_carga_sesiones (expires_at);

-- Solo el backend (service_role) la toca: guarda credenciales de subida.
ALTER TABLE public.foto_carga_sesiones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS foto_carga_sesiones_all_service ON public.foto_carga_sesiones;
CREATE POLICY foto_carga_sesiones_all_service ON public.foto_carga_sesiones
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.foto_carga_sesiones FROM PUBLIC, anon, authenticated;

-- Reserva un lugar del cupo si la sesión sigue viva. Sin filas = enlace inválido, vencido,
-- revocado o sin cupo (el llamador no distingue: no se le da pistas a quien prueba tokens).
CREATE OR REPLACE FUNCTION public.reservar_foto_carga_sesion(p_token_hash TEXT)
RETURNS TABLE (id TEXT, organization_id TEXT, orden_id TEXT, tipo TEXT)
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.foto_carga_sesiones s
     SET fotos_subidas = s.fotos_subidas + 1
   WHERE s.token_hash = p_token_hash
     AND s.revoked_at IS NULL
     AND s.expires_at > now()
     AND s.fotos_subidas < s.max_fotos
  RETURNING s.id, s.organization_id, s.orden_id, s.tipo;
$$;

-- Devuelve el lugar reservado cuando la subida no se concretó.
CREATE OR REPLACE FUNCTION public.liberar_foto_carga_sesion(p_sesion_id TEXT)
RETURNS VOID
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.foto_carga_sesiones
     SET fotos_subidas = fotos_subidas - 1
   WHERE id = p_sesion_id AND fotos_subidas > 0;
$$;

REVOKE EXECUTE ON FUNCTION public.reservar_foto_carga_sesion(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reservar_foto_carga_sesion(TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.liberar_foto_carga_sesion(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liberar_foto_carga_sesion(TEXT) TO service_role;
