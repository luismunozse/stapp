-- ============================================================================
-- 294: precio mayorista por cliente (tipo_precio + descuento_pct)
-- ============================================================================
-- Un cliente puede marcarse MAYORISTA con un único % de descuento negociado.
-- Este % se usa solo para PRE-LLENAR el precio sugerido al crear una orden
-- (única/recepción múltiple) — nunca recalcula nada ya creado ni ya cobrado.
--
-- Asimetría deliberada en los CHECK (ver design ADR-3): clientes es la fuente
-- de verdad de la regla de negocio y tiene coherencia completa validada;
-- ordenes_servicio (mig. 294 de este mismo feature, alta de orden) valida
-- solo rango porque el alta de orden es el camino caliente del mostrador.
--
-- NOTA (provisional, renumerar al mergear): el número 293 ya estaba tomado en
-- main por 293_limpiar_filas_fantasma_sucursal_whatsapp.sql al momento de
-- aplicar esta PR — se usa 294 para evitar colisión.
-- ============================================================================

ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS tipo_precio   TEXT NOT NULL DEFAULT 'MINORISTA',
  ADD COLUMN IF NOT EXISTS descuento_pct NUMERIC(5,2);

-- Backfill: ninguno. NOT NULL + DEFAULT constante es metadata-only en PG11+,
-- toda fila existente lee 'MINORISTA' sin reescritura de tabla — cero cambio
-- de comportamiento para clientes que nunca se marcaron mayoristas.

ALTER TABLE clientes DROP CONSTRAINT IF EXISTS clientes_tipo_precio_check;
ALTER TABLE clientes ADD CONSTRAINT clientes_tipo_precio_check
  CHECK (tipo_precio IN ('MINORISTA','MAYORISTA')) NOT VALID;
ALTER TABLE clientes VALIDATE CONSTRAINT clientes_tipo_precio_check;

-- Rango y coherencia en un solo constraint: un MINORISTA no puede tener un %
-- guardado (evita el estado inconsistente "minorista con descuento fantasma").
ALTER TABLE clientes DROP CONSTRAINT IF EXISTS clientes_descuento_pct_check;
ALTER TABLE clientes ADD CONSTRAINT clientes_descuento_pct_check
  CHECK (
    (tipo_precio = 'MAYORISTA' AND (descuento_pct IS NULL OR (descuento_pct >= 0 AND descuento_pct <= 100)))
    OR (tipo_precio <> 'MAYORISTA' AND descuento_pct IS NULL)
  ) NOT VALID;
ALTER TABLE clientes VALIDATE CONSTRAINT clientes_descuento_pct_check;

-- ----------------------------------------------------------------------------
-- OBLIGATORIO: v_clientes_resumen congeló la expansión de `c.*` al definirse
-- (273_deuda_solo_ordenes_cobrables.sql). CREATE OR REPLACE VIEW FALLA acá:
-- Postgres solo permite agregar columnas al final, y esta nueva expansión de
-- c.* inserta tipo_precio/descuento_pct ANTES de ordenes_count, no al final.
-- Sin este DROP+CREATE, la lista de clientes (que lee la vista) nunca
-- mostraría el badge mayorista aunque el detalle (que lee `clientes` directo)
-- sí lo haga — una falla silenciosa, sin error en ningún lado.
--
-- Recreación TEXTUAL de la definición de 273 (sin CASCADE a propósito: si
-- apareciera un dependiente inesperado, que falle ruidosamente en vez de
-- borrarlo en silencio).
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_clientes_resumen;
CREATE VIEW v_clientes_resumen AS
SELECT
  c.*,
  COALESCE(agg.ordenes_count, 0)   AS ordenes_count,
  agg.ultima_visita                AS ultima_visita,
  COALESCE(agg.deuda_pendiente, 0) AS deuda_pendiente,
  sec.sectores_texto               AS sectores_texto
