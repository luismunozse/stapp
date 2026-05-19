-- ========================================
-- 171: REPOSICIÓN AUTOMÁTICA (SUGERENCIAS)
-- ========================================
-- Calcula sugerencias de compra basadas en:
--   - Umbrales por item (punto_reorden, stock_minimo, stock_maximo)
--   - Umbral global (organizations.umbral_stock_bajo)
--   - Demanda histórica (movimientos VENTA últimos 30 días)
--   - Lead time del proveedor (proveedores.lead_time_dias)
--   - Días de cobertura objetivo (parametrizable)
--
-- No genera órdenes — solo calcula. La generación de OC se hace por API.
--
-- Output: 1 fila por item que necesita reposición, ordenado por prioridad.

CREATE OR REPLACE FUNCTION calcular_reposicion_sugerida(
  p_organization_id TEXT,
  p_cobertura_dias  INTEGER DEFAULT 30,
  p_solo_criticos   BOOLEAN DEFAULT false
)
RETURNS TABLE (
  inventario_id        TEXT,
  codigo               TEXT,
  nombre               TEXT,
  categoria            TEXT,
  tipo_dispositivo     TEXT,
  proveedor_id         TEXT,
  proveedor_nombre     TEXT,
  lead_time_dias       INTEGER,
  stock_actual         INTEGER,
  stock_minimo         INTEGER,
  punto_reorden        INTEGER,
  stock_maximo         INTEGER,
  umbral_aplicado      INTEGER,
  demanda_30d          INTEGER,
  demanda_diaria_avg   NUMERIC,
  dias_stock_restante  NUMERIC,
  cantidad_sugerida    INTEGER,
  precio_compra        NUMERIC,
  costo_estimado       NUMERIC,
  prioridad            TEXT
) AS $$
DECLARE
  v_umbral_global INTEGER;
BEGIN
  SELECT COALESCE(umbral_stock_bajo, 5) INTO v_umbral_global
  FROM organizations
  WHERE id = p_organization_id;

  IF v_umbral_global IS NULL THEN
    v_umbral_global := 5;
  END IF;

  RETURN QUERY
  WITH demanda AS (
    -- Suma de cantidades VENTA últimos 30 días (cantidad es negativa en SALIDA/VENTA;
    -- usamos ABS porque queremos magnitud consumida).
    SELECT
      m.inventario_id,
      SUM(ABS(m.cantidad))::INTEGER AS qty
    FROM movimientos_inventario m
    WHERE m.organization_id = p_organization_id
      AND m.tipo = 'VENTA'
      AND m.created_at >= NOW() - INTERVAL '30 days'
    GROUP BY m.inventario_id
  ),
  base AS (
    SELECT
      i.id,
      i.codigo,
      i.nombre,
      i.categoria,
      i.tipo_dispositivo::TEXT AS tipo_dispositivo,
      i.proveedor_id,
      p.nombre AS proveedor_nombre,
      p.lead_time_dias,
      COALESCE(i.stock, 0) AS stock_actual,
      i.stock_minimo,
      i.punto_reorden,
      i.stock_maximo,
      COALESCE(i.punto_reorden, i.stock_minimo, v_umbral_global) AS umbral_aplicado,
      COALESCE(d.qty, 0) AS demanda_30d,
      (COALESCE(d.qty, 0)::NUMERIC / 30.0) AS demanda_diaria_avg,
      i.precio_compra
    FROM inventario i
    LEFT JOIN proveedores p ON p.id = i.proveedor_id
    LEFT JOIN demanda d ON d.inventario_id = i.id
    WHERE i.organization_id = p_organization_id
      AND i.deleted_at IS NULL
  ),
  calc AS (
    SELECT
      b.*,
      -- Días de stock restante (NULL si sin demanda)
      CASE
        WHEN b.demanda_diaria_avg > 0
          THEN ROUND(b.stock_actual / b.demanda_diaria_avg, 1)
        ELSE NULL
      END AS dias_restantes,
      -- Target stock: max entre cobertura calculada y techo manual del usuario
      GREATEST(
        CEIL(b.demanda_diaria_avg * (COALESCE(b.lead_time_dias, 7) + p_cobertura_dias))::INTEGER,
        COALESCE(b.stock_maximo, 0),
        b.umbral_aplicado * 2
      ) AS target_stock
    FROM base b
  )
  SELECT
    c.id,
    c.codigo,
    c.nombre,
    c.categoria,
    c.tipo_dispositivo,
    c.proveedor_id,
    c.proveedor_nombre,
    c.lead_time_dias,
    c.stock_actual,
    c.stock_minimo,
    c.punto_reorden,
    c.stock_maximo,
    c.umbral_aplicado,
    c.demanda_30d,
    c.demanda_diaria_avg,
    c.dias_restantes,
    GREATEST(c.target_stock - c.stock_actual, 0)::INTEGER AS cantidad_sugerida,
    c.precio_compra,
    (GREATEST(c.target_stock - c.stock_actual, 0)::NUMERIC * COALESCE(c.precio_compra, 0)) AS costo_estimado,
    CASE
      WHEN c.stock_actual = 0 THEN 'CRITICA'
      WHEN c.dias_restantes IS NOT NULL AND c.dias_restantes <= COALESCE(c.lead_time_dias, 7) THEN 'ALTA'
      WHEN c.stock_actual <= c.umbral_aplicado THEN 'MEDIA'
      ELSE 'BAJA'
    END AS prioridad
  FROM calc c
  WHERE
    -- Incluir solo items que necesitan reposición
    (c.stock_actual <= c.umbral_aplicado
     OR (c.dias_restantes IS NOT NULL AND c.dias_restantes <= COALESCE(c.lead_time_dias, 7) + 7))
    AND GREATEST(c.target_stock - c.stock_actual, 0) > 0
    AND (
      NOT p_solo_criticos
      OR c.stock_actual = 0
      OR (c.dias_restantes IS NOT NULL AND c.dias_restantes <= COALESCE(c.lead_time_dias, 7))
    )
  ORDER BY
    CASE
      WHEN c.stock_actual = 0 THEN 0
      WHEN c.dias_restantes IS NOT NULL AND c.dias_restantes <= COALESCE(c.lead_time_dias, 7) THEN 1
      WHEN c.stock_actual <= c.umbral_aplicado THEN 2
      ELSE 3
    END,
    c.proveedor_nombre NULLS LAST,
    c.nombre;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION calcular_reposicion_sugerida(TEXT, INTEGER, BOOLEAN) IS
  'Sugerencias de reposición basadas en stock + umbrales + demanda 30d + lead time. Cantidad sugerida cubre lead_time + cobertura_dias. Prioridad: CRITICA (stock=0) > ALTA (días<=lead) > MEDIA (<= umbral) > BAJA.';
