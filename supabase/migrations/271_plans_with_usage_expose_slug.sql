-- ============================================================================
-- 271: plans_with_usage — exponer slug y columnas faltantes
-- ============================================================================
-- Bug: la vista plans_with_usage se creó en la migración 025, ANTES de que
-- existieran las columnas slug/tier_order/feature_flags (107), precios USD
-- (069), limite_vendedores (059) y limite_sucursales (204). La vista nunca se
-- recreó, así que /api/superadmin/plans devolvía filas sin esas columnas.
--
-- Consecuencia en el panel superadmin: el diálogo "Cambiar plan"
-- (org-quick-actions) arma cada <SelectItem value={p.slug}> con slug = undefined,
-- por lo que al elegir "Profesional" nunca se setea planSlug y el botón
-- Confirmar queda deshabilitado. Lo mismo aplica al bloque de feature_flags de
-- la pantalla de gestión de planes, que siempre mostraba "Sin feature flags".
--
-- Fix: recrear la vista alineada con el schema actual de plans. Se usa
-- CREATE OR REPLACE agregando las columnas nuevas AL FINAL para preservar el
-- prefijo de columnas existente (requisito de CREATE OR REPLACE VIEW) y no
-- perder grants. La API lee por nombre (select "*"), el orden no le afecta.
-- ============================================================================

CREATE OR REPLACE VIEW plans_with_usage AS
SELECT
  -- Prefijo original (025) — no reordenar: CREATE OR REPLACE lo exige
  p.id,
  p.nombre,
  p.tipo,
  p.descripcion,
  p.precio_mensual,
  p.precio_anual,
  p.moneda,
  p.limite_ordenes,
  p.limite_tecnicos,
  p.limite_clientes,
  p.limite_storage_mb,
  p.features,
  p.stripe_price_monthly,
  p.stripe_price_yearly,
  p.activo,
  p.created_at,
  p.updated_at,
  p.deleted_at,
  COUNT(DISTINCT s.organization_id) AS organizations_count,
  SUM(CASE WHEN s.status = 'ACTIVE' THEN 1 ELSE 0 END) AS active_subscriptions,
  -- Columnas nuevas (append-only)
  p.slug,
  p.tier_order,
  p.precio_mensual_usd,
  p.precio_anual_usd,
  p.limite_vendedores,
  p.limite_sucursales,
  p.feature_flags
FROM plans p
LEFT JOIN subscriptions s ON s.plan_id = p.id
WHERE p.deleted_at IS NULL
GROUP BY
  p.id,
  p.nombre,
  p.tipo,
  p.descripcion,
  p.precio_mensual,
  p.precio_anual,
  p.moneda,
  p.limite_ordenes,
  p.limite_tecnicos,
  p.limite_clientes,
  p.limite_storage_mb,
  p.features,
  p.stripe_price_monthly,
  p.stripe_price_yearly,
  p.activo,
  p.created_at,
  p.updated_at,
  p.deleted_at,
  p.slug,
  p.tier_order,
  p.precio_mensual_usd,
  p.precio_anual_usd,
  p.limite_vendedores,
  p.limite_sucursales,
  p.feature_flags;

COMMENT ON VIEW plans_with_usage IS 'Planes con conteo de uso. Recreada en 271 para exponer slug, tier_order, feature_flags, precios USD, limite_vendedores y limite_sucursales (faltaban desde 025).';
