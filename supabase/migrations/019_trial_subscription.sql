-- ========================================
-- MIGRACIÓN: Sistema de Trial de 30 días
-- Nuevas organizaciones empiezan con trial Premium
-- Al expirar, se bloquea hasta que paguen
-- ========================================

-- Actualizar función para crear suscripción con trial en lugar de Free
CREATE OR REPLACE FUNCTION create_free_subscription(org_id TEXT)
RETURNS TEXT AS $$
DECLARE
  premium_plan_id TEXT;
  new_sub_id TEXT;
BEGIN
  -- Obtener plan Premium (ahora damos trial de Premium, no Free)
  SELECT id INTO premium_plan_id FROM plans WHERE tipo = 'PREMIUM' LIMIT 1;

  IF premium_plan_id IS NULL THEN
    -- Fallback a Free si no existe Premium
    SELECT id INTO premium_plan_id FROM plans WHERE tipo = 'FREE' LIMIT 1;
  END IF;

  IF premium_plan_id IS NULL THEN
    RAISE EXCEPTION 'No plan found';
  END IF;

  -- Crear suscripción con trial de 30 días
  INSERT INTO subscriptions (
    organization_id,
    plan_id,
    status,
    current_period_start,
    current_period_end,
    trial_end
  )
  VALUES (
    org_id,
    premium_plan_id,
    'TRIALING',
    NOW(),
    NOW() + INTERVAL '30 days',
    NOW() + INTERVAL '30 days'
  )
  RETURNING id INTO new_sub_id;

  -- Crear registro de uso
  INSERT INTO organization_usage (organization_id)
  VALUES (org_id)
  ON CONFLICT (organization_id) DO NOTHING;

  RETURN new_sub_id;
END;
$$ LANGUAGE plpgsql;

-- Renombrar función para mayor claridad (mantener la vieja por compatibilidad)
CREATE OR REPLACE FUNCTION create_trial_subscription(org_id TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN create_free_subscription(org_id);
END;
$$ LANGUAGE plpgsql;

-- Actualizar trigger de organización creada (el trigger ya llama a create_free_subscription)
-- No necesita cambios porque create_free_subscription ahora crea trial

-- ========================================
-- MIGRAR ORGANIZACIONES EXISTENTES A TRIAL
-- Todas las orgs con plan FREE y sin pago se migran a trial de 30 días
-- ========================================
UPDATE subscriptions s
SET
  plan_id = (SELECT id FROM plans WHERE tipo = 'PREMIUM' LIMIT 1),
  status = 'TRIALING',
  trial_end = NOW() + INTERVAL '30 days',
  current_period_end = NOW() + INTERVAL '30 days',
  current_period_start = NOW()
WHERE s.status = 'ACTIVE'
  AND s.payment_provider IS NULL
  AND EXISTS (
    SELECT 1 FROM plans p
    WHERE p.id = s.plan_id AND p.tipo = 'FREE'
  );
