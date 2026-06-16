-- ========================================
-- 231 — Per-product warranty default
-- ========================================
-- Adds an optional product-level warranty override to inventario.
-- NULL means "use the org default" (organizations.garantia_dias_default).
-- The cascade is: product > org > 0 — resolved in app-layer by
-- resolveDiasGarantia() in components/pos/pos-types.ts.
--
-- Fully additive and idempotent. No DEFAULT so existing rows stay NULL
-- (which correctly means "defer to org default").

ALTER TABLE inventario
  ADD COLUMN IF NOT EXISTS dias_garantia_default INTEGER;

COMMENT ON COLUMN inventario.dias_garantia_default IS
  'Optional per-product warranty days override. NULL = use organizations.garantia_dias_default. 0 = explicit "no warranty". Resolved by app-layer cascade: product > org > 0.';
