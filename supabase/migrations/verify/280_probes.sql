-- =============================================================================
-- Verificación de la migración 280 — RPCs atómicos agregar_servicio_orden /
-- eliminar_servicio_orden.
-- Correr en el SQL editor de Supabase Studio, DESPUES de aplicar 280.
--
-- Todo corre dentro de BEGIN/ROLLBACK: no persiste ningún dato.
-- =============================================================================

BEGIN;

-- Se opera sobre una orden REAL en vez de insertar una sintética. ordenes_servicio
-- tiene varios NOT NULL sin default —cliente_id (001_schema.sql:186), sucursal_id
-- (207_sucursales_set_not_null.sql:25), dispositivo y tipo_dispositivo (001:189-190)—
-- y armar una fila válida a mano es frágil: se rompe con cada columna nueva. Todo
-- corre dentro de BEGIN/ROLLBACK, así que la orden elegida no queda modificada;
-- cada probe además resetea explícitamente el estado que necesita antes de correr.
CREATE TEMP TABLE _probe_orden AS
SELECT id, organization_id FROM ordenes_servicio ORDER BY id LIMIT 1;

-- ---------------------------------------------------------------------------
-- PROBE 0 — Setup
-- ESPERADO: OK. Si dice ABORTAR, correr esto en un entorno con al menos una orden.
-- ---------------------------------------------------------------------------
SELECT CASE WHEN COUNT(*) = 0
            THEN 'ABORTAR: no hay ordenes en la base'
            ELSE 'OK: orden de prueba seleccionada' END AS probe_0_setup
FROM _probe_orden;

-- Limpia las líneas de servicio existentes de la orden elegida (dentro de la
-- transacción, no persiste) para partir siempre de una suma conocida = 0.
DELETE FROM servicios_orden WHERE orden_id IN (SELECT id FROM _probe_orden);

-- ---------------------------------------------------------------------------
-- PROBE 1 — Agregar una línea en una orden sin costo previo y sin cobros
--           autocompleta costo_final.
-- ESPERADO: OK
-- ---------------------------------------------------------------------------
UPDATE ordenes_servicio o
SET costo_final = NULL, total_cobrado = 0, estado = 'RECIBIDO'
FROM _probe_orden p WHERE o.id = p.id;

WITH r AS (
  SELECT agregar_servicio_orden(
    p.id, p.organization_id, NULL, 'Instalacion de Windows', 1, 25000
  ) AS resultado
  FROM _probe_orden p
)
SELECT CASE
         WHEN (resultado->>'costoFinalActualizado')::boolean = true
          AND (resultado->>'sumaServicios')::numeric = 25000
          AND (resultado->>'id') IS NOT NULL
         THEN 'OK'
         ELSE 'FALLA: ' || resultado::text
       END AS probe_1_agrega_y_sincroniza
FROM r;

SELECT CASE WHEN o.costo_final = 25000
            THEN 'OK' ELSE 'FALLA: costo_final quedo en ' || COALESCE(o.costo_final::text, 'NULL')
       END AS probe_1b_persistido_en_la_orden
FROM ordenes_servicio o JOIN _probe_orden p ON p.id = o.id;

-- ---------------------------------------------------------------------------
-- PROBE 2 — Si la orden ya tiene cobros (total_cobrado > 0), agregar una línea
--           NO debe tocar costo_final.
-- ESPERADO: OK
-- ---------------------------------------------------------------------------
DELETE FROM servicios_orden WHERE orden_id IN (SELECT id FROM _probe_orden);

UPDATE ordenes_servicio o
SET costo_final = NULL, total_cobrado = 10000, estado = 'RECIBIDO'
FROM _probe_orden p WHERE o.id = p.id;

