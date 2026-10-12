-- ============================================================================
-- AUDITORÍA (solo lectura) — datos viejos que la 316/317 no alcanza
-- ============================================================================
-- Correr ANTES del backfill. No modifica nada: cuenta y muestra qué quedó mal
-- de antes de aplicar la 316, para decidir si el backfill vale la pena y para
-- tener el "antes" contra el que comparar después.
--
-- Cada bloque es independiente. Correlos de a uno.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- A) Garantías ACTIVA de líneas que ya se devolvieron enteras
-- ----------------------------------------------------------------------------
-- Éstas SÍ son recuperables: items_devolucion deja el rastro completo.
-- Es exactamente lo que la 316 hace de ahora en más.
SELECT
  COUNT(*)                                    AS garantias_a_anular,
  COUNT(DISTINCT gv.organization_id)           AS orgs_afectadas,
  MIN(gv.created_at)::date                     AS mas_vieja,
  MAX(gv.created_at)::date                     AS mas_nueva
FROM garantias_venta gv
JOIN items_venta iv ON iv.id = gv.item_venta_id
WHERE gv.estado = 'ACTIVA'
  AND (
    SELECT COALESCE(SUM(idv.cantidad), 0)
    FROM items_devolucion idv
    JOIN devoluciones_venta dv ON dv.id = idv.devolucion_id
    WHERE idv.item_venta_id = iv.id
  ) >= iv.cantidad;


-- Detalle de las mismas, para mirar antes de tocar nada.
SELECT
  gv.id,
  gv.numero_garantia,
  gv.organization_id,
  v.numero_venta,
  iv.descripcion,
  iv.cantidad                                  AS vendidas,
  (SELECT COALESCE(SUM(idv.cantidad), 0)
     FROM items_devolucion idv
     JOIN devoluciones_venta dv ON dv.id = idv.devolucion_id
    WHERE idv.item_venta_id = iv.id)           AS devueltas,
  gv.fecha_vencimiento,
  gv.fecha_vencimiento >= CURRENT_DATE         AS todavia_vigente
FROM garantias_venta gv
JOIN items_venta iv ON iv.id = gv.item_venta_id
JOIN ventas v       ON v.id  = gv.venta_id
WHERE gv.estado = 'ACTIVA'
  AND (
    SELECT COALESCE(SUM(idv.cantidad), 0)
    FROM items_devolucion idv
    JOIN devoluciones_venta dv ON dv.id = idv.devolucion_id
    WHERE idv.item_venta_id = iv.id
  ) >= iv.cantidad
ORDER BY todavia_vigente DESC, gv.fecha_vencimiento DESC
LIMIT 200;


-- ----------------------------------------------------------------------------
-- B) Series que quedaron colgadas de una venta ya devuelta entera
-- ----------------------------------------------------------------------------
-- Es la fuga 3: se devolvió SIN reposición, así que el código viejo no tocaba la
-- serie. Siguen en VENDIDO / GARANTIA_ACTIVA con venta_id apuntando a la venta.
-- Recuperables justamente porque conservan venta_id.
-- COUNT(DISTINCT s.id): si la venta tiene varias líneas del mismo producto el
-- join multiplica la serie, y contar filas la contaría de más.
SELECT
  COUNT(DISTINCT s.id)                                                       AS series_colgadas,
  COUNT(DISTINCT s.id) FILTER (WHERE s.estado = 'GARANTIA_ACTIVA')           AS en_garantia_activa,
  COUNT(DISTINCT s.id) FILTER (WHERE iv.dias_garantia > 0)                   AS con_fecha_del_comprador
FROM inventario_series s
JOIN items_venta iv ON iv.venta_id = s.venta_id
                   AND iv.inventario_id = s.inventario_id
WHERE s.estado IN ('VENDIDO', 'GARANTIA_ACTIVA')
  AND s.venta_id IS NOT NULL
  -- Una serie apunta a la VENTA, no a la línea: si la venta tiene dos líneas del
  -- mismo producto no se sabe a cuál pertenece. Solo cuentan las ventas donde
  -- TODAS las líneas de ese producto están devueltas enteras.
  AND NOT EXISTS (
    SELECT 1 FROM items_venta iv2
    WHERE iv2.venta_id = s.venta_id AND iv2.inventario_id = s.inventario_id
      AND (SELECT COALESCE(SUM(idv2.cantidad), 0)
             FROM items_devolucion idv2
             JOIN devoluciones_venta dv2 ON dv2.id = idv2.devolucion_id
            WHERE idv2.item_venta_id = iv2.id) < iv2.cantidad);


-- ----------------------------------------------------------------------------
-- C) Series en stock con fecha de garantía — NO SE PUEDEN ARREGLAR A CIEGAS
-- ----------------------------------------------------------------------------
-- El código viejo devolvía la serie a DISPONIBLE poniendo venta_id = NULL pero
-- conservando fecha_garantia_vence. Resultado: una serie con fecha rancia del
-- comprador anterior es INDISTINGUIBLE de una serie recién ingresada con la
-- garantía del proveedor (registrar_series_ingreso, 175:431) — mismas columnas,
-- mismos valores. Y registrar_devolucion_stock (224) no estampa serie_ids en
-- movimientos_inventario, así que no hay rastro por serie.
--
-- Por eso NO hay backfill automático para este caso: limpiarlas en masa borraría
-- garantías de proveedor legítimas. Esta query solo dice cuántas hay para
-- dimensionar el riesgo; las que además estén vigentes son las únicas que pueden
-- provocar la herencia al revender.
SELECT
  COUNT(*)                                                        AS disponibles_con_fecha,
  COUNT(*) FILTER (WHERE s.fecha_garantia_vence >= CURRENT_DATE)  AS vigentes_hoy,
  MIN(s.fecha_garantia_vence)                                     AS fecha_mas_vieja,
  MAX(s.fecha_garantia_vence)                                     AS fecha_mas_nueva
FROM inventario_series s
WHERE s.estado = 'DISPONIBLE'
  AND s.fecha_garantia_vence IS NOT NULL;
