-- Buckets privados: firmas, fotos-ordenes, comprobantes-gastos y soporte-attachments.
--
-- Estos buckets guardan firmas de clientes, fotos de equipos, comprobantes de
-- gastos y adjuntos de soporte. Hasta ahora eran públicos. La app los lee y
-- escribe solo desde el servidor con service_role (que no pasa por RLS) y
-- entrega a la UI URLs firmadas que vencen (lib/storage-privado.ts).
--
-- Esta migración:
--   * marca los cuatro buckets como privados (sin URL pública);
--   * borra las políticas de lectura pública de los cuatro y las de alta/baja
--     abiertas de soporte-attachments.
-- Las políticas de alta/baja por organización de fotos-ordenes y firmas (003)
-- quedan como estaban.
--
-- ORDEN: desplegar primero el código que firma las URLs y después aplicar esta
-- migración. Con el código anterior en línea, las fotos, adjuntos y
-- comprobantes dejan de verse apenas se aplica.

SET LOCAL lock_timeout = '3s';

UPDATE storage.buckets
SET public = false
WHERE id IN ('firmas', 'fotos-ordenes', 'comprobantes-gastos', 'soporte-attachments');

DROP POLICY IF EXISTS "Public read for order photos" ON storage.objects;
DROP POLICY IF EXISTS "Public read for signatures" ON storage.objects;
DROP POLICY IF EXISTS "Public read for comprobantes-gastos" ON storage.objects;
DROP POLICY IF EXISTS "soporte_attachments_read" ON storage.objects;
DROP POLICY IF EXISTS "soporte_attachments_insert" ON storage.objects;
DROP POLICY IF EXISTS "soporte_attachments_delete" ON storage.objects;
