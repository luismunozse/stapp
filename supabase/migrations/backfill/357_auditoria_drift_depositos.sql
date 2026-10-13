-- Auditoria de solo lectura de la migracion 350 (invariante stock = SUM(detalle)).
--
-- Correr DESPUES de aplicar la 350:
--   node scripts/db-run.mjs supabase/migrations/backfill/350_auditoria_drift_depositos.sql
-- No modifica nada: son SELECTs independientes. Esperado tras la 350:
--   R0.a  0 filas (toda org activa tiene deposito principal; si no, los helpers
--         dan P0011 para esa org).
--   R0.b / R0.c  0 filas (ningun item con total distinto de la suma del detalle).
--   R0.d  0 filas relevantes (conteos por deposito ya aplicados con el bug A; una
--         verificacion previa en produccion, 2026-10-13, no encontro ninguno).
--   R0.e  0 filas (conteos EN_PROGRESO: finalizarlos o cancelarlos antes de aplicar).
--   R0.f  informativo: items cuyo alta no tiene movimiento (kardex historico; la 350
--         solo arregla las altas nuevas, no reconstruye las viejas).
--   R0.g  informativo: uso real de variantes (modelo sin dimension de deposito).
-- No hay scripts de reparacion: el 2026-10-13 no habia items con drift. Si R0.b
-- devolviera filas despues de aplicar, investigar la causa (columna
-- ult_ref_sospechosa) antes de corregir a mano.

-- R0.a Orgs sin depósito principal (las helpers dan P0011 para ellas)
SELECT o.id, o.nombre
FROM organizations o
WHERE o.deleted_at IS NULL
  AND get_deposito_principal(o.id) IS NULL;

-- R0.b Items con drift total vs detalle, con pistas de causa
WITH det AS (
  SELECT inventario_id,
         SUM(stock)::INT AS det_stock,
         SUM(stock_reservado)::INT AS det_reservado,
         COUNT(*) FILTER (WHERE stock > 0) AS depositos_con_stock
  FROM inventario_depositos
  GROUP BY inventario_id
), ult AS (
  SELECT DISTINCT ON (m.inventario_id)
         m.inventario_id, m.referencia_tipo AS ult_ref_sospechosa,
         m.deposito_id AS ult_ref_deposito, m.created_at AS ult_ref_at
  FROM movimientos_inventario m
  WHERE m.referencia_tipo IN ('CONTEO','ENSAMBLAJE_KIT','DESENSAMBLAJE_KIT',
                              'CONSOLIDACION','VARIANTE','CONSOLIDACION_VARIANTES',
                              'nota_credito')
  ORDER BY m.inventario_id, m.created_at DESC
)
SELECT i.organization_id, o.nombre AS org, i.id, i.codigo, i.nombre,
       COALESCE(i.stock,0) AS total,
       COALESCE(d.det_stock,0) AS detalle,
       COALESCE(i.stock,0) - COALESCE(d.det_stock,0) AS drift,
       i.stock_reservado, COALESCE(d.det_reservado,0) AS det_reservado,
       COALESCE(d.depositos_con_stock,0) AS depositos_con_stock,
       i.tiene_variantes, i.es_kit, (i.deleted_at IS NOT NULL) AS archivado,
       u.ult_ref_sospechosa, u.ult_ref_deposito, u.ult_ref_at, i.updated_at
FROM inventario i
JOIN organizations o ON o.id = i.organization_id
LEFT JOIN det d ON d.inventario_id = i.id
LEFT JOIN ult u ON u.inventario_id = i.id
WHERE COALESCE(i.stock,0) <> COALESCE(d.det_stock,0)
ORDER BY abs(COALESCE(i.stock,0) - COALESCE(d.det_stock,0)) DESC;

