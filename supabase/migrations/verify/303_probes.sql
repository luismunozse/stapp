-- =============================================================================
-- Verificación de la migración 303 — sincronización del monto VIVO por estado.
-- Correr en el SQL editor de Supabase Studio, DESPUES de aplicar 303.
--
-- Cubre lo que los tests de vitest NO pueden alcanzar: la regla vive en plpgsql
-- porque el lock (FOR UPDATE) solo existe dentro de la transacción del RPC, y
-- un mock de supabaseAdmin.rpc no ejecuta nada de esto.
--
-- Todo corre dentro de BEGIN/ROLLBACK: no persiste ningún dato.
-- =============================================================================

BEGIN;

-- Misma estrategia que 301_probes.sql: se opera sobre una orden REAL, porque
-- ordenes_servicio tiene varios NOT NULL sin default y armar una fila sintética
-- se rompe con cada columna nueva.
CREATE TEMP TABLE _probe_orden AS
SELECT id, organization_id FROM ordenes_servicio ORDER BY id LIMIT 1;

-- ---------------------------------------------------------------------------
-- PROBE 0 — Setup
-- ESPERADO: OK. total_cobrado queda en 0 DE VERDAD (es columna derivada: se
-- limpian los cobros y se recalcula, no se asigna a mano).
-- ---------------------------------------------------------------------------
SELECT CASE WHEN COUNT(*) = 0
            THEN 'ABORTAR: no hay ordenes en la base'
            ELSE 'OK: orden de prueba seleccionada' END AS probe_0_setup
FROM _probe_orden;

DELETE FROM servicios_orden WHERE orden_id IN (SELECT id FROM _probe_orden);
DELETE FROM cobros_orden WHERE orden_id IN (SELECT id FROM _probe_orden);
SELECT recalcular_estado_cobro(id) FROM _probe_orden;

-- ---------------------------------------------------------------------------
-- PROBE 1 — Orden RECIBIDO: la línea alimenta el PRESUPUESTO, no el costo final
-- ESPERADO: campo = 'presupuesto', presupuesto = 25000, costo_final = NULL
-- ---------------------------------------------------------------------------
UPDATE ordenes_servicio SET estado = 'RECIBIDO', presupuesto = NULL, costo_final = NULL
WHERE id IN (SELECT id FROM _probe_orden);

SELECT
  (agregar_servicio_orden(o.id, o.organization_id, NULL, 'Diagnostico', 1, 25000)->>'campoSincronizado') AS probe_1_campo,
  (SELECT presupuesto FROM ordenes_servicio WHERE id = o.id) AS probe_1_presupuesto,
  (SELECT costo_final FROM ordenes_servicio WHERE id = o.id) AS probe_1_costo_final
FROM _probe_orden o;

-- ---------------------------------------------------------------------------
-- PROBE 2 — Orden EN_REPARACION: la línea alimenta el COSTO FINAL
-- ESPERADO: campo = 'costo_final', costo_final = 40000 (25000 + 15000),
--           presupuesto sin cambios respecto de PROBE 1 (25000)
-- ---------------------------------------------------------------------------
UPDATE ordenes_servicio SET estado = 'EN_REPARACION' WHERE id IN (SELECT id FROM _probe_orden);

SELECT
  (agregar_servicio_orden(o.id, o.organization_id, NULL, 'Cambio de pasta', 1, 15000)->>'campoSincronizado') AS probe_2_campo,
  (SELECT costo_final FROM ordenes_servicio WHERE id = o.id) AS probe_2_costo_final,
  (SELECT presupuesto FROM ordenes_servicio WHERE id = o.id) AS probe_2_presupuesto
FROM _probe_orden o;

-- ---------------------------------------------------------------------------
-- PROBE 3 — Estado terminal: no se sincroniza ningún monto
-- ESPERADO: campo = NULL (vacío), montoActualizado = false
-- ---------------------------------------------------------------------------
UPDATE ordenes_servicio SET estado = 'ENTREGADO' WHERE id IN (SELECT id FROM _probe_orden);

SELECT
  (agregar_servicio_orden(o.id, o.organization_id, NULL, 'Post entrega', 1, 1000)->>'campoSincronizado') AS probe_3_campo,
  (agregar_servicio_orden(o.id, o.organization_id, NULL, 'Post entrega 2', 1, 1000)->>'montoActualizado') AS probe_3_actualizado
FROM _probe_orden o;

