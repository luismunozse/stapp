-- get_plan_limit ahora respeta organization_limit_overrides (alinea el
-- enforcement de los triggers atomicos con el pre-check app-layer / get_effective_limits).
-- Semantica: NULL = ilimitado. El override por org tiene prioridad sobre el plan.

CREATE OR REPLACE FUNCTION get_plan_limit(org_id TEXT, limit_type TEXT)
RETURNS INTEGER AS $$
DECLARE
  v_plan_limit INTEGER;
  v_override   INTEGER;
  v_found      BOOLEAN := FALSE;
BEGIN
  -- Limite del plan activo
  SELECT
    CASE limit_type
      WHEN 'ordenes'    THEN p.limite_ordenes
      WHEN 'tecnicos'   THEN p.limite_tecnicos
      WHEN 'vendedores' THEN p.limite_vendedores
      WHEN 'clientes'   THEN p.limite_clientes
      WHEN 'storage'    THEN p.limite_storage_mb
    END
  INTO v_plan_limit
  FROM subscriptions s
  JOIN plans p ON s.plan_id = p.id
  WHERE s.organization_id = org_id
    AND s.status IN ('ACTIVE', 'TRIALING')
  LIMIT 1;

  GET DIAGNOSTICS v_found = ROW_COUNT;

  IF NOT v_found THEN
    -- Fallback Free para orgs sin suscripcion activa (igual que migration 167)
    RETURN CASE limit_type
      WHEN 'ordenes'    THEN 15
      WHEN 'tecnicos'   THEN 1
      WHEN 'vendedores' THEN 1
      WHEN 'clientes'   THEN 30
      WHEN 'storage'    THEN 100
    END;
  END IF;

  -- Override por org (si existe para ese tipo) tiene prioridad sobre el plan
  SELECT
    CASE limit_type
      WHEN 'ordenes'    THEN o.limite_ordenes
      WHEN 'tecnicos'   THEN o.limite_tecnicos
      WHEN 'vendedores' THEN o.limite_vendedores
      WHEN 'clientes'   THEN o.limite_clientes
      WHEN 'storage'    THEN o.limite_storage_mb
    END
  INTO v_override
  FROM organization_limit_overrides o
  WHERE o.organization_id = org_id
  LIMIT 1;

  RETURN COALESCE(v_override, v_plan_limit);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_plan_limit(TEXT, TEXT) IS
  'Limite efectivo (plan + override por org) para un tipo. NULL = ilimitado. Fallback Free sin suscripcion activa.';