FROM clientes c
LEFT JOIN (
  SELECT
    cliente_id,
    COUNT(*)            AS ordenes_count,
    MAX(fecha_ingreso)  AS ultima_visita,
    SUM(
      CASE WHEN estado_cobro IN ('PENDIENTE','PARCIAL')
                AND estado IN ('REPARADO','ENTREGADO')
        THEN GREATEST(
          COALESCE(costo_final, 0)
          - COALESCE(descuento_cobro, 0)
          - COALESCE(total_cobrado, 0), 0)
        ELSE 0 END
    ) AS deuda_pendiente
  FROM ordenes_servicio
  GROUP BY cliente_id
) agg ON agg.cliente_id = c.id
LEFT JOIN (
  SELECT cliente_id, string_agg(nombre, ' ') AS sectores_texto
  FROM sectores_cliente
  WHERE activo = true
  GROUP BY cliente_id
) sec ON sec.cliente_id = c.id;

-- Smoke test manual post-aplicación (no automatizable desde acá):
--   SELECT tipo_precio FROM v_clientes_resumen LIMIT 1;
-- Debe ejecutar sin error. Si falla, la vista no se reconstruyó.

-- Sin índice en tipo_precio: no hay filtro por mayorista en el alcance de
-- esta PR, y el listado ya filtra por organization_id con limit <= 100. Un
-- índice parcial sin uso es peso muerto — se agrega si el filtro se pide.

-- ============================================================================
-- ROLLBACK MANUAL de esta migración — NO se ejecuta solo, es una receta.
-- Este repo aplica migraciones a mano (scripts/db-run.mjs, sin Supabase CLI
-- ni CI); pegar el bloque de abajo en el SQL editor solo si hace falta
-- revertir 294 completa. Orden inverso al de arriba: primero los CHECK y las
-- columnas nuevas, después la vista (recreada verbatim como en 273, ya que
-- quedó sin las columnas de tipo_precio/descuento_pct en su expansión c.*).
--
-- ALTER TABLE clientes DROP CONSTRAINT IF EXISTS clientes_descuento_pct_check;
-- ALTER TABLE clientes DROP CONSTRAINT IF EXISTS clientes_tipo_precio_check;
-- ALTER TABLE clientes DROP COLUMN IF EXISTS descuento_pct;
-- ALTER TABLE clientes DROP COLUMN IF EXISTS tipo_precio;
--
-- DROP VIEW IF EXISTS v_clientes_resumen;
-- CREATE VIEW v_clientes_resumen AS
-- SELECT
--   c.*,
--   COALESCE(agg.ordenes_count, 0)   AS ordenes_count,
--   agg.ultima_visita                AS ultima_visita,
--   COALESCE(agg.deuda_pendiente, 0) AS deuda_pendiente,
--   sec.sectores_texto               AS sectores_texto
-- FROM clientes c
-- LEFT JOIN (
--   SELECT
--     cliente_id,
--     COUNT(*)            AS ordenes_count,
--     MAX(fecha_ingreso)  AS ultima_visita,
--     SUM(
--       CASE WHEN estado_cobro IN ('PENDIENTE','PARCIAL')
--                 AND estado IN ('REPARADO','ENTREGADO')
--         THEN GREATEST(
--           COALESCE(costo_final, 0)
--           - COALESCE(descuento_cobro, 0)
--           - COALESCE(total_cobrado, 0), 0)
--         ELSE 0 END
--     ) AS deuda_pendiente
--   FROM ordenes_servicio
--   GROUP BY cliente_id
-- ) agg ON agg.cliente_id = c.id
-- LEFT JOIN (
--   SELECT cliente_id, string_agg(nombre, ' ') AS sectores_texto
--   FROM sectores_cliente
--   WHERE activo = true
--   GROUP BY cliente_id
-- ) sec ON sec.cliente_id = c.id;
--
-- Smoke test post-rollback: SELECT * FROM v_clientes_resumen LIMIT 1; no debe
-- traer tipo_precio ni descuento_pct.
-- ============================================================================
