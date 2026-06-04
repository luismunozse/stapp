-- ========================================
-- 205: FIX — limite_sucursales por slug + alinear plan PRO al esquema slug/tier
-- ========================================
-- La migración 204 asignó limite_sucursales POR TIPO (tipo='PREMIUM'), pero
-- existen 2 planes PREMIUM (Emprendedor y Profesional, ver migración 107).
-- Eso dejó a Emprendedor con 3 sucursales por error: debe ser 1.
-- Además la fila PRO de 204 quedó sin slug/tier_order; se alinea al esquema
-- de 3 tiers (107). Idempotente: UPDATEs por slug/tipo.

-- Emprendedor: tier de entrada => 1 sucursal (no 3).
UPDATE plans SET limite_sucursales = 1 WHERE slug = 'emprendedor';

-- Profesional: confirmar 3 (no-op si ya estaba).
UPDATE plans SET limite_sucursales = 3 WHERE slug = 'profesional';

-- Free: confirmar 1 (no-op si ya estaba).
UPDATE plans SET limite_sucursales = 1 WHERE tipo = 'FREE';

-- Plan PRO: setear slug y tier_order (quedó NULL en 204).
-- slug tiene UNIQUE (plans_slug_key); 'pro' no colisiona.
UPDATE plans SET slug = 'pro', tier_order = 3
WHERE tipo = 'PRO' AND slug IS NULL;
