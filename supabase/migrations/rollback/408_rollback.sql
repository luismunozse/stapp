-- Rollback of 408 (diagrama de daños): removes orden_danos, its triggers/RPC and the two config columns.
--
-- WHAT IS LOST: every orden_danos row (recepción and diagnóstico pins), every
-- ordenes_servicio.recepcion_sin_danos flag and organizations.danos_recepcion_obligatorio. Export first if used:
--
--   SELECT * FROM orden_danos;
--   SELECT id, recepcion_sin_danos FROM ordenes_servicio WHERE recepcion_sin_danos;
--   SELECT id, danos_recepcion_obligatorio FROM organizations WHERE danos_recepcion_obligatorio;
--
-- Run it only after the code that reads these is reverted.
-- LOCKS: ACCESS EXCLUSIVE on ordenes_servicio and organizations until the transaction ends; run it off-peak.

SET LOCAL lock_timeout = '3s';

DROP TRIGGER IF EXISTS ordenes_servicio_sin_danos_check ON public.ordenes_servicio;
DROP FUNCTION IF EXISTS public.ordenes_servicio_sin_danos_check();
DROP FUNCTION IF EXISTS public.registrar_estado_fisico_recepcion(TEXT, TEXT, JSONB, BOOLEAN, TEXT);

-- Dropping the table drops its triggers; the trigger functions go after it.
DROP TABLE IF EXISTS public.orden_danos;
DROP FUNCTION IF EXISTS public.orden_danos_before_insert();
DROP FUNCTION IF EXISTS public.orden_danos_before_update();
DROP FUNCTION IF EXISTS public.orden_danos_before_delete();

ALTER TABLE public.ordenes_servicio DROP COLUMN IF EXISTS recepcion_sin_danos;
ALTER TABLE public.organizations DROP COLUMN IF EXISTS danos_recepcion_obligatorio;