-- R0.c Resumen por org y causa probable
WITH det AS (
  SELECT inventario_id, SUM(stock)::INT AS s FROM inventario_depositos GROUP BY inventario_id
), ult AS (
  SELECT DISTINCT ON (m.inventario_id) m.inventario_id, m.referencia_tipo
  FROM movimientos_inventario m
  WHERE m.referencia_tipo IN ('CONTEO','ENSAMBLAJE_KIT','DESENSAMBLAJE_KIT','CONSOLIDACION',
                              'VARIANTE','CONSOLIDACION_VARIANTES','nota_credito')
  ORDER BY m.inventario_id, m.created_at DESC
)
SELECT i.organization_id,
       COALESCE(CASE WHEN i.deleted_at IS NOT NULL THEN 'ARCHIVADO' END,
                CASE WHEN i.tiene_variantes THEN 'VARIANTES' END,
                u.referencia_tipo, 'SIN_PISTA') AS causa_probable,
       COUNT(*) AS items,
       SUM(COALESCE(i.stock,0) - COALESCE(d.s,0)) AS drift_neto,
       SUM(abs(COALESCE(i.stock,0) - COALESCE(d.s,0))) AS drift_abs
FROM inventario i
LEFT JOIN det d ON d.inventario_id = i.id
LEFT JOIN ult u ON u.inventario_id = i.id
WHERE COALESCE(i.stock,0) <> COALESCE(d.s,0)
GROUP BY 1, 2
ORDER BY drift_abs DESC;

-- R0.d Conteos POR DEPÓSITO ya aplicados con el bug A (el total quedó pisado por
-- el conteo de un depósito). Solo importan los items que tenían stock en >1
-- depósito; para el resto, R2 da el mismo resultado.
SELECT c.organization_id, c.id AS conteo_id, c.nombre, c.finalizado_at, c.deposito_id,
       ci.inventario_id, ci.stock_sistema, ci.stock_contado,
       ci.diferencia AS delta_nunca_aplicado_al_detalle,
       COALESCE(i.stock,0) AS total_actual,
       COALESCE(idep.stock,0) AS dep_actual,
       (SELECT COUNT(*) FROM inventario_depositos x
         WHERE x.inventario_id = ci.inventario_id AND x.stock > 0) AS depositos_con_stock_hoy,
       GREATEST(COALESCE(idep.stock,0) + ci.diferencia, 0) AS dep_propuesto,
       (SELECT COALESCE(SUM(x.stock),0) FROM inventario_depositos x WHERE x.inventario_id = ci.inventario_id)
         - COALESCE(idep.stock,0)
         + GREATEST(COALESCE(idep.stock,0) + ci.diferencia, 0) AS total_propuesto
FROM conteos_inventario c
JOIN conteos_items ci ON ci.conteo_id = c.id
JOIN inventario i ON i.id = ci.inventario_id
LEFT JOIN inventario_depositos idep
  ON idep.inventario_id = ci.inventario_id AND idep.deposito_id = c.deposito_id
WHERE c.estado = 'FINALIZADO'
  AND c.aplicar_ajustes
  AND c.deposito_id IS NOT NULL
  AND ci.stock_contado IS NOT NULL
  AND ci.diferencia <> 0
ORDER BY c.finalizado_at, ci.inventario_id;

-- R0.e Conteos en progreso (finalizar/cancelar antes de aplicar la 350)
SELECT id, organization_id, nombre, deposito_id, iniciado_at, items_contados, total_items
FROM conteos_inventario WHERE estado = 'EN_PROGRESO' ORDER BY iniciado_at;

-- R0.f Kardex: items cuyo alta no tiene movimiento (bug G histórico)
WITH primero AS (
  SELECT DISTINCT ON (inventario_id) inventario_id, stock_anterior, created_at
  FROM movimientos_inventario
  WHERE tipo NOT IN ('TRANSFERENCIA_OUT','TRANSFERENCIA_IN')
  ORDER BY inventario_id, created_at, id
)
SELECT i.organization_id, COUNT(*) AS items_sin_alta,
       COUNT(*) FILTER (WHERE p.inventario_id IS NULL) AS sin_ningun_movimiento
FROM inventario i
LEFT JOIN primero p ON p.inventario_id = i.id
WHERE (p.inventario_id IS NULL AND COALESCE(i.stock,0) > 0)
   OR p.stock_anterior > 0
GROUP BY i.organization_id
ORDER BY items_sin_alta DESC;

-- R0.g Uso real de variantes (dimensiona el problema de modelo de H)
SELECT i.organization_id, COUNT(*) AS items_con_variantes,
       SUM(COALESCE(i.stock,0)) AS stock_total
FROM inventario i
WHERE i.tiene_variantes AND i.deleted_at IS NULL
GROUP BY i.organization_id
ORDER BY items_con_variantes DESC;
