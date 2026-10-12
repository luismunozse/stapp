-- =============================================================================
-- Verificación de la migración 304 — limpieza del costo_final huérfano y el
-- state guard de aplicar_monto_servicios_orden.
-- Correr en el SQL editor de Supabase Studio, DESPUES de aplicar 304.
--
-- Todo corre dentro de BEGIN/ROLLBACK: no persiste ningún dato.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE _probe_orden AS
SELECT id, organization_id FROM ordenes_servicio ORDER BY id LIMIT 1;

SELECT CASE WHEN COUNT(*) = 0
            THEN 'ABORTAR: no hay ordenes en la base'
            ELSE 'OK: orden de prueba seleccionada' END AS probe_0_setup
FROM _probe_orden;

DELETE FROM servicios_orden WHERE orden_id IN (SELECT id FROM _probe_orden);
DELETE FROM cobros_orden WHERE orden_id IN (SELECT id FROM _probe_orden);
SELECT recalcular_estado_cobro(id) FROM _probe_orden;

-- ---------------------------------------------------------------------------
-- PROBE 1 — El costo_final con la huella de la regla vieja se limpia
--
-- Simula el estado exacto que dejó la 301: una orden EN_DIAGNOSTICO con una
-- línea de 25000 y costo_final = 25000 (escrito por la regla vieja), presupuesto
-- vacío. Al agregar otra línea, el presupuesto pasa a 33000 y el costo_final
-- huérfano se limpia.
--
-- ESPERADO: limpiado = true, presupuesto = 33000, costo_final vacío (NULL)
-- ---------------------------------------------------------------------------
UPDATE ordenes_servicio SET estado = 'EN_DIAGNOSTICO', presupuesto = NULL, costo_final = 25000
WHERE id IN (SELECT id FROM _probe_orden);

INSERT INTO servicios_orden (orden_id, servicio_id, nombre, cantidad, precio_unitario)
SELECT id, NULL, 'Linea de la regla vieja', 1, 25000 FROM _probe_orden;

SELECT
  (agregar_servicio_orden(o.id, o.organization_id, NULL, 'Linea nueva', 1, 8000)->>'costoFinalHuerfanoLimpiado') AS probe_1_limpiado,
  (SELECT presupuesto FROM ordenes_servicio WHERE id = o.id) AS probe_1_presupuesto,
  (SELECT costo_final FROM ordenes_servicio WHERE id = o.id) AS probe_1_costo_final
FROM _probe_orden o;

-- ---------------------------------------------------------------------------
-- PROBE 2 — Un costo_final que NO coincide con la suma queda intacto
--
-- Es el caso de un número tipeado por una persona: no lleva la huella de la
-- regla vieja y no se toca.
--
-- ESPERADO: limpiado = false, costo_final SIGUE en 90000
-- ---------------------------------------------------------------------------
DELETE FROM servicios_orden WHERE orden_id IN (SELECT id FROM _probe_orden);
UPDATE ordenes_servicio SET estado = 'EN_DIAGNOSTICO', presupuesto = NULL, costo_final = 90000
WHERE id IN (SELECT id FROM _probe_orden);

SELECT
  (agregar_servicio_orden(o.id, o.organization_id, NULL, 'Otra linea', 1, 12000)->>'costoFinalHuerfanoLimpiado') AS probe_2_limpiado,
  (SELECT costo_final FROM ordenes_servicio WHERE id = o.id) AS probe_2_costo_final
FROM _probe_orden o;

-- ---------------------------------------------------------------------------
-- PROBE 3 — Del lado del costo final NO se limpia el presupuesto
--
-- El presupuesto es el registro de lo que el cliente aprobó: se conserva. La
-- limpieza es asimétrica a propósito.
--
-- ESPERADO: limpiado = false, presupuesto SIGUE en 15000
-- ---------------------------------------------------------------------------
DELETE FROM servicios_orden WHERE orden_id IN (SELECT id FROM _probe_orden);
UPDATE ordenes_servicio SET estado = 'EN_REPARACION', presupuesto = 15000, costo_final = NULL
WHERE id IN (SELECT id FROM _probe_orden);

SELECT
  (agregar_servicio_orden(o.id, o.organization_id, NULL, 'Trabajo', 1, 20000)->>'costoFinalHuerfanoLimpiado') AS probe_3_limpiado,
  (SELECT presupuesto FROM ordenes_servicio WHERE id = o.id) AS probe_3_presupuesto,
  (SELECT costo_final FROM ordenes_servicio WHERE id = o.id) AS probe_3_costo_final
FROM _probe_orden o;

-- ---------------------------------------------------------------------------
-- PROBE 4 — EL BUG DE LA 303: aplicar con cero líneas en una orden REPARADA
--
-- Sin el guard, NULLIF(0, 0) dejaba costo_final en NULL y la deuda desaparecía
-- al entregar. Es el bug 2b que el PR #254 había cerrado para la ruta automática.
--
-- ESPERADO: un error que menciona "sin costo final", y costo_final SIGUE en 30000
-- ---------------------------------------------------------------------------
DELETE FROM servicios_orden WHERE orden_id IN (SELECT id FROM _probe_orden);
UPDATE ordenes_servicio SET estado = 'REPARADO', costo_final = 30000
WHERE id IN (SELECT id FROM _probe_orden);

SELECT
  (aplicar_monto_servicios_orden(o.id, o.organization_id)->>'error') AS probe_4_error,
  (SELECT costo_final FROM ordenes_servicio WHERE id = o.id) AS probe_4_costo_final
FROM _probe_orden o;

-- ---------------------------------------------------------------------------
-- PROBE 5 — El gemelo del lado del presupuesto
-- ESPERADO: error que menciona "sin presupuesto", presupuesto SIGUE en 20000
-- ---------------------------------------------------------------------------
UPDATE ordenes_servicio SET estado = 'PRESUPUESTADO', presupuesto = 20000
WHERE id IN (SELECT id FROM _probe_orden);

SELECT
  (aplicar_monto_servicios_orden(o.id, o.organization_id)->>'error') AS probe_5_error,
  (SELECT presupuesto FROM ordenes_servicio WHERE id = o.id) AS probe_5_presupuesto
FROM _probe_orden o;

-- ---------------------------------------------------------------------------
-- PROBE 6 — Aplicar con líneas cargadas sigue funcionando
-- ESPERADO: campo = 'costo_final', costo_final = 45000, sin error
-- ---------------------------------------------------------------------------
UPDATE ordenes_servicio SET estado = 'REPARADO', costo_final = 30000
WHERE id IN (SELECT id FROM _probe_orden);

INSERT INTO servicios_orden (orden_id, servicio_id, nombre, cantidad, precio_unitario)
SELECT id, NULL, 'Trabajo real', 1, 45000 FROM _probe_orden;

SELECT
  (aplicar_monto_servicios_orden(o.id, o.organization_id)->>'campoSincronizado') AS probe_6_campo,
  (SELECT costo_final FROM ordenes_servicio WHERE id = o.id) AS probe_6_costo_final
FROM _probe_orden o;

-- ---------------------------------------------------------------------------
-- PROBE 7 — No quedaron sobrecargas de los RPCs
-- ESPERADO: 1 fila por cada nombre.
-- ---------------------------------------------------------------------------
SELECT proname, COUNT(*) AS versiones
FROM pg_proc
WHERE proname IN ('agregar_servicio_orden', 'eliminar_servicio_orden', 'aplicar_monto_servicios_orden')
GROUP BY proname
ORDER BY proname;

ROLLBACK;
