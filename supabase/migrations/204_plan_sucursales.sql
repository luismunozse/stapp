-- ========================================
-- 204: PLAN SUCURSALES — limite_sucursales, fila PRO, usage, gate
-- ========================================
-- Requiere que 203 (enum 'PRO') ya esté aplicado.
-- Idempotente: ADD COLUMN IF NOT EXISTS, UPDATE por tipo, INSERT por NOT EXISTS.

-- ========================================
-- 1. limite_sucursales en plans (NULL = ilimitado)
-- ========================================

ALTER TABLE plans ADD COLUMN IF NOT EXISTS limite_sucursales INTEGER;

UPDATE plans SET limite_sucursales = 1 WHERE tipo = 'FREE';
UPDATE plans SET limite_sucursales = 3 WHERE tipo = 'PREMIUM';

-- ========================================
-- 2. Fila del plan PRO (sucursales ilimitadas)
-- ========================================
-- NOTA DE NEGOCIO: precio y features son valores iniciales sugeridos.
-- Ajustar precio_mensual / precio_anual / features / stripe_price_* antes de
-- exponer el plan en producción. ~1.8x Profesional como ancla.

INSERT INTO plans (
  nombre, tipo, descripcion,
  precio_mensual, precio_anual, moneda,
  limite_ordenes, limite_tecnicos, limite_clientes, limite_storage_mb,
  limite_sucursales, features, activo
)
SELECT
  'Pro', 'PRO', 'Plan para cadenas con múltiples sucursales',
  34999, 335990, 'ARS',
  NULL, NULL, NULL, 10000,
  NULL,
  '["Todo lo de Profesional", "Sucursales ilimitadas", "Reportes consolidados por sucursal", "10GB almacenamiento", "Soporte prioritario"]',
  true
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE tipo = 'PRO');

-- ========================================
-- 3. organization_usage.sucursales_count (display/dashboard)
-- ========================================

ALTER TABLE organization_usage ADD COLUMN IF NOT EXISTS sucursales_count INTEGER DEFAULT 0;

UPDATE organization_usage ou
SET sucursales_count = (
  SELECT COUNT(*) FROM sucursales s
  WHERE s.organization_id = ou.organization_id
    AND s.deleted_at IS NULL
    AND s.activo = true
);

-- ========================================
-- 4. check_plan_limit extendido con 'sucursales'
-- ========================================
-- Para 'sucursales' usamos un COUNT en vivo (autoritativo, sin drift del
-- contador cacheado). El resto de los limit_type siguen leyendo de
-- organization_usage como antes.

CREATE OR REPLACE FUNCTION check_plan_limit(
  org_id TEXT,
  limit_type TEXT -- 'ordenes', 'tecnicos', 'clientes', 'sucursales'
)
RETURNS BOOLEAN AS $$
DECLARE
  plan_limit INTEGER;
  current_usage INTEGER;
BEGIN
  SELECT
    CASE limit_type
      WHEN 'ordenes' THEN p.limite_ordenes
      WHEN 'tecnicos' THEN p.limite_tecnicos
      WHEN 'clientes' THEN p.limite_clientes
      WHEN 'sucursales' THEN p.limite_sucursales
    END
  INTO plan_limit
  FROM subscriptions s
  JOIN plans p ON s.plan_id = p.id
  WHERE s.organization_id = org_id
    AND s.status IN ('ACTIVE', 'TRIALING');

  -- Sin límite (NULL) o sin suscripción encontrada => permitir
  IF plan_limit IS NULL THEN
    RETURN TRUE;
  END IF;

  IF limit_type = 'sucursales' THEN
    SELECT COUNT(*) INTO current_usage
    FROM sucursales
    WHERE organization_id = org_id
      AND deleted_at IS NULL
      AND activo = true;
  ELSE
    SELECT
      CASE limit_type
        WHEN 'ordenes' THEN ordenes_mes_actual
        WHEN 'tecnicos' THEN tecnicos_count
        WHEN 'clientes' THEN clientes_count
      END
    INTO current_usage
    FROM organization_usage
    WHERE organization_id = org_id;
  END IF;

  IF current_usage IS NULL THEN
    current_usage := 0;
  END IF;

  RETURN current_usage < plan_limit;
END;
$$ LANGUAGE plpgsql;
