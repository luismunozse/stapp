-- =============================================================================
-- Verificación de la migración 277 — trigger de recalculación de estado_cobro
-- Correr en el SQL editor de Supabase Studio.
--
-- CÓMO USAR:
--   1. Correr este archivo ANTES de aplicar 277. Los probes 2, 3 y 4 deben FALLAR
--      (devuelven FALLA). Eso confirma que el bug existe y que el probe lo detecta.
--   2. Aplicar 277_trigger_recalcular_estado_cobro.sql.
--   3. Volver a correr este archivo. Los cuatro probes deben devolver OK.
--
-- Todo corre dentro de BEGIN/ROLLBACK: no persiste ningún dato.
-- =============================================================================

BEGIN;

-- Se opera sobre una orden REAL en vez de insertar una sintética. ordenes_servicio
-- tiene varios NOT NULL sin default —cliente_id (001_schema.sql:186), sucursal_id
-- (207_sucursales_set_not_null.sql:25), dispositivo y tipo_dispositivo (001:189-190)—
-- y armar una fila válida a mano es frágil: se rompe con cada columna nueva.
-- Todo corre dentro de BEGIN/ROLLBACK, así que la orden elegida no queda modificada.
CREATE TEMP TABLE _probe AS
SELECT o.id, SUM(c.monto) AS cobrado
FROM ordenes_servicio o
JOIN cobros_orden c ON c.orden_id = o.id AND c.anulado = FALSE
GROUP BY o.id
HAVING SUM(c.monto) > 0
LIMIT 1;

-- ---------------------------------------------------------------------------
-- PROBE 0 — Setup
-- ESPERADO: OK. Si dice ABORTAR, no hay datos con los que probar: correr esto
-- en un entorno que tenga al menos una orden con cobros no anulados.
-- ---------------------------------------------------------------------------
SELECT CASE WHEN COUNT(*) = 0
            THEN 'ABORTAR: no hay ordenes con cobros'
            ELSE 'OK: orden de prueba seleccionada' END AS probe_0_setup
FROM _probe;

-- Punto de partida conocido: costo_final igual a lo cobrado, sin descuento.
UPDATE ordenes_servicio o
SET costo_final = p.cobrado, descuento_cobro = 0
FROM _probe p WHERE o.id = p.id;

SELECT recalcular_estado_cobro(id) FROM _probe;

-- ---------------------------------------------------------------------------
-- PROBE 1 — Estado inicial consistente
-- ESPERADO: OK  (pasa con y sin la migración; valida el setup)
-- ---------------------------------------------------------------------------
SELECT CASE WHEN o.estado_cobro = 'COBRADO'
            THEN 'OK' ELSE 'FALLA: ' || o.estado_cobro END AS probe_1_estado_inicial
FROM ordenes_servicio o JOIN _probe p ON p.id = o.id;

-- ---------------------------------------------------------------------------
-- PROBE 2 — Duplicar costo_final debe degradar el estado a PARCIAL
-- ESPERADO SIN 277: FALLA (queda en COBRADO)   |   CON 277: OK
-- ---------------------------------------------------------------------------
UPDATE ordenes_servicio o SET costo_final = p.cobrado * 2
FROM _probe p WHERE o.id = p.id;

SELECT CASE WHEN o.estado_cobro = 'PARCIAL'
            THEN 'OK' ELSE 'FALLA: quedo en ' || o.estado_cobro END AS probe_2_sube_costo_final
FROM ordenes_servicio o JOIN _probe p ON p.id = o.id;

-- ---------------------------------------------------------------------------
-- PROBE 3 — Un descuento que cubre el saldo debe volver el estado a COBRADO
-- ESPERADO SIN 277: FALLA   |   CON 277: OK
-- ---------------------------------------------------------------------------
UPDATE ordenes_servicio o SET descuento_cobro = p.cobrado
FROM _probe p WHERE o.id = p.id;

SELECT CASE WHEN o.estado_cobro = 'COBRADO'
            THEN 'OK' ELSE 'FALLA: quedo en ' || o.estado_cobro END AS probe_3_descuento_cubre_saldo
FROM ordenes_servicio o JOIN _probe p ON p.id = o.id;

-- ---------------------------------------------------------------------------
-- PROBE 4 — Anular el costo debe dejar el estado en PENDIENTE
-- ESPERADO SIN 277: FALLA   |   CON 277: OK
-- ---------------------------------------------------------------------------
UPDATE ordenes_servicio SET costo_final = NULL, descuento_cobro = 0
WHERE id IN (SELECT id FROM _probe);

SELECT CASE WHEN o.estado_cobro = 'PENDIENTE'
            THEN 'OK' ELSE 'FALLA: quedo en ' || o.estado_cobro END AS probe_4_costo_nulo
FROM ordenes_servicio o JOIN _probe p ON p.id = o.id;

-- ---------------------------------------------------------------------------
-- PROBE 5 — Un update que NO toca costo_final ni descuento_cobro no debe
--           disparar el trigger ni alterar el estado de cobro.
-- ESPERADO CON 277: OK. Si falla, el UPDATE OF está listando de más.
-- ---------------------------------------------------------------------------
UPDATE ordenes_servicio o SET costo_final = p.cobrado * 2
FROM _probe p WHERE o.id = p.id;

UPDATE ordenes_servicio SET observaciones = COALESCE(observaciones, '')
WHERE id IN (SELECT id FROM _probe);

SELECT CASE WHEN o.estado_cobro = 'PARCIAL'
            THEN 'OK' ELSE 'FALLA: quedo en ' || o.estado_cobro END AS probe_5_update_irrelevante
FROM ordenes_servicio o JOIN _probe p ON p.id = o.id;

ROLLBACK;
