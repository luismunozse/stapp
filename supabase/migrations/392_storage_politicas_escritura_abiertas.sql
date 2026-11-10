-- Storage: borrar las políticas de escritura y lectura abiertas que quedaron
-- en producción con nombres distintos a los del repo.
--
-- La 390 marcó privados los buckets firmas, fotos-ordenes, comprobantes-gastos
-- y soporte-attachments y borró las políticas por su nombre del repo. En
-- producción esas políticas se habían creado a mano con otros nombres, así que
-- siguieron vivas: lectura de firmas y fotos-ordenes para cualquier rol, y
-- alta/baja/edición sobre firmas, fotos-ordenes y logos para los roles
-- public (incluye anon) y authenticated.
--
-- La app sube, lee y borra archivos solo desde el servidor con service_role,
-- que no pasa por RLS. Desde el navegador la anon key se usa únicamente para
-- realtime. Ninguna de estas políticas hace falta.
--
-- Quedan sin tocar las de lectura de los buckets públicos (avatars,
-- fotos-inventario, logos).

SET LOCAL lock_timeout = '3s';

-- Lectura de buckets que ya son privados.
DROP POLICY IF EXISTS "Public read firmas" ON storage.objects;
DROP POLICY IF EXISTS "Public read fotos" ON storage.objects;

-- Alta y baja para el rol public (incluye anon).
DROP POLICY IF EXISTS "Service upload firmas" ON storage.objects;
DROP POLICY IF EXISTS "Service upload fotos" ON storage.objects;
DROP POLICY IF EXISTS "Service upload logos" ON storage.objects;
DROP POLICY IF EXISTS "Service delete firmas" ON storage.objects;
DROP POLICY IF EXISTS "Service delete fotos" ON storage.objects;
DROP POLICY IF EXISTS "Service delete logos" ON storage.objects;

-- Alta, edición y baja para authenticated.
DROP POLICY IF EXISTS "Authenticated can upload signatures" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can upload order photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can upload logos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can update logos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can delete signatures" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can delete order photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can delete logos" ON storage.objects;
