-- ============================================
-- 197: Security hardening — catálogo público
-- ============================================
-- Tablas con RLS faltante (155, 157, 158) quedaban accesibles vía PostgREST
-- con anon key: permitía enumerar cupones (códigos + descuentos), variantes
-- y vistas de cualquier organización. Habilitamos RLS + policy de SELECT
-- por organization_id usando el mismo helper que el resto del módulo.
--
-- RPCs de cupón/stock no tenían REVOKE explícito: anon podía invocarlas
-- vía PostgREST y agotar cupones / reducir stock real. Restringimos a
-- service_role (las APIs públicas usan supabaseAdmin).
--
-- Constraint de color_primary: el OG image genera CSS inline con el valor,
-- sin validación quedaba como vector de inyección. Limitamos a hex.
-- ============================================

-- ============================================
-- catalogo_views — RLS
-- ============================================
ALTER TABLE catalogo_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org puede ver sus catalogo_views" ON catalogo_views;
CREATE POLICY "Org puede ver sus catalogo_views"
  ON catalogo_views FOR SELECT
  USING (organization_id = public.get_current_organization_id());

-- INSERT/UPDATE/DELETE quedan sin policy: solo service_role (que bypassa RLS)
-- puede escribir. El endpoint público /view usa supabaseAdmin.

-- ============================================
-- catalogo_cupones — RLS
-- ============================================
ALTER TABLE catalogo_cupones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org puede ver sus cupones" ON catalogo_cupones;
CREATE POLICY "Org puede ver sus cupones"
  ON catalogo_cupones FOR SELECT
  USING (organization_id = public.get_current_organization_id());

DROP POLICY IF EXISTS "Org puede gestionar sus cupones" ON catalogo_cupones;
CREATE POLICY "Org puede gestionar sus cupones"
  ON catalogo_cupones FOR ALL
  USING (organization_id = public.get_current_organization_id())
  WITH CHECK (organization_id = public.get_current_organization_id());

-- ============================================
-- catalogo_variantes — RLS
-- ============================================
ALTER TABLE catalogo_variantes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org puede ver sus variantes" ON catalogo_variantes;
CREATE POLICY "Org puede ver sus variantes"
  ON catalogo_variantes FOR SELECT
  USING (organization_id = public.get_current_organization_id());

DROP POLICY IF EXISTS "Org puede gestionar sus variantes" ON catalogo_variantes;
CREATE POLICY "Org puede gestionar sus variantes"
  ON catalogo_variantes FOR ALL
  USING (organization_id = public.get_current_organization_id())
  WITH CHECK (organization_id = public.get_current_organization_id());

-- ============================================
-- RPCs sensibles — REVOKE de anon/PUBLIC
-- ============================================
-- aplicar_cupon_catalogo: incrementa usos_actuales. Invocable por anon =
-- coupon-exhaustion DoS (agotar cupón de competidores sin crear cotización).
REVOKE EXECUTE ON FUNCTION aplicar_cupon_catalogo(TEXT, TEXT, DECIMAL) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION aplicar_cupon_catalogo(TEXT, TEXT, DECIMAL) FROM anon;
GRANT EXECUTE ON FUNCTION aplicar_cupon_catalogo(TEXT, TEXT, DECIMAL) TO service_role;

-- revertir_uso_cupon_catalogo: anon podría decrementar usos arbitrariamente.
REVOKE EXECUTE ON FUNCTION revertir_uso_cupon_catalogo(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION revertir_uso_cupon_catalogo(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION revertir_uso_cupon_catalogo(TEXT) TO service_role;

-- validar_cupon_catalogo: solo lectura pero leaks data discriminante.
-- La ruta pública /cupon/validar usa supabaseAdmin (service_role), no anon.
REVOKE EXECUTE ON FUNCTION validar_cupon_catalogo(TEXT, TEXT, DECIMAL) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION validar_cupon_catalogo(TEXT, TEXT, DECIMAL) FROM anon;
GRANT EXECUTE ON FUNCTION validar_cupon_catalogo(TEXT, TEXT, DECIMAL) TO service_role;

-- reservar_stock_catalogo: anon podría reducir stock real del tenant.
-- Ruta /cotizar usa supabaseAdmin.
REVOKE EXECUTE ON FUNCTION reservar_stock_catalogo(TEXT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reservar_stock_catalogo(TEXT, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION reservar_stock_catalogo(TEXT, JSONB) TO service_role;

-- ============================================
-- catalogo_config.color_primary — CHECK constraint
-- ============================================
-- Sin validación, admin de un tenant puede setear cualquier string y romper
-- el OG image generator (CSS inline en opengraph-image.tsx). Limitamos a hex
-- con o sin alpha. Permitimos NULL (cae al default '#2563eb').
ALTER TABLE catalogo_config
  DROP CONSTRAINT IF EXISTS catalogo_config_color_primary_hex;

-- Backfill ANTES de agregar el constraint (sino el ADD falla si hay rows malas).
UPDATE catalogo_config
SET color_primary = '#2563eb'
WHERE color_primary IS NOT NULL
  AND color_primary !~ '^#[0-9a-fA-F]{3,8}$';

ALTER TABLE catalogo_config
  ADD CONSTRAINT catalogo_config_color_primary_hex
  CHECK (color_primary IS NULL OR color_primary ~ '^#[0-9a-fA-F]{3,8}$');
