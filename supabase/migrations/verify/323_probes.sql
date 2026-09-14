-- Probes de la 323. Abre su propia transaccion y la revierte: db-run.mjs
-- detecta el BEGIN y rechaza --apply.
--
-- Los que FALLAN contra una base sin la 323 aplicada son los ordenes 1, 3, 5
-- y 7: el registro del trigger, las dos direcciones del cambio de rol y el
-- limite del plan. Los demas fijan que arreglar el UPDATE no rompio el alta,
-- la baja ni los updates que no tocan el rol, que ya andaban.
--
-- Todo corre sobre una organizacion de prueba creada aca mismo. NO tiene
-- suscripcion, asi que get_plan_limit cae al fallback Free: 1 tecnico
-- (219_get_plan_limit_respects_overrides.sql:34). Los probes de conteo se
-- quedan justo en ese 1 a proposito, y el orden 7 lo desborda para verificar
-- que entrar al rol respeta el limite.
BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

-- ---------------------------------------------------------------------------
-- Setup: organizacion de prueba + su fila de uso
-- ---------------------------------------------------------------------------
INSERT INTO organizations (id, nombre, nombre_mostrar, slug)
VALUES ('org-probe-323', 'Probe 323', 'Probe 323', 'probe-323');

INSERT INTO sucursales (id, organization_id, nombre, principal)
VALUES ('suc-probe-323', 'org-probe-323', 'Principal', TRUE);

-- ---------------------------------------------------------------------------
-- 1. El trigger esta registrado para UPDATE (esto es lo que la 006 no hizo)
-- ---------------------------------------------------------------------------
INSERT INTO _r
SELECT 1,
       'trigger_tecnicos_count corre en UPDATE',
       'true',
       (SELECT EXISTS (
          SELECT 1
          FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          WHERE c.relname = 'users'
            AND t.tgname = 'trigger_tecnicos_count'
            -- tgtype bit 4 (16) = UPDATE, segun catalogo de Postgres
            AND (t.tgtype & 16) <> 0
        )::TEXT);

-- ---------------------------------------------------------------------------
-- 2. Alta de tecnico: sigue sumando (no se rompio lo que ya andaba)
-- ---------------------------------------------------------------------------
INSERT INTO users (id, organization_id, sucursal_id, email, nombre, password, rol)
VALUES ('u-probe-323-a', 'org-probe-323', 'suc-probe-323',
        'a@probe-323.invalid', 'Probe A', 'x', 'TECNICO');

INSERT INTO _r
SELECT 2, 'alta de TECNICO suma', '1',
       (SELECT tecnicos_count::TEXT FROM organization_usage
        WHERE organization_id = 'org-probe-323');

-- ---------------------------------------------------------------------------
-- 3. TECNICO -> VENDEDOR DECREMENTA tecnicos_count
--    Sin la 323 esto queda en 1: el tecnico fantasma que bloquea el alta
--    del siguiente. ESTE PROBE FALLA CONTRA UNA BASE SIN LA MIGRACION.
-- ---------------------------------------------------------------------------
UPDATE users SET rol = 'VENDEDOR' WHERE id = 'u-probe-323-a';

INSERT INTO _r
SELECT 3, 'TECNICO -> VENDEDOR resta tecnicos_count', '0',
       (SELECT tecnicos_count::TEXT FROM organization_usage
        WHERE organization_id = 'org-probe-323');

-- El gemelo de vendedores ya andaba desde la 015; se controla que el cambio
-- lo haya sumado, para descartar que la 323 lo haya pisado.
INSERT INTO _r
SELECT 4, 'el mismo cambio suma vendedores_count', '1',
       (SELECT vendedores_count::TEXT FROM organization_usage
        WHERE organization_id = 'org-probe-323');

-- ---------------------------------------------------------------------------
-- 4. VENDEDOR -> TECNICO INCREMENTA tecnicos_count
--    Sin la 323 queda en 0: la puerta de atras al limite del plan.
--    ESTE PROBE TAMBIEN FALLA CONTRA UNA BASE SIN LA MIGRACION.
-- ---------------------------------------------------------------------------
UPDATE users SET rol = 'TECNICO' WHERE id = 'u-probe-323-a';

INSERT INTO _r
SELECT 5, 'VENDEDOR -> TECNICO suma tecnicos_count', '1',
       (SELECT tecnicos_count::TEXT FROM organization_usage
        WHERE organization_id = 'org-probe-323');

-- ---------------------------------------------------------------------------
-- 5. Un UPDATE que NO toca el rol deja el contador quieto.
--    El trigger ahora corre en cada update de users; esto fija que no cuente
--    de mas por un cambio de nombre.
-- ---------------------------------------------------------------------------
UPDATE users SET nombre = 'Probe A editado' WHERE id = 'u-probe-323-a';

INSERT INTO _r
SELECT 6, 'update sin cambio de rol no mueve el contador', '1',
       (SELECT tecnicos_count::TEXT FROM organization_usage
        WHERE organization_id = 'org-probe-323');

-- ---------------------------------------------------------------------------
-- 6. Entrar al rol respeta el limite del plan.
--    Sin suscripcion, get_plan_limit cae al fallback Free: 1 tecnico. Ya hay
--    uno, asi que promover a un segundo tiene que levantar
--    PLAN_LIMIT_EXCEEDED. Esto es lo que impide que cambiar de rol sea la
--    puerta de atras al limite.
-- ---------------------------------------------------------------------------
INSERT INTO users (id, organization_id, sucursal_id, email, nombre, password, rol)
VALUES ('u-probe-323-b', 'org-probe-323', 'suc-probe-323',
        'b@probe-323.invalid', 'Probe B', 'x', 'VENDEDOR');

DO $$
BEGIN
  UPDATE users SET rol = 'TECNICO' WHERE id = 'u-probe-323-b';
  INSERT INTO _r VALUES (7, 'promover por encima del limite falla',
                         'PLAN_LIMIT_EXCEEDED', 'FALLO: no levanto excepcion');
EXCEPTION WHEN raise_exception THEN
  INSERT INTO _r VALUES (7, 'promover por encima del limite falla',
                         'PLAN_LIMIT_EXCEEDED',
                         CASE WHEN SQLERRM LIKE 'PLAN_LIMIT_EXCEEDED:tecnicos:%'
                              THEN 'PLAN_LIMIT_EXCEEDED'
                              ELSE 'FALLO: ' || SQLERRM END);
END $$;

-- ---------------------------------------------------------------------------
-- 7. Baja de tecnico: sigue restando
-- ---------------------------------------------------------------------------
DELETE FROM users WHERE id = 'u-probe-323-a';

INSERT INTO _r
SELECT 8, 'baja de TECNICO resta', '0',
       (SELECT tecnicos_count::TEXT FROM organization_usage
        WHERE organization_id = 'org-probe-323');

SELECT orden, probe, esperado, obtenido,
       CASE WHEN esperado = obtenido THEN 'OK' ELSE 'FALLA' END AS resultado
FROM _r ORDER BY orden;

ROLLBACK;
