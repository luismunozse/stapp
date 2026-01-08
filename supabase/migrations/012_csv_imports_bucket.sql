-- ========================================
-- CSV IMPORTS STORAGE BUCKET
-- ========================================

-- Crear bucket para archivos de importación (CSV/Excel)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'csv-imports',
  'csv-imports',
  false, -- Privado, solo acceso autenticado
  5242880, -- 5MB max
  ARRAY[
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ========================================
-- POLÍTICAS DE STORAGE PARA CSV-IMPORTS
-- ========================================

-- Estructura: csv-imports/{organization_id}/{uuid}.{csv|xlsx}

-- Upload: Solo usuarios de la organización pueden subir archivos
CREATE POLICY "Org users can upload import files"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'csv-imports' AND
    (storage.foldername(name))[1] = auth.organization_id()
  );

-- Read: Solo usuarios de la organización pueden leer sus archivos
CREATE POLICY "Org users can read their import files"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'csv-imports' AND
    (storage.foldername(name))[1] = auth.organization_id()
  );

-- Delete: Solo usuarios de la organización pueden eliminar sus archivos
CREATE POLICY "Org users can delete their import files"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'csv-imports' AND
    (storage.foldername(name))[1] = auth.organization_id()
  );