WITH r AS (
  SELECT agregar_servicio_orden(
    p.id, p.organization_id, NULL, 'Extra', 1, 5000
  ) AS resultado
  FROM _probe_orden p
)
SELECT CASE
         WHEN (resultado->>'costoFinalActualizado')::boolean = false
         THEN 'OK'
         ELSE 'FALLA: ' || resultado::text
       END AS probe_2_no_sincroniza_con_cobros
FROM r;

SELECT CASE WHEN o.costo_final IS NULL
            THEN 'OK' ELSE 'FALLA: costo_final se escribio igual (' || o.costo_final::text || ')'
       END AS probe_2b_no_persistido
FROM ordenes_servicio o JOIN _probe_orden p ON p.id = o.id;

-- ---------------------------------------------------------------------------
-- PROBE 3 — Eliminar la última línea deja costo_final en NULL (no en 0).
-- ESPERADO: OK
-- ---------------------------------------------------------------------------
DELETE FROM servicios_orden WHERE orden_id IN (SELECT id FROM _probe_orden);

INSERT INTO servicios_orden (orden_id, servicio_id, nombre, cantidad, precio_unitario)
SELECT id, NULL, 'Unica linea', 1, 5000 FROM _probe_orden;

UPDATE ordenes_servicio o
SET costo_final = 5000, total_cobrado = 0, estado = 'RECIBIDO'
FROM _probe_orden p WHERE o.id = p.id;

WITH r AS (
  SELECT eliminar_servicio_orden(
    p.id, p.organization_id,
    (SELECT so.id FROM servicios_orden so WHERE so.orden_id = p.id LIMIT 1)
  ) AS resultado
  FROM _probe_orden p
)
SELECT CASE
         WHEN (resultado->>'costoFinalActualizado')::boolean = true
          AND (resultado->>'sumaServicios')::numeric = 0
         THEN 'OK'
         ELSE 'FALLA: ' || resultado::text
       END AS probe_3_ultima_linea_null
FROM r;

SELECT CASE WHEN o.costo_final IS NULL
            THEN 'OK' ELSE 'FALLA: costo_final quedo en ' || o.costo_final::text || ' (deberia ser NULL, no 0)'
       END AS probe_3b_persistido_null
FROM ordenes_servicio o JOIN _probe_orden p ON p.id = o.id;

-- ---------------------------------------------------------------------------
-- PROBE 4 — El STATE GUARD se niega a vaciar costo_final cuando la orden ya
--           está en REPARADO (o en cualquier estado de ESTADOS_COSTO_FINAL_BLOQUEADO).
-- ESPERADO: OK
-- ---------------------------------------------------------------------------
DELETE FROM servicios_orden WHERE orden_id IN (SELECT id FROM _probe_orden);

INSERT INTO servicios_orden (orden_id, servicio_id, nombre, cantidad, precio_unitario)
SELECT id, NULL, 'Unica linea reparado', 1, 25000 FROM _probe_orden;

UPDATE ordenes_servicio o
SET costo_final = 25000, total_cobrado = 0, estado = 'REPARADO'
FROM _probe_orden p WHERE o.id = p.id;

WITH r AS (
  SELECT eliminar_servicio_orden(
    p.id, p.organization_id,
    (SELECT so.id FROM servicios_orden so WHERE so.orden_id = p.id LIMIT 1)
  ) AS resultado
  FROM _probe_orden p
)
SELECT CASE
         WHEN (resultado->>'costoFinalActualizado')::boolean = false
          AND (resultado->>'sumaServicios')::numeric = 0
         THEN 'OK'
         ELSE 'FALLA: ' || resultado::text
       END AS probe_4_bloqueado_en_reparado
FROM r;

SELECT CASE WHEN o.costo_final = 25000
            THEN 'OK' ELSE 'FALLA: costo_final se vacio igual (' || COALESCE(o.costo_final::text, 'NULL') || ')'
       END AS probe_4b_costo_final_intacto
FROM ordenes_servicio o JOIN _probe_orden p ON p.id = o.id;

