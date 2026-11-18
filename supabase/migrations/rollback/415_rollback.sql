-- Rollback de 415: quita la columna (se pierde el texto cargado).
ALTER TABLE public.ordenes_servicio DROP COLUMN IF EXISTS trabajo_a_realizar;
