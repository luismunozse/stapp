-- Probes de 385 (verificación de la delegación ARCA). Solo lectura.
--
-- Parte 1 (correr ANTES de aplicar 385, y después también): todas las filas
-- delegadas con su organización, para revisar a mano que cada CUIT sea de esa
-- org (razón social del CUIT en ARCA vs. la organización). Las que tengan más
-- de una org por CUIT aparecen primero.
--
-- Parte 2 (correr DESPUÉS de aplicar 385): todas las filas deben dar ok = true.
--
-- El SQL editor muestra solo el último resultado: seleccionar y correr cada
-- parte por separado.

-- Parte 1 ---------------------------------------------------------------------
SELECT fc.cuit,
       count(*) OVER (PARTITION BY fc.cuit) AS orgs_con_este_cuit,
       fc.organization_id,
       o.nombre,
       o.nombre_mostrar,
       fc.estado,
       fc.punto_venta,
       fc.updated_at
FROM facturacion_credenciales fc
JOIN organizations o ON o.id = fc.organization_id
WHERE fc.provider = 'arca_delegado'
ORDER BY orgs_con_este_cuit DESC, fc.cuit, fc.updated_at;

-- Parte 2 ---------------------------------------------------------------------
BEGIN;

CREATE TEMP TABLE _probe (probe TEXT, ok BOOLEAN, detalle TEXT) ON COMMIT DROP;

INSERT INTO _probe
SELECT 'CHECK de estado admite pendiente_verificacion',
       pg_get_constraintdef(oid) LIKE '%pendiente_verificacion%',
       pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'facturacion_credenciales_estado_check';

INSERT INTO _probe
SELECT 'índice único de CUIT delegado',
       EXISTS (SELECT 1 FROM pg_indexes
               WHERE indexname = 'facturacion_credenciales_cuit_delegado_uniq'
                 AND indexdef ILIKE '%UNIQUE%'),
       NULL;

INSERT INTO _probe
SELECT 'ningún CUIT delegado en más de una org',
       NOT EXISTS (SELECT 1 FROM facturacion_credenciales
                   WHERE provider = 'arca_delegado'
                   GROUP BY cuit HAVING count(*) > 1),
       NULL;

SELECT * FROM _probe ORDER BY ok, probe;

ROLLBACK;
