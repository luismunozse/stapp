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
--
-- Además de limpiar las líneas de servicio, se borra cualquier cobro real de
-- la orden elegida y se recalcula, dejando total_cobrado = 0 DE VERDAD (no
-- solo en apariencia). Esto importa porque total_cobrado es una columna
-- derivada (recalcular_estado_cobro, 068_mejoras_ordenes.sql): el trigger de
-- la migración 277 la recalcula desde cobros_orden cada vez que costo_final
-- cambia de valor en el mismo UPDATE, así que forzarla a mano en ese mismo
-- statement no sirve — el trigger la pisa con la suma real. Cada probe que
-- necesita total_cobrado = 0 confía en esta limpieza inicial (o en la
-- limpieza equivalente que hace PROBE 3 después de simular un cobro) en vez
-- de asignar la columna directamente.
-- ---------------------------------------------------------------------------
SELECT CASE WHEN COUNT(*) = 0
            THEN 'ABORTAR: no hay ordenes en la base'
            ELSE 'OK: orden de prueba seleccionada' END AS probe_0_setup
FROM _probe_orden;

DELETE FROM servicios_orden WHERE orden_id IN (SELECT id FROM _probe_orden);
DELETE FROM cobros_orden WHERE orden_id IN (SELECT id FROM _probe_orden);
SELECT recalcular_estado_cobro(id) FROM _probe_orden;

-- ---------------------------------------------------------------------------
-- PROBE 1 — Agregar una línea en una orden sin costo previo y sin cobros
--           autocompleta costo_final.
-- ESPERADO: OK
-- ---------------------------------------------------------------------------
UPDATE ordenes_servicio o SET costo_final = NULL, estado = 'RECIBIDO'
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
-- PROBE 2 — El costo fue editado a mano (no coincide con la suma de líneas
--           dentro del margen de 0.005): agregar una línea NO debe pisarlo.
--           Cubre la rama epsilon (ABS(costo_final - sumaAnterior) < 0.005),
--           que sin este probe no tenía cobertura automatizada en ningún
--           lado: los 8 tests de lib/__tests__/sincronizar-costo-final.test.ts
--           ejercitan una función que ya no está en el camino de escritura
--           (ver comentario de acoplamiento al inicio de esta migración), y
--           el mock de supabaseAdmin.rpc en orden-servicios.test.ts no puede
--           alcanzar lógica que vive dentro del RPC.
-- ESPERADO: OK
-- ---------------------------------------------------------------------------
DELETE FROM servicios_orden WHERE orden_id IN (SELECT id FROM _probe_orden);

INSERT INTO servicios_orden (orden_id, servicio_id, nombre, cantidad, precio_unitario)
SELECT id, NULL, 'Linea base', 1, 5000 FROM _probe_orden;

-- costo_final = 9999 no coincide con la suma de líneas (5000): lo editó un
-- humano. Se deja en RECIBIDO (no REPARADO) a propósito para que este probe
-- aisle la rama epsilon; el STATE GUARD se prueba aparte en PROBE 5.
UPDATE ordenes_servicio o SET costo_final = 9999, estado = 'RECIBIDO'
FROM _probe_orden p WHERE o.id = p.id;

WITH r AS (
  SELECT agregar_servicio_orden(
    p.id, p.organization_id, NULL, 'Otra linea', 1, 1000
  ) AS resultado
  FROM _probe_orden p
)
SELECT CASE
         WHEN (resultado->>'costoFinalActualizado')::boolean = false
         THEN 'OK'
         ELSE 'FALLA: ' || resultado::text
       END AS probe_2a_no_pisa_costo_editado_a_mano
FROM r;

-- Se asevera el VALOR PERSISTIDO, no solo la bandera: si el UPDATE se
-- saltara por el motivo equivocado (por ejemplo porque total_cobrado quedo
-- mal derivado) el flag podria dar false por casualidad. Este chequeo
-- confirma que costo_final realmente sigue en 9999.
SELECT CASE WHEN o.costo_final = 9999
            THEN 'OK' ELSE 'FALLA: costo_final cambio a ' || COALESCE(o.costo_final::text, 'NULL') || ' (deberia seguir en 9999)'
       END AS probe_2b_costo_editado_intacto
FROM ordenes_servicio o JOIN _probe_orden p ON p.id = o.id;

-- ---------------------------------------------------------------------------
-- PROBE 3 — Si la orden ya tiene cobros REALES (total_cobrado > 0), agregar
--           una línea NO debe tocar costo_final.
-- ESPERADO: OK
--
-- El estado se arma insertando un cobro real y llamando a
-- recalcular_estado_cobro (068_mejoras_ordenes.sql) — así es como el resto
-- del sistema llega a total_cobrado > 0. Forzar la columna con un UPDATE
-- directo (`SET costo_final = ..., total_cobrado = 10000` en el mismo
-- statement) NO sirve: costo_final también cambia ahí, dispara el trigger de
-- la migración 277 (AFTER UPDATE OF costo_final), y recalcular_estado_cobro
-- pisa total_cobrado con SUM(cobros_orden) = 0 antes de que el RPC llegue a
-- leerlo — el probe imprimiria FALLA contra código correcto (o, si costo_final
-- no cambiaba de valor, OK sin haber probado nada).
-- ---------------------------------------------------------------------------
DELETE FROM servicios_orden WHERE orden_id IN (SELECT id FROM _probe_orden);

UPDATE ordenes_servicio o SET costo_final = NULL, estado = 'RECIBIDO'
FROM _probe_orden p WHERE o.id = p.id;