-- Vuelve a un estado no terminal para no interferir con probes siguientes.
UPDATE ordenes_servicio o SET estado = 'RECIBIDO'
FROM _probe_orden p WHERE o.id = p.id;

-- ---------------------------------------------------------------------------
-- PROBE 5 — organization_id equivocado devuelve el error y no toca datos.
--           Cubre las dos funciones: el predicado de tenant es obligatorio en
--           ambas porque los callers usan service_role (bypassea RLS).
-- ESPERADO: OK
-- ---------------------------------------------------------------------------
DELETE FROM servicios_orden WHERE orden_id IN (SELECT id FROM _probe_orden);

WITH r AS (
  SELECT agregar_servicio_orden(
    p.id, 'org-tenant-erroneo-000', NULL, 'No deberia insertarse', 1, 999
  ) AS resultado
  FROM _probe_orden p
)
SELECT CASE
         WHEN resultado->>'error' = 'Orden no encontrada'
         THEN 'OK' ELSE 'FALLA: ' || resultado::text
       END AS probe_5a_agregar_org_equivocada
FROM r;

-- Comprobación de que la falla anterior no insertó nada:
SELECT CASE WHEN NOT EXISTS (
              SELECT 1 FROM servicios_orden WHERE orden_id IN (SELECT id FROM _probe_orden)
            )
            THEN 'OK' ELSE 'FALLA: se inserto una linea pese al organization_id equivocado'
       END AS probe_5a2_no_inserto;

INSERT INTO servicios_orden (orden_id, servicio_id, nombre, cantidad, precio_unitario)
SELECT id, NULL, 'Linea protegida', 1, 4000 FROM _probe_orden;

WITH r AS (
  SELECT eliminar_servicio_orden(
    p.id, 'org-tenant-erroneo-000',
    (SELECT so.id FROM servicios_orden so WHERE so.orden_id = p.id LIMIT 1)
  ) AS resultado
  FROM _probe_orden p
)
SELECT CASE
         WHEN resultado->>'error' = 'Orden no encontrada'
         THEN 'OK' ELSE 'FALLA: ' || resultado::text
       END AS probe_5b_eliminar_org_equivocada
FROM r;

SELECT CASE WHEN EXISTS (
              SELECT 1 FROM servicios_orden WHERE orden_id IN (SELECT id FROM _probe_orden)
            )
            THEN 'OK' ELSE 'FALLA: la linea se borro pese al organization_id equivocado'
       END AS probe_5b2_no_elimino;

-- ---------------------------------------------------------------------------
-- PROBE 6 — Ambas funciones existen con la firma esperada (cantidad de
--           argumentos y tipo de retorno). El texto completo de la firma queda
--           impreso para inspección visual.
-- ESPERADO: OK en ambas filas booleanas.
-- ---------------------------------------------------------------------------
SELECT CASE WHEN EXISTS (
              SELECT 1 FROM pg_proc
              WHERE proname = 'agregar_servicio_orden'
                AND pronargs = 6
                AND pg_get_function_result(oid) = 'json'
            )
            THEN 'OK' ELSE 'FALLA: agregar_servicio_orden no existe o la firma no coincide'
       END AS probe_6a_agregar_firma;

SELECT CASE WHEN EXISTS (
              SELECT 1 FROM pg_proc
              WHERE proname = 'eliminar_servicio_orden'
                AND pronargs = 3
                AND pg_get_function_result(oid) = 'json'
            )
            THEN 'OK' ELSE 'FALLA: eliminar_servicio_orden no existe o la firma no coincide'
       END AS probe_6b_eliminar_firma;

-- Informativo: firma completa (nombre y tipo de cada argumento) para revisión manual.
SELECT proname, pg_get_function_identity_arguments(oid) AS firma
FROM pg_proc
WHERE proname IN ('agregar_servicio_orden', 'eliminar_servicio_orden')
ORDER BY proname;

ROLLBACK;
