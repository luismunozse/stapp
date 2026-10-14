-- ============================================================================
-- 282: bucket privado para las fotos en staging del handoff por QR
-- ============================================================================
-- public=false: a diferencia de fotos-ordenes, estos objetos no se sirven por
-- URL. La PC los pide por un endpoint autenticado que devuelve base64, así que
-- el objeto nunca tiene una URL alcanzable.
--
-- Los topes viven también acá y no solo en el handler: reencodeFoto siempre
-- emite JPEG, así que el bucket rechaza por sí mismo cualquier otra cosa aunque
-- un día el código se equivoque.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('foto-borrador', 'foto-borrador', false, 2097152, ARRAY['image/jpeg'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
