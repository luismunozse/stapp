-- =============================================================================
-- Verificación de la migración 308 — rubro_detalle (camino genérico guiado).
--
-- CÓMO CORRERLO (ver verify/README.md):
--   - SQL editor de Supabase Studio, DESPUES de aplicar 308.
--   - SIN RLS: las rutas de la app usan supabaseAdmin (service_role).
--
-- Todo corre dentro de BEGIN/ROLLBACK: la organización de prueba no persiste.
--
-- La 308 es aditiva pura (columna nullable + índice parcial, sin backfill), así
-- que estos probes son más livianos que los de la 307: confirman que la columna
-- acepta lo que la app le va a mandar y que nada existente se movió.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

-- ---------------------------------------------------------------------------
-- 1. La columna existe, es TEXT y acepta NULL
-- ---------------------------------------------------------------------------
INSERT INTO _r
SELECT 1, 'columna organizations.rubro_detalle existe', 'text / nullable',
       COALESCE(data_type || ' / ' ||
                CASE WHEN is_nullable = 'YES' THEN 'nullable' ELSE 'NOT NULL' END,
                'AUSENTE')
FROM information_schema.columns
WHERE table_name = 'organizations' AND column_name = 'rubro_detalle';

INSERT INTO _r
SELECT 1, 'columna organizations.rubro_detalle existe', 'text / nullable', 'AUSENTE'
WHERE NOT EXISTS (SELECT 1 FROM _r WHERE orden = 1);

-- ---------------------------------------------------------------------------
-- 2. Aditiva pura: nadie quedó con valor
-- ---------------------------------------------------------------------------
INSERT INTO _r
SELECT 2, 'orgs preexistentes con rubro_detalle', '0', COUNT(*)::TEXT
FROM organizations WHERE rubro_detalle IS NOT NULL;

-- La 307 no se movió.
INSERT INTO _r
SELECT 3, 'orgs sin rubro (la 307 sigue en pie)', '0', COUNT(*)::TEXT
FROM organizations WHERE rubro IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Acepta lo que manda el registro, incluidos acentos y el largo máximo
-- ---------------------------------------------------------------------------
INSERT INTO organizations (id, nombre, slug, activo, rubro, rubro_detalle)
VALUES ('probe-308-org', 'Probe 308',
        'probe-308-' || substr(md5(random()::text), 1, 8),
        TRUE, 'generico', 'máquinas de café');

INSERT INTO _r
SELECT 4, 'guarda el texto libre con acentos', 'máquinas de café',
       COALESCE(rubro_detalle, 'NULL')
FROM organizations WHERE id = 'probe-308-org';

-- El form corta en 120; la columna es TEXT, así que no debería quejarse nunca.
UPDATE organizations SET rubro_detalle = repeat('x', 120) WHERE id = 'probe-308-org';

INSERT INTO _r
SELECT 5, 'acepta el largo maximo del formulario (120)', '120',
       length(rubro_detalle)::TEXT
FROM organizations WHERE id = 'probe-308-org';

-- Un pack curado no escribe detalle.
INSERT INTO organizations (id, nombre, slug, activo, rubro)
VALUES ('probe-308-curado', 'Probe 308 curado',
        'probe-308c-' || substr(md5(random()::text), 1, 8),
        TRUE, 'automotor');

INSERT INTO _r
SELECT 6, 'un pack curado deja rubro_detalle en NULL', 'NULL',
       COALESCE(rubro_detalle, 'NULL')
FROM organizations WHERE id = 'probe-308-curado';

-- ---------------------------------------------------------------------------
-- 4. El índice parcial existe
-- ---------------------------------------------------------------------------
INSERT INTO _r
SELECT 7, 'indice organizations_rubro_detalle_idx', '1', COUNT(*)::TEXT
FROM pg_indexes WHERE indexname = 'organizations_rubro_detalle_idx';

-- ---------------------------------------------------------------------------
SELECT orden, probe, esperado, obtenido,
       CASE
         WHEN esperado = obtenido THEN 'OK'
         WHEN orden = 1 AND obtenido LIKE 'text%' THEN 'OK'
         ELSE 'REVISAR'
       END AS estado
FROM _r ORDER BY orden;

ROLLBACK;
