-- ============================================================================
-- 327 — BACKFILL: fecha_completado para ordenes entregadas que la saltaron
-- ============================================================================
-- Correr DESPUES de leer 327_auditoria_fecha_completado.sql.
--
-- CONTEXTO: ver el encabezado de 327_auditoria_fecha_completado.sql y el PR
-- que acompaña esta migracion (cierra el camino de escritura en
-- app/api/ordenes/[id]/entregar/route.ts: ese POST nunca escribia
-- fecha_completado, y la maquina de estados permite SIN_FALLA_DETECTADA ->
-- ENTREGADO* saltando REPARADO, el UNICO otro lugar que la escribia).
--
-- Este backfill tapa el dato ya roto, igual que la migracion 179 lo hizo para
-- el mismo sintoma en ordenes legacy pre-trigger. A diferencia de la 179 (que
-- usaba COALESCE(fecha_entrega, fecha_ingreso) porque tambien cubria REPARADO,
-- un estado que puede no tener fecha_entrega todavia porque la orden no se
-- entrego), este backfill es SOLO para los tres estados ENTREGADO*, y esos
-- SIEMPRE tienen fecha_entrega: la escribe incondicionalmente el propio POST
-- /entregar en cada entrega (app/api/ordenes/[id]/entregar/route.ts). Por eso
-- el valor correcto es fecha_entrega sin fallback — es el momento real en que
-- la orden se le devolvio al cliente, la misma regla que el fix de codigo
-- aplica de ahora en mas para las entregas nuevas (si fecha_completado ya
-- estaba NULL al entregar, se setea con el momento de esa entrega).
--
-- Es idempotente: el WHERE excluye toda fila que ya tenga fecha_completado,
-- asi que correrlo dos veces deja el mismo resultado. NUNCA toca una fila que
-- ya tiene el campo cargado — eso pisaria el devengo original de una orden
-- reparada en un mes y entregada en otro (reingreso).
--
-- Corre dentro de una transaccion. Revisar el resultado del SELECT final y
-- recien ahi cambiar el ROLLBACK por COMMIT.
-- ============================================================================

BEGIN;

-- 0. Control previo: filas que este backfill NO puede arreglar porque ni
--    siquiera tienen fecha_entrega. No deberia pasar nunca —el POST /entregar
--    la escribe siempre en las tres transiciones ENTREGADO*— pero si aparece
--    algo hay que investigarlo aparte en vez de dejarlo pasar en silencio.
--    Estas filas NO se tocan (ver el WHERE del UPDATE de abajo).
SELECT
  id, organization_id, numero_orden, codigo_orden, estado, fecha_ingreso
FROM ordenes_servicio
WHERE fecha_completado IS NULL
  AND estado IN ('ENTREGADO', 'ENTREGADO_SIN_REPARACION', 'ENTREGADO_SIN_COBRO')
  AND fecha_entrega IS NULL;

-- 1. El backfill en si: solo toca filas rotas (fecha_completado NULL) en los
--    tres estados de entrega, y solo cuando hay fecha_entrega de donde tomar
--    el valor.
UPDATE ordenes_servicio
SET fecha_completado = fecha_entrega
WHERE fecha_completado IS NULL
  AND estado IN ('ENTREGADO', 'ENTREGADO_SIN_REPARACION', 'ENTREGADO_SIN_COBRO')
  AND fecha_entrega IS NOT NULL;

-- 2. Control: cuantas filas rotas quedan. Tienen que ser exactamente las que
--    el control previo (0) ya habia detectado (fecha_entrega NULL, fuera del
--    alcance de este backfill) — idealmente cero. Si el numero es mayor a lo
--    que el paso 0 mostro, NO commitear: algo tocó estas filas entre el
--    paso 0 y este.
SELECT COUNT(*) AS filas_todavia_rotas
FROM ordenes_servicio
WHERE fecha_completado IS NULL
  AND estado IN ('ENTREGADO', 'ENTREGADO_SIN_REPARACION', 'ENTREGADO_SIN_COBRO');

-- Cambiar por COMMIT cuando filas_todavia_rotas coincida con lo esperado
-- (idealmente 0, o el mismo conteo que devolvio el paso 0).
ROLLBACK;
