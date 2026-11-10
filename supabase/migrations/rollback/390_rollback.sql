-- Rollback de storage_buckets_privados (migración 390).
--
-- Vuelve a hacer públicos los cuatro buckets y recrea las políticas que borró la
-- 390, con la misma definición que tenían en 003, 035 y 091. Las URLs públicas
-- guardadas en la base vuelven a funcionar. El código nuevo sigue andando con
-- buckets públicos (firmar una URL también funciona en un bucket público), así
-- que este rollback no exige volver atrás el despliegue.

SET LOCAL lock_timeout = '3s';

UPDATE storage.buckets
SET public = true
WHERE id IN ('firmas', 'fotos-ordenes', 'comprobantes-gastos', 'soporte-attachments');

DROP POLICY IF EXISTS "Public read for order photos" ON storage.objects;
CREATE POLICY "Public read for order photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'fotos-ordenes');

DROP POLICY IF EXISTS "Public read for signatures" ON storage.objects;
CREATE POLICY "Public read for signatures"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'firmas');

DROP POLICY IF EXISTS "Public read for comprobantes-gastos" ON storage.objects;
CREATE POLICY "Public read for comprobantes-gastos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'comprobantes-gastos');

DROP POLICY IF EXISTS "soporte_attachments_read" ON storage.objects;
CREATE POLICY "soporte_attachments_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'soporte-attachments');

DROP POLICY IF EXISTS "soporte_attachments_insert" ON storage.objects;
CREATE POLICY "soporte_attachments_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'soporte-attachments');

DROP POLICY IF EXISTS "soporte_attachments_delete" ON storage.objects;
CREATE POLICY "soporte_attachments_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'soporte-attachments');
