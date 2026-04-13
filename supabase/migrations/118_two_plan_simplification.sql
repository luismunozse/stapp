-- ============================================================================
-- Migration 118: Simplificar a 2 planes (Free + Profesional)
-- ============================================================================
-- Contexto: Unificar los planes del sistema. Se elimina Emprendedor y Taller+
-- (que solo existía en UI). Quedan solo Free (limitado) y Profesional (todo).
-- Los suscriptores de Emprendedor se migran a Profesional.
-- ============================================================================

BEGIN;

-- 1. Migrar suscriptores activos de Emprendedor → Profesional
UPDATE subscriptions
SET plan_id = (SELECT id FROM plans WHERE slug = 'profesional' AND activo = true LIMIT 1),
    updated_at = now()
WHERE plan_id = (SELECT id FROM plans WHERE slug = 'emprendedor' LIMIT 1)
  AND status IN ('ACTIVE', 'TRIALING');

-- 2. Desactivar plan Emprendedor (soft-delete, mantiene auditoría)
UPDATE plans
SET activo = false, updated_at = now()
WHERE slug = 'emprendedor';

-- 3. Actualizar precio anual de Profesional
UPDATE plans SET
  precio_anual = 149999,
  precio_anual_usd = 107,
  updated_at = now()
WHERE slug = 'profesional';

-- 4. Actualizar Free con límites restrictivos para máxima conversión
UPDATE plans SET
  limite_ordenes = 15,
  limite_tecnicos = 1,
  limite_vendedores = 1,
  limite_clientes = 30,
  limite_storage_mb = 100,
  feature_flags = '{}'::jsonb,
  features = '["Hasta 15 órdenes/mes","1 técnico","1 vendedor","Hasta 30 clientes","100MB almacenamiento","Inventario básico","Soporte por email"]'::jsonb,
  updated_at = now()
WHERE slug = 'free';

COMMIT;
