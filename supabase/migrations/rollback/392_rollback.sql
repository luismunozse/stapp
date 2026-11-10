-- Rollback de storage_politicas_escritura_abiertas (392): recrea las políticas tal como estaban en producción.
-- Reabre la escritura anónima sobre Storage: usar solo si algo dejó de andar.

SET LOCAL lock_timeout = '3s';

CREATE POLICY "Public read firmas" ON storage.objects FOR SELECT TO public USING (bucket_id = 'firmas');
CREATE POLICY "Public read fotos" ON storage.objects FOR SELECT TO public USING (bucket_id = 'fotos-ordenes');

CREATE POLICY "Service upload firmas" ON storage.objects FOR INSERT TO public WITH CHECK (bucket_id = 'firmas');
CREATE POLICY "Service upload fotos" ON storage.objects FOR INSERT TO public WITH CHECK (bucket_id = 'fotos-ordenes');
CREATE POLICY "Service upload logos" ON storage.objects FOR INSERT TO public WITH CHECK (bucket_id = 'logos');
CREATE POLICY "Service delete firmas" ON storage.objects FOR DELETE TO public USING (bucket_id = 'firmas');
CREATE POLICY "Service delete fotos" ON storage.objects FOR DELETE TO public USING (bucket_id = 'fotos-ordenes');
CREATE POLICY "Service delete logos" ON storage.objects FOR DELETE TO public USING (bucket_id = 'logos');

CREATE POLICY "Authenticated can upload signatures" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'firmas');
CREATE POLICY "Authenticated can upload order photos" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'fotos-ordenes');
CREATE POLICY "Authenticated can upload logos" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'logos');
CREATE POLICY "Authenticated can update logos" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'logos');
CREATE POLICY "Authenticated can delete signatures" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'firmas');
CREATE POLICY "Authenticated can delete order photos" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'fotos-ordenes');
CREATE POLICY "Authenticated can delete logos" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'logos');
