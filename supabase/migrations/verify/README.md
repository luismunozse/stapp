# Probes de verificación

Scripts que se corren **después** de aplicar una migración, para comprobar contra la base real que hizo lo que decía. Uno por migración: `NNN_probes.sql`.

## Cómo correrlos

En el SQL editor de Supabase Studio, con dos condiciones:

**Sin RLS.** Casi todas las tablas del proyecto tienen policies `FOR ALL TO authenticated` que filtran por `auth.uid()`. En el editor no hay JWT, así que con RLS encendido `auth.uid()` es NULL, la policy no matchea nada y el setup del probe aborta aunque la tabla tenga miles de filas. Correr sin RLS además es **fiel a producción**: las rutas de la app usan `supabaseAdmin` (service_role), que bypassea RLS.

Si lo que querés verificar es una policy, eso es otro tipo de prueba y va aparte — no mezclarlo con estos probes.

**Dentro de `BEGIN` / `ROLLBACK`.** Los probes escriben: crean filas, llaman RPCs, consumen secuencias. Nada de eso puede quedar. El `ROLLBACK` del final es obligatorio.

## El patrón: un solo resultado

**El SQL editor muestra únicamente el resultado del último statement que devuelve filas.** Un archivo con un `SELECT` por probe deja ver solo el último; todos los anteriores quedan invisibles. Los `RAISE NOTICE` tampoco se muestran.

Por eso los probes acumulan en una temp table y cierran con **un** `SELECT`:

```sql
BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

-- Chequeo simple: comparación directa.
INSERT INTO _r SELECT 1, 'que verifica', 'lo que espero', (SELECT algo::TEXT FROM ...);

-- Chequeo con lógica o que espera un error: bloque DO.
DO $$
BEGIN
  PERFORM funcion_que_deberia_fallar(...);
  INSERT INTO _r VALUES (2, 'que verifica', 'error', 'FALLO: no levanto excepcion');
EXCEPTION WHEN check_violation THEN
  INSERT INTO _r VALUES (2, 'que verifica', 'error', 'OK: ' || SQLERRM);
END $$;

SELECT orden, probe, esperado, obtenido FROM _r ORDER BY orden, probe;

ROLLBACK;
```

Se lee de un vistazo: verde es `esperado` = `obtenido` en las comparaciones, y `OK:` al principio en las que esperan un error.

Un probe que depende de datos que la base puede no tener (por ejemplo, un movimiento de cierto tipo) **se saltea solo** y lo dice en `obtenido`, en vez de reventar el script entero.

`306_probes.sql` es la referencia: sigue el patrón completo y está verificado contra la base real.

## Estado de los archivos

| Archivo | Patrón |
|---|---|
| `306_probes.sql` | ✅ resultado único |
| `277_probes.sql` | ⚠️ multi-SELECT — solo se ve el último |
| `301_probes.sql` | ⚠️ multi-SELECT |
| `303_probes.sql` | ⚠️ multi-SELECT |
| `304_probes.sql` | ⚠️ multi-SELECT |
| `phase1_probes.sql` | ⚠️ multi-SELECT |

Los marcados con ⚠️ **no están rotos**: el SQL corre bien y cada probe hace lo suyo. Lo que pasa es que en Studio hay que ir corriendo bloque por bloque para ver los resultados intermedios, y eso rompe la transacción que los envuelve. Se convierten cuando haya que volver a correrlos, no antes: son migraciones ya aplicadas y reescribirlos a ciegas, sin una base contra la cual verificar la reescritura, agrega más riesgo del que saca.

## Rollback

Cada migración lleva además su `rollback/NNN_rollback.sql`. Si el rollback pierde datos, tiene que decirlo arriba de todo y dejar el `SELECT` para exportarlos antes.
