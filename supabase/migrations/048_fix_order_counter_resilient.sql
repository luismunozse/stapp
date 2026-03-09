-- Mejorar get_next_order_number para ser resiliente a contadores desincronizados
-- Si el contador está por debajo del máximo numero_orden existente, lo sincroniza automáticamente
CREATE OR REPLACE FUNCTION get_next_order_number(org_id TEXT)
RETURNS INTEGER AS $$
DECLARE
  next_num INTEGER;
  max_existing INTEGER;
BEGIN
  -- Obtener el máximo numero_orden existente para esta organización
  SELECT COALESCE(MAX(numero_orden), 0) INTO max_existing
  FROM ordenes_servicio
  WHERE organization_id = org_id;

  -- Atomically increment and return
  UPDATE organization_counters
  SET next_order_number = GREATEST(next_order_number, max_existing + 1) + 1
  WHERE organization_id = org_id
  RETURNING next_order_number - 1 INTO next_num;

  -- Si no existe el contador, crearlo sincronizado
  IF next_num IS NULL THEN
    INSERT INTO organization_counters (organization_id, next_order_number)
    VALUES (org_id, max_existing + 2)
    ON CONFLICT (organization_id) DO UPDATE
    SET next_order_number = GREATEST(organization_counters.next_order_number, max_existing + 1) + 1
    RETURNING next_order_number - 1 INTO next_num;
  END IF;

  RETURN next_num;
END;
$$ LANGUAGE plpgsql;

-- Sincronizar TODOS los contadores de organizaciones existentes
UPDATE organization_counters oc
SET next_order_number = GREATEST(
  oc.next_order_number,
  COALESCE(
    (SELECT MAX(numero_orden) + 1
     FROM ordenes_servicio
     WHERE organization_id = oc.organization_id),
    1
  )
);
