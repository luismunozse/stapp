-- ========================================
-- 203: PLAN PRO — agregar value al enum plan_type
-- ========================================
-- DEBE ir en migración separada de su uso (204): Postgres no permite usar
-- un value de enum recién agregado dentro de la misma transacción.
-- IF NOT EXISTS hace la operación idempotente (Postgres 12+).

ALTER TYPE plan_type ADD VALUE IF NOT EXISTS 'PRO';
