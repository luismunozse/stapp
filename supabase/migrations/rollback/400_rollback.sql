-- Rollback de garantias_vista_unificada (400): borra v_garantias y saca
-- organization_id de garantias (con su trigger, FK e índice).
-- La página /garantias y el conteo del dashboard leen la vista: revertir el
-- deploy ANTES de correr este rollback.

SET LOCAL lock_timeout = '3s';

DROP VIEW IF EXISTS public.v_garantias;

DROP TRIGGER IF EXISTS garantias_organization_id ON garantias;
DROP FUNCTION IF EXISTS public.garantias_organization_desde_orden();

DROP INDEX IF EXISTS garantias_organization_vencimiento_idx;
ALTER TABLE garantias DROP CONSTRAINT IF EXISTS garantias_organization_id_fkey;
ALTER TABLE garantias DROP COLUMN IF EXISTS organization_id;