-- ---------------------------------------------------------------------------
-- PROBE 4 — STATE GUARD del presupuesto
-- Una orden ya PRESUPUESTADA no puede quedarse sin presupuesto al borrar la
-- última línea: ese gate ya se cruzó y el cliente ve ese número en el portal.
-- ESPERADO: montoActualizado = false y presupuesto SIGUE en 7000 (no NULL)
-- ---------------------------------------------------------------------------
DELETE FROM servicios_orden WHERE orden_id IN (SELECT id FROM _probe_orden);
UPDATE ordenes_servicio SET estado = 'RECIBIDO', presupuesto = NULL, costo_final = NULL
WHERE id IN (SELECT id FROM _probe_orden);

-- Se carga la línea en RECIBIDO (autocompleta presupuesto = 7000) y recién
-- después se pasa a PRESUPUESTADO, que es el camino real.
CREATE TEMP TABLE _probe_linea AS
SELECT (agregar_servicio_orden(o.id, o.organization_id, NULL, 'Service completo', 1, 7000)->>'id') AS linea_id
FROM _probe_orden o;

UPDATE ordenes_servicio SET estado = 'PRESUPUESTADO' WHERE id IN (SELECT id FROM _probe_orden);

SELECT
  (eliminar_servicio_orden(o.id, o.organization_id, (SELECT linea_id FROM _probe_linea))->>'montoActualizado') AS probe_4_actualizado,
  (SELECT presupuesto FROM ordenes_servicio WHERE id = o.id) AS probe_4_presupuesto
FROM _probe_orden o;

-- ---------------------------------------------------------------------------
-- PROBE 5 — aplicar_monto_servicios_orden sobre el presupuesto
-- ESPERADO: campo = 'presupuesto', presupuesto = 18000, y el ESTADO NO cambia
--           (sigue PRESUPUESTADO): aplicar un monto no es presupuestar.
-- ---------------------------------------------------------------------------
DELETE FROM servicios_orden WHERE orden_id IN (SELECT id FROM _probe_orden);
INSERT INTO servicios_orden (orden_id, servicio_id, nombre, cantidad, precio_unitario)
SELECT id, NULL, 'Trabajo unico', 1, 18000 FROM _probe_orden;

SELECT
  (aplicar_monto_servicios_orden(o.id, o.organization_id)->>'campoSincronizado') AS probe_5_campo,
  (SELECT presupuesto FROM ordenes_servicio WHERE id = o.id) AS probe_5_presupuesto,
  (SELECT estado::TEXT FROM ordenes_servicio WHERE id = o.id) AS probe_5_estado
FROM _probe_orden o;

-- ---------------------------------------------------------------------------
-- PROBE 6 — aplicar_monto_servicios_orden NO deja el cobro al descubierto
-- Con un cobro de 50000 y líneas por 18000, aplicar dejaría costo_final por
-- debajo de lo cobrado: estado_cobro pasaría a COBRADO y la deuda desaparece.
-- ESPERADO: un error que menciona "menor a lo ya cobrado", costo_final intacto.
-- ---------------------------------------------------------------------------
UPDATE ordenes_servicio SET estado = 'REPARADO', costo_final = 60000
WHERE id IN (SELECT id FROM _probe_orden);

INSERT INTO cobros_orden (orden_id, organization_id, monto, metodo_pago, anulado)
SELECT id, organization_id, 50000, 'EFECTIVO', FALSE FROM _probe_orden;
SELECT recalcular_estado_cobro(id) FROM _probe_orden;

SELECT
  (aplicar_monto_servicios_orden(o.id, o.organization_id)->>'error') AS probe_6_error,
  (SELECT costo_final FROM ordenes_servicio WHERE id = o.id) AS probe_6_costo_final
FROM _probe_orden o;

-- ---------------------------------------------------------------------------
-- PROBE 7 — Estado terminal en aplicar_monto_servicios_orden
-- ESPERADO: error que menciona "estado terminal"
-- ---------------------------------------------------------------------------
UPDATE ordenes_servicio SET estado = 'CANCELADO' WHERE id IN (SELECT id FROM _probe_orden);

SELECT (aplicar_monto_servicios_orden(o.id, o.organization_id)->>'error') AS probe_7_error
FROM _probe_orden o;

-- ---------------------------------------------------------------------------
-- PROBE 8 — No quedaron sobrecargas de los RPCs
-- Reemplazar una función con una firma distinta CREA UNA SOBRECARGA en vez de
-- reemplazarla, y las dos versiones quedan vivas.
-- ESPERADO: 1 fila por cada nombre.
-- ---------------------------------------------------------------------------
SELECT proname, COUNT(*) AS versiones
FROM pg_proc
WHERE proname IN ('agregar_servicio_orden', 'eliminar_servicio_orden', 'aplicar_monto_servicios_orden')
GROUP BY proname
ORDER BY proname;

ROLLBACK;