INSERT INTO cobros_orden (orden_id, organization_id, monto, metodo_pago, anulado)
SELECT id, organization_id, 10000, 'EFECTIVO', FALSE FROM _probe_orden;

SELECT recalcular_estado_cobro(id) FROM _probe_orden;

-- Confirma que el setup realmente dejo total_cobrado > 0 antes de ejercitar
-- el RPC: si esto no imprime OK, el resto del probe no prueba nada.
SELECT CASE WHEN o.total_cobrado = 10000
            THEN 'OK: setup con cobro real' ELSE 'ABORTAR probe_3: total_cobrado quedo en ' || o.total_cobrado::text
       END AS probe_3_setup
FROM ordenes_servicio o JOIN _probe_orden p ON p.id = o.id;

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
       END AS probe_3a_no_sincroniza_con_cobros
FROM r;

SELECT CASE WHEN o.costo_final IS NULL
            THEN 'OK' ELSE 'FALLA: costo_final se escribio igual (' || o.costo_final::text || ')'
       END AS probe_3b_no_persistido
FROM ordenes_servicio o JOIN _probe_orden p ON p.id = o.id;

-- Limpieza: se borra el cobro real y se vuelve a recalcular para que los
-- probes siguientes partan de total_cobrado = 0 de verdad, no solo en
-- apariencia (ver razonamiento en el header de PROBE 0).
DELETE FROM cobros_orden WHERE orden_id IN (SELECT id FROM _probe_orden);
SELECT recalcular_estado_cobro(id) FROM _probe_orden;

-- ---------------------------------------------------------------------------
-- PROBE 4 — Eliminar la última línea deja costo_final en NULL (no en 0).
-- ESPERADO: OK
-- ---------------------------------------------------------------------------
DELETE FROM servicios_orden WHERE orden_id IN (SELECT id FROM _probe_orden);

INSERT INTO servicios_orden (orden_id, servicio_id, nombre, cantidad, precio_unitario)
SELECT id, NULL, 'Unica linea', 1, 5000 FROM _probe_orden;

UPDATE ordenes_servicio o SET costo_final = 5000, estado = 'RECIBIDO'
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
       END AS probe_4_ultima_linea_null
FROM r;

SELECT CASE WHEN o.costo_final IS NULL
            THEN 'OK' ELSE 'FALLA: costo_final quedo en ' || o.costo_final::text || ' (deberia ser NULL, no 0)'
       END AS probe_4b_persistido_null
FROM ordenes_servicio o JOIN _probe_orden p ON p.id = o.id;

-- ---------------------------------------------------------------------------
-- PROBE 5 — El STATE GUARD se niega a vaciar costo_final cuando la orden ya
--           está en REPARADO (o en cualquier estado de ESTADOS_COSTO_FINAL_BLOQUEADO).
-- ESPERADO: OK
-- ---------------------------------------------------------------------------
DELETE FROM servicios_orden WHERE orden_id IN (SELECT id FROM _probe_orden);

INSERT INTO servicios_orden (orden_id, servicio_id, nombre, cantidad, precio_unitario)
SELECT id, NULL, 'Unica linea reparado', 1, 25000 FROM _probe_orden;

UPDATE ordenes_servicio o SET costo_final = 25000, estado = 'REPARADO'
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
       END AS probe_5_bloqueado_en_reparado
FROM r;

SELECT CASE WHEN o.costo_final = 25000
            THEN 'OK' ELSE 'FALLA: costo_final se vacio igual (' || COALESCE(o.costo_final::text, 'NULL') || ')'
       END AS probe_5b_costo_final_intacto
FROM ordenes_servicio o JOIN _probe_orden p ON p.id = o.id;

-- Vuelve a un estado no terminal para no interferir con probes siguientes.
UPDATE ordenes_servicio o SET estado = 'RECIBIDO'
FROM _probe_orden p WHERE o.id = p.id;

-- ---------------------------------------------------------------------------
-- PROBE 6 — organization_id equivocado devuelve el error y no toca datos.
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
       END AS probe_6a_agregar_org_equivocada
FROM r;

-- Comprobación de que la falla anterior no insertó nada:
SELECT CASE WHEN NOT EXISTS (
              SELECT 1 FROM servicios_orden WHERE orden_id IN (SELECT id FROM _probe_orden)
            )
            THEN 'OK' ELSE 'FALLA: se inserto una linea pese al organization_id equivocado'
       END AS probe_6a2_no_inserto;

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
       END AS probe_6b_eliminar_org_equivocada
FROM r;

SELECT CASE WHEN EXISTS (
              SELECT 1 FROM servicios_orden WHERE orden_id IN (SELECT id FROM _probe_orden)
            )
            THEN 'OK' ELSE 'FALLA: la linea se borro pese al organization_id equivocado'
       END AS probe_6b2_no_elimino;

-- ---------------------------------------------------------------------------
-- PROBE 7 — Ambas funciones existen con la firma esperada (cantidad de
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
       END AS probe_7a_agregar_firma;

SELECT CASE WHEN EXISTS (
              SELECT 1 FROM pg_proc
              WHERE proname = 'eliminar_servicio_orden'
                AND pronargs = 3
                AND pg_get_function_result(oid) = 'json'
            )
            THEN 'OK' ELSE 'FALLA: eliminar_servicio_orden no existe o la firma no coincide'
       END AS probe_7b_eliminar_firma;

-- Informativo: firma completa (nombre y tipo de cada argumento) para revisión manual.
SELECT proname, pg_get_function_identity_arguments(oid) AS firma
FROM pg_proc
WHERE proname IN ('agregar_servicio_orden', 'eliminar_servicio_orden')
ORDER BY proname;

ROLLBACK;
