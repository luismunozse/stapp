-- ============================================================================
-- BACKFILL — retirar garantías de devoluciones anteriores a la 316
-- ============================================================================
-- Correr DESPUÉS de aplicar 316 + 317, y DESPUÉS de la auditoría
-- (316_auditoria_garantias_devueltas.sql), que dice cuántas filas espera tocar
-- cada bloque.
--
-- Es idempotente: correrlo dos veces no cambia nada la segunda vez (los WHERE
-- filtran por el estado viejo). Va todo en una transacción con verificación
-- antes del COMMIT.
--
-- Cubre lo recuperable:
--   A) garantias_venta ACTIVA de líneas ya devueltas enteras  -> ANULADA
--   B) series colgadas de una venta devuelta entera           -> DEVUELTO
--
-- NO cubre (imposible, ver bloque C de la auditoría): las series que ya volvieron
-- a DISPONIBLE con fecha_garantia_vence rancia. Al devolverlas el código viejo
-- puso venta_id = NULL, y sin ese vínculo son indistinguibles de una serie recién
-- ingresada con garantía de proveedor. Limpiarlas en masa borraría dato bueno.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- A) Garantías de líneas devueltas enteras -> ANULADA
-- ----------------------------------------------------------------------------
WITH lineas_devueltas_enteras AS (
  SELECT iv.id
  FROM items_venta iv
  WHERE (
    SELECT COALESCE(SUM(idv.cantidad), 0)
    FROM items_devolucion idv
    JOIN devoluciones_venta dv ON dv.id = idv.devolucion_id
    WHERE idv.item_venta_id = iv.id
  ) >= iv.cantidad
)
UPDATE garantias_venta gv
SET estado = 'ANULADA'
WHERE gv.estado = 'ACTIVA'
  AND gv.item_venta_id IN (SELECT id FROM lineas_devueltas_enteras);

-- ----------------------------------------------------------------------------
-- B) Series colgadas de una venta devuelta entera -> DEVUELTO
-- ----------------------------------------------------------------------------
-- Son las de la fuga 3 (devolución sin reposición): el código viejo no las
-- tocaba. Conservan venta_id, que es lo que las hace identificables.
--
-- Quedan DEVUELTO, no DISPONIBLE: no se repuso stock en su momento, así que
-- devolverlas al stock vendible acá inventaría unidades que el inventario nunca
-- contó. Si alguna tiene que volver a la venta, se hace a mano por
-- /api/inventario/series/[serieId].
--
-- fecha_garantia_vence se limpia solo si la puso la venta (dias_garantia > 0);
-- con 0 días lo que hay es la garantía del proveedor. Misma regla que la 317.
WITH series_colgadas AS (
  -- GROUP BY + MAX: con varias líneas del mismo producto el join devolvería la
  -- misma serie repetida y UPDATE ... FROM tomaría una fila cualquiera. MAX es
  -- además la dirección correcta: si ALGUNA línea llevaba garantía, la venta ya
  -- pisó la fecha con la del comprador y hay que limpiarla; solo si TODAS eran
  -- de 0 días lo que hay es la del proveedor y se preserva.
  SELECT s.id,
         MAX(iv.dias_garantia) AS dias_garantia
  FROM inventario_series s
  JOIN items_venta iv ON iv.venta_id = s.venta_id
                     AND iv.inventario_id = s.inventario_id
  WHERE s.estado IN ('VENDIDO', 'GARANTIA_ACTIVA')
    AND s.venta_id IS NOT NULL
    -- Una serie apunta a la VENTA, no a la línea. Si la venta tiene dos líneas
    -- del mismo producto no hay forma de saber a cuál pertenece, así que solo se
    -- toca cuando TODAS las líneas de ese producto en esa venta están devueltas
    -- enteras. Conservador a propósito: preferimos dejar una colgada antes que
    -- retirar una que todavía está en manos del cliente.
    AND NOT EXISTS (
      SELECT 1
      FROM items_venta iv2
      WHERE iv2.venta_id      = s.venta_id
        AND iv2.inventario_id = s.inventario_id
        AND (
          SELECT COALESCE(SUM(idv2.cantidad), 0)
          FROM items_devolucion idv2
          JOIN devoluciones_venta dv2 ON dv2.id = idv2.devolucion_id
          WHERE idv2.item_venta_id = iv2.id
        ) < iv2.cantidad
    )
  GROUP BY s.id
)
UPDATE inventario_series s
SET estado = 'DEVUELTO',
    fecha_garantia_vence = CASE
      WHEN COALESCE(sc.dias_garantia, 0) > 0 THEN NULL
      ELSE s.fecha_garantia_vence END,
    updated_at = now()
FROM series_colgadas sc
WHERE s.id = sc.id;

-- ----------------------------------------------------------------------------
-- Verificación antes de confirmar
-- ----------------------------------------------------------------------------
-- Las dos columnas tienen que dar 0. Si no, hacé ROLLBACK en vez de COMMIT.
SELECT
  (SELECT COUNT(*)
     FROM garantias_venta gv
     JOIN items_venta iv ON iv.id = gv.item_venta_id
    WHERE gv.estado = 'ACTIVA'
      AND (SELECT COALESCE(SUM(idv.cantidad), 0)
             FROM items_devolucion idv
             JOIN devoluciones_venta dv ON dv.id = idv.devolucion_id
            WHERE idv.item_venta_id = iv.id) >= iv.cantidad
  ) AS garantias_activas_restantes,
  (SELECT COUNT(*)
     FROM inventario_series s
     JOIN items_venta iv ON iv.venta_id = s.venta_id
                        AND iv.inventario_id = s.inventario_id
    WHERE s.estado IN ('VENDIDO', 'GARANTIA_ACTIVA')
      AND s.venta_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM items_venta iv2
        WHERE iv2.venta_id = s.venta_id AND iv2.inventario_id = s.inventario_id
          AND (SELECT COALESCE(SUM(idv2.cantidad), 0)
                 FROM items_devolucion idv2
                 JOIN devoluciones_venta dv2 ON dv2.id = idv2.devolucion_id
                WHERE idv2.item_venta_id = iv2.id) < iv2.cantidad)
  ) AS series_colgadas_restantes;

-- Si las dos dieron 0:
COMMIT;
-- Si no:
-- ROLLBACK;
