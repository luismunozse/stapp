-- Probes de la 336. Abre su propia transaccion y la revierte: db-run.mjs
-- detecta el BEGIN y rechaza --apply.
--
-- Fijan: permite hasta p_max y bloquea el siguiente, las claves son
-- independientes, una ventana vieja no cuenta, el barrido borra solo lo viejo,
-- parametros invalidos fallan y solo service_role (no anon, authenticated ni PUBLIC)
-- puede ejecutar rate_limit_hit y limpiar_rate_limit_buckets.
BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

-- 1-4: tope de 3 por ventana larga (3600s, no cruza borde durante la probe).
INSERT INTO _r VALUES (1, 'hit 1 permitido', 'true', rate_limit_hit('probe-336-a', 3, 3600)::text);
INSERT INTO _r VALUES (2, 'hit 2 permitido', 'true', rate_limit_hit('probe-336-a', 3, 3600)::text);
INSERT INTO _r VALUES (3, 'hit 3 permitido (igual al tope)', 'true', rate_limit_hit('probe-336-a', 3, 3600)::text);
INSERT INTO _r VALUES (4, 'hit 4 bloqueado', 'false', rate_limit_hit('probe-336-a', 3, 3600)::text);

-- 5: otra clave no comparte contador.
INSERT INTO _r VALUES (5, 'otra clave arranca limpia', 'true', rate_limit_hit('probe-336-b', 3, 3600)::text);

-- 6: el contador acumulo 4 sobre la clave a (un solo bucket).
INSERT INTO _r SELECT 6, 'un solo bucket con count 4', '1/4',
  count(*)::text || '/' || max(count)::text FROM rate_limit_buckets WHERE key = 'probe-336-a';

-- 7-8: barrido borra lo viejo y respeta lo reciente.
INSERT INTO rate_limit_buckets (key, window_start, count)
VALUES ('probe-336-old', now() - INTERVAL '3 days', 9);
DO $$ BEGIN PERFORM limpiar_rate_limit_buckets(); END $$;
INSERT INTO _r SELECT 7, 'barrido borra bucket de 3 dias', '0', count(*)::text FROM rate_limit_buckets WHERE key = 'probe-336-old';
INSERT INTO _r SELECT 8, 'barrido respeta bucket reciente', '1', count(*)::text FROM rate_limit_buckets WHERE key = 'probe-336-a';

-- 9: parametros invalidos.
DO $$
DECLARE v_msg TEXT := 'sin error';
BEGIN
  BEGIN
    PERFORM rate_limit_hit('probe-336-x', 0, 60);
  EXCEPTION WHEN invalid_parameter_value THEN
    v_msg := 'invalid_parameter_value';
  END;
  INSERT INTO _r VALUES (9, 'p_max = 0 se rechaza', 'invalid_parameter_value', v_msg);
END $$;

-- 10-17: solo service_role puede ejecutar ambas funciones.
INSERT INTO _r
SELECT 10 + (row_number() OVER (ORDER BY f.fn, r.rol) - 1)::INT,
       r.rol || ' EXECUTE en ' || f.fn,
       CASE WHEN r.rol = 'service_role' THEN 'true' ELSE 'false' END,
       has_function_privilege(r.rol, f.sig, 'EXECUTE')::text
  FROM (VALUES ('rate_limit_hit', 'rate_limit_hit(text,int,int)'),
               ('limpiar_rate_limit_buckets', 'limpiar_rate_limit_buckets()')) AS f(fn, sig)
 CROSS JOIN (VALUES ('service_role'), ('anon'), ('authenticated'), ('public')) AS r(rol);

SELECT orden, probe, esperado, obtenido,
       CASE WHEN esperado = obtenido THEN 'OK' ELSE 'FALLA' END AS resultado
  FROM _r ORDER BY orden;

ROLLBACK;
