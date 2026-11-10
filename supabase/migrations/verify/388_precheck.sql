-- Pre-check of 388 (entrega idempotente y reservas de cotización): READ-ONLY.
--
-- Correrlo ANTES de aplicar la migración, contra la misma base:
--
--   node scripts/db-run.mjs supabase/migrations/verify/388_precheck.sql
--
-- (sin --apply: db-run lo envuelve en una transacción y hace rollback; además
-- la primera sentencia la vuelve READ ONLY.)
--
-- Lista las órdenes que tienen MÁS DE UN CARGO vigente (no revertido) en
-- cuenta_corriente. Con alguna fila acá, la migración 388 aborta antes de crear
-- el índice único (MIGRACION_388: ...). Son las órdenes que recibieron la deuda
-- dos veces por entregas concurrentes.
--
-- Qué hacer con cada fila: confirmar con el cliente / el arqueo cuál cargo
-- sobra (normalmente el segundo, mismo monto y segundos de diferencia) y
-- revertirlo desde la cuenta corriente del cliente (revertir_cargos_orden,
-- migración 319, que asienta la DEVOLUCION y marca el cargo revertido). Después
-- volver a correr este archivo: tiene que dar 0 filas antes de aplicar la 388.
--
-- (Garantías no hace falta revisarlas: garantias.orden_id es UNIQUE desde la
-- 001, así que una segunda garantía de la misma orden nunca se pudo insertar.)

SET TRANSACTION READ ONLY;

-- CARGO vigentes duplicados por orden
SELECT cc.organization_id,
       cc.referencia_id                 AS orden_id,
       o.numero_orden,
       string_agg(DISTINCT cc.cliente_id, ',') AS clientes,
       COUNT(*)                         AS cargos_vigentes,
       SUM(cc.monto)                    AS monto_total,
       string_agg(cc.id || ' (' || cc.monto || ' @ ' || cc.created_at || ')', ', ' ORDER BY cc.created_at) AS cargos
  FROM cuenta_corriente cc
  LEFT JOIN ordenes_servicio o ON o.id = cc.referencia_id
 WHERE cc.tipo = 'CARGO'
   AND cc.referencia_tipo = 'ORDEN'
   AND cc.revertido_at IS NULL
 GROUP BY cc.organization_id, cc.referencia_id, o.numero_orden
HAVING COUNT(*) > 1
 ORDER BY cc.organization_id, o.numero_orden;
