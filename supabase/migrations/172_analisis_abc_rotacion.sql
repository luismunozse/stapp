-- ========================================
-- 172: ANÁLISIS ABC + ROTACIÓN
-- ========================================
-- Clasifica items por:
--   - ABC (Pareto): A=top 80% revenue, B=siguiente 15%, C=último 5%
--   - Rotación: alta / media / baja / muerta (sin venta en período)
--   - Días sin movimiento (última venta)
--   - Capital inmovilizado (stock_actual * precio_compra)
--
-- Métrica revenue = SUM(items_venta.subtotal) en período, no cantidad pura.
-- Esto pondera correctamente items caros poco vendidos vs baratos masivos.
--
-- Una sola RPC. La UI muestra todo desde el resultado.

CREATE OR REPLACE FUNCTION analisis_abc_rotacion(
  p_organization_id TEXT,
  p_dias            INTEGER DEFAULT 90,
  p_dias_muerto     INTEGER DEFAULT 90
)
RETURNS TABLE (
  inventario_id            TEXT,
  codigo                   TEXT,
  nombre                   TEXT,
  categoria                TEXT,
  tipo_dispositivo         TEXT,
  proveedor_id             TEXT,
  proveedor_nombre         TEXT,
  stock_actual             INTEGER,
  precio_compra            NUMERIC,
  precio_venta             NUMERIC,
  capital_inmovilizado     NUMERIC,
  qty_vendida              INTEGER,
  revenue                  NUMERIC,
  margen_unitario          NUMERIC,
  margen_total             NUMERIC,
  ventas_count             INTEGER,
  ultima_venta_at          TIMESTAMPTZ,
  dias_sin_venta           INTEGER,
  rotacion                 NUMERIC,
  dias_promedio_stock      NUMERIC,
  pct_revenue              NUMERIC,
  pct_revenue_acumulado    NUMERIC,
  clasificacion_abc        TEXT,
  clasificacion_rotacion   TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH ventas_periodo AS (
    -- Revenue desde items_venta (precio efectivo cobrado),
    -- ventas no anuladas (estado != ANULADA si existe esa columna).
    SELECT
      iv.inventario_id,
      SUM(iv.cantidad)::INTEGER AS qty,
      SUM(iv.subtotal)::NUMERIC AS revenue,
      COUNT(DISTINCT iv.venta_id)::INTEGER AS ventas_count,
      MAX(v.created_at) AS ultima_venta
    FROM items_venta iv
    JOIN ventas v ON v.id = iv.venta_id
    WHERE v.organization_id = p_organization_id
      AND iv.inventario_id IS NOT NULL
      AND v.created_at >= NOW() - (p_dias || ' days')::INTERVAL
      AND v.estado = 'COMPLETADA'
    GROUP BY iv.inventario_id
  ),
  ultima_venta_global AS (
    -- Última venta ever (para días sin venta más allá del período)
    SELECT
      iv.inventario_id,
      MAX(v.created_at) AS ultima
    FROM items_venta iv
    JOIN ventas v ON v.id = iv.venta_id
    WHERE v.organization_id = p_organization_id
      AND iv.inventario_id IS NOT NULL
      AND v.estado = 'COMPLETADA'
    GROUP BY iv.inventario_id
  ),
  base AS (
    SELECT
      i.id,
      i.codigo,
      i.nombre,
      i.categoria,
      i.tipo_dispositivo::TEXT AS tipo_dispositivo,
      i.proveedor_id,
      pr.nombre AS proveedor_nombre,
      COALESCE(i.stock, 0) AS stock_actual,
      i.precio_compra,
      i.precio_venta,
      (COALESCE(i.stock, 0)::NUMERIC * COALESCE(i.precio_compra, 0)) AS capital_inmovilizado,
      COALESCE(vp.qty, 0) AS qty_vendida,
      COALESCE(vp.revenue, 0) AS revenue,
      (i.precio_venta - i.precio_compra) AS margen_unitario,
      (COALESCE(vp.qty, 0)::NUMERIC * GREATEST(i.precio_venta - i.precio_compra, 0)) AS margen_total,
      COALESCE(vp.ventas_count, 0) AS ventas_count,
      COALESCE(uvg.ultima, vp.ultima_venta) AS ultima_venta_at
    FROM inventario i
    LEFT JOIN proveedores pr ON pr.id = i.proveedor_id
    LEFT JOIN ventas_periodo vp ON vp.inventario_id = i.id
    LEFT JOIN ultima_venta_global uvg ON uvg.inventario_id = i.id
    WHERE i.organization_id = p_organization_id
      AND i.deleted_at IS NULL
  ),
  with_rotacion AS (
    SELECT
      b.*,
      CASE
        WHEN b.ultima_venta_at IS NULL THEN NULL
        ELSE EXTRACT(DAY FROM NOW() - b.ultima_venta_at)::INTEGER
      END AS dias_sin_venta,
      -- Rotación = qty_vendida / stock_actual (anualizada al período).
      -- Sin stock actual usamos 0 (rotación N/A).
      CASE
        WHEN b.stock_actual > 0 AND b.qty_vendida > 0
          THEN ROUND((b.qty_vendida::NUMERIC / b.stock_actual) * (365.0 / p_dias), 2)
        ELSE 0
      END AS rotacion,
      CASE
        WHEN b.qty_vendida > 0
          THEN ROUND((b.stock_actual::NUMERIC / (b.qty_vendida::NUMERIC / p_dias)), 1)
        ELSE NULL
      END AS dias_promedio_stock
    FROM base b
  ),
  total_revenue AS (
    SELECT SUM(revenue) AS total FROM with_rotacion
  ),
  ranked AS (
    SELECT
      w.*,
      CASE
        WHEN COALESCE((SELECT total FROM total_revenue), 0) = 0 THEN 0
        ELSE ROUND((w.revenue / (SELECT total FROM total_revenue)) * 100, 4)
      END AS pct_rev,
      CASE
        WHEN COALESCE((SELECT total FROM total_revenue), 0) = 0 THEN 0
        ELSE ROUND(
          (SUM(w.revenue) OVER (ORDER BY w.revenue DESC, w.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
            / (SELECT total FROM total_revenue)) * 100,
          4
        )
      END AS pct_acum
    FROM with_rotacion w
  )
  SELECT
    r.id,
    r.codigo,
    r.nombre,
    r.categoria,
    r.tipo_dispositivo,
    r.proveedor_id,
    r.proveedor_nombre,
    r.stock_actual,
    r.precio_compra,
    r.precio_venta,
    r.capital_inmovilizado,
    r.qty_vendida,
    r.revenue,
    r.margen_unitario,
    r.margen_total,
    r.ventas_count,
    r.ultima_venta_at,
    r.dias_sin_venta,
    r.rotacion,
    r.dias_promedio_stock,
    r.pct_rev,
    r.pct_acum,
    CASE
      WHEN r.revenue = 0 THEN 'SIN_VENTAS'
      WHEN r.pct_acum <= 80 THEN 'A'
      WHEN r.pct_acum <= 95 THEN 'B'
      ELSE 'C'
    END AS clasificacion_abc,
    CASE
      WHEN r.qty_vendida = 0 AND r.dias_sin_venta IS NULL THEN 'NUEVA'
      WHEN r.qty_vendida = 0 OR (r.dias_sin_venta IS NOT NULL AND r.dias_sin_venta > p_dias_muerto)
        THEN 'MUERTA'
      WHEN r.rotacion >= 6 THEN 'ALTA'
      WHEN r.rotacion >= 2 THEN 'MEDIA'
      ELSE 'BAJA'
    END AS clasificacion_rotacion
  FROM ranked r
  ORDER BY r.revenue DESC, r.nombre;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION analisis_abc_rotacion(TEXT, INTEGER, INTEGER) IS
  'Análisis ABC (Pareto por revenue) + rotación + dead stock. Período configurable (default 90d). Clasificación ABC: A=top 80% revenue acumulado, B=siguiente 15%, C=último 5%, SIN_VENTAS aparte. Rotación anualizada: ALTA(>=6), MEDIA(>=2), BAJA(<2), MUERTA(sin venta en p_dias_muerto), NUEVA (sin venta ever).';
