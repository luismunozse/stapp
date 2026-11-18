-- Rollback of 414 (fotos desde el celular sin orden): removes foto_carga_pendientes and makes
-- foto_carga_sesiones.orden_id mandatory again.
--
-- WHAT IS LOST: photos in transit (uploaded from a phone and not yet picked up by the form) and the
-- order-less sessions, which are deleted so the NOT NULL can be restored. Photos already in
-- fotos_orden are NOT touched.
--
-- Run it only after the code that reads these is reverted.

SET LOCAL lock_timeout = '3s';

DROP TABLE IF EXISTS public.foto_carga_pendientes;
DELETE FROM public.foto_carga_sesiones WHERE orden_id IS NULL;
ALTER TABLE public.foto_carga_sesiones ALTER COLUMN orden_id SET NOT NULL;
