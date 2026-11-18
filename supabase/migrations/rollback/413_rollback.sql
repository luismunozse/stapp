-- Rollback of 413 (carga de fotos desde el celular): removes foto_carga_sesiones and its two functions.
--
-- WHAT IS LOST: the upload sessions (short-lived links). The photos already uploaded through them
-- live in fotos_orden and are NOT touched.
--
-- Run it only after the code that reads these is reverted.

SET LOCAL lock_timeout = '3s';

DROP FUNCTION IF EXISTS public.reservar_foto_carga_sesion(TEXT);
DROP FUNCTION IF EXISTS public.liberar_foto_carga_sesion(TEXT);
DROP TABLE IF EXISTS public.foto_carga_sesiones;
