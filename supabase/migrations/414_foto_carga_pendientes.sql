-- 414: carga de fotos desde el celular cuando la orden todavía no existe (formulario de alta y recepción).
--
-- La 413 ata cada sesión a una orden. En el alta la orden no existe: la sesión queda sin orden y las
-- fotos que sube el celular se guardan acá, en tránsito, hasta que la PC que mostró el QR las retira
-- y las suma al formulario. Recién al crear la orden pasan a fotos_orden por el camino de siempre.
--
-- Reglas:
--   1. Una sesión sin orden (orden_id NULL) nunca escribe en fotos_orden: solo deja fotos en tránsito.
--   2. Las fotos en tránsito mueren con su sesión (ON DELETE CASCADE) y se borran al ser retiradas.
--   3. Solo el backend (service_role) toca la tabla.
--
-- Aditiva salvo un DROP NOT NULL (cambio de catálogo, sin reescritura de tabla).
-- Numeración: 411 y 412 están tomadas por ramas sin mergear.

ALTER TABLE public.foto_carga_sesiones ALTER COLUMN orden_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS public.foto_carga_pendientes (
  id          TEXT PRIMARY KEY DEFAULT generate_cuid(),
  sesion_id   TEXT NOT NULL REFERENCES foto_carga_sesiones(id) ON DELETE CASCADE,
  mime        TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  -- Base64 sin prefijo. Tope ~5 MB de imagen: lo mismo que acepta la subida normal.
  data        TEXT NOT NULL CHECK (char_length(data) <= 7000000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS foto_carga_pendientes_sesion_idx
  ON public.foto_carga_pendientes (sesion_id, created_at);

ALTER TABLE public.foto_carga_pendientes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS foto_carga_pendientes_all_service ON public.foto_carga_pendientes;
CREATE POLICY foto_carga_pendientes_all_service ON public.foto_carga_pendientes
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.foto_carga_pendientes FROM PUBLIC, anon, authenticated;
