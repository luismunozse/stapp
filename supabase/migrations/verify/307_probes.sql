-- =============================================================================
-- Verificación de la migración 307 — rubro por organización y baja del trigger
-- de siembra de tipos base.
--
-- CÓMO CORRERLO (ver verify/README.md):
--   - SQL editor de Supabase Studio, DESPUES de aplicar 307.
--   - SIN RLS: las rutas de la app usan supabaseAdmin (service_role), así que
--     correr sin RLS es fiel a producción.
--
-- Todo corre dentro de BEGIN/ROLLBACK: la organización de prueba no persiste.
--
-- Los resultados se acumulan en _r y salen en UN solo SELECT al final, porque
-- el editor muestra únicamente el último statement que devuelve filas.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

-- ---------------------------------------------------------------------------
-- 1. La columna existe y acepta NULL
-- ---------------------------------------------------------------------------
INSERT INTO _r
SELECT 1, 'columna organizations.rubro existe', 'text / nullable',
       COALESCE(data_type || ' / ' ||
                CASE WHEN is_nullable = 'YES' THEN 'nullable' ELSE 'NOT NULL' END,
                'AUSENTE')
FROM information_schema.columns
WHERE table_name = 'organizations' AND column_name = 'rubro';

-- Si la columna no existe, el SELECT de arriba no inserta nada.
INSERT INTO _r
SELECT 1, 'columna organizations.rubro existe', 'text / nullable', 'AUSENTE'
WHERE NOT EXISTS (SELECT 1 FROM _r WHERE orden = 1);

-- ---------------------------------------------------------------------------
-- 2. Backfill: ninguna org quedó sin rubro
-- ---------------------------------------------------------------------------
INSERT INTO _r
SELECT 2, 'orgs sin rubro despues del backfill', '0', COUNT(*)::TEXT
FROM organizations WHERE rubro IS NULL;

INSERT INTO _r
SELECT 3, 'orgs marcadas como electronica', 'todas las preexistentes',
       COUNT(*)::TEXT
FROM organizations WHERE rubro = 'electronica';

-- ---------------------------------------------------------------------------
-- 3. El trigger ya no está
-- ---------------------------------------------------------------------------
INSERT INTO _r
SELECT 4, 'trigger de siembra dado de baja', '0', COUNT(*)::TEXT
FROM pg_trigger
WHERE tgname = 'trigger_organization_tipos_dispositivo' AND NOT tgisinternal;

-- La función sobrevive: el rollback la necesita.
INSERT INTO _r
SELECT 5, 'funcion poblar_tipos_dispositivo_base conservada', '1', COUNT(*)::TEXT
FROM pg_proc WHERE proname = 'poblar_tipos_dispositivo_base';

-- ---------------------------------------------------------------------------
-- 4. Una org nueva ya NO nace con tipos de electrónica
-- ---------------------------------------------------------------------------
INSERT INTO organizations (id, nombre, slug, activo, rubro)
VALUES ('probe-307-org', 'Probe 307', 'probe-307-' || substr(md5(random()::text), 1, 8), TRUE, 'automotor');

INSERT INTO _r
SELECT 6, 'tipos sembrados automaticamente en org nueva', '0', COUNT(*)::TEXT
FROM tipos_dispositivo WHERE organization_id = 'probe-307-org';

INSERT INTO _r
SELECT 7, 'la org nueva conserva el rubro elegido', 'automotor', COALESCE(rubro, 'NULL')
FROM organizations WHERE id = 'probe-307-org';

-- ---------------------------------------------------------------------------
-- 5. El índice parcial existe
-- ---------------------------------------------------------------------------
INSERT INTO _r
SELECT 8, 'indice organizations_rubro_idx', '1', COUNT(*)::TEXT
FROM pg_indexes WHERE indexname = 'organizations_rubro_idx';

-- ---------------------------------------------------------------------------
SELECT orden, probe, esperado, obtenido,
       CASE
         WHEN orden = 3 THEN 'INFO'
         WHEN esperado = obtenido THEN 'OK'
         WHEN orden = 1 AND obtenido LIKE 'text%' THEN 'OK'
         ELSE 'REVISAR'
       END AS estado
FROM _r ORDER BY orden;

ROLLBACK;
