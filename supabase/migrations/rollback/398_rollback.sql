-- Rollback de superadmin_agregaciones_sql (398). Las rutas del panel que usan
-- estas funciones responden 500 sin ellas: revertir también el deploy.
SET LOCAL lock_timeout = '3s';
DROP FUNCTION IF EXISTS public.superadmin_pagos_por_moneda(TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT[]);
DROP FUNCTION IF EXISTS public.superadmin_ingresos_por_mes(TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.superadmin_campania_segmentos();
DROP FUNCTION IF EXISTS public.superadmin_engagement_metricas(TIMESTAMPTZ, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.superadmin_feature_usage_ultimo();
