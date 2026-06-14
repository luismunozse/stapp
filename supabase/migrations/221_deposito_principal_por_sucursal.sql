-- ========================================
-- Migration 221: depósito principal POR SUCURSAL (infra de Fase 5)
-- ========================================
-- Hasta ahora había UN depósito principal por ORG (índice único por org).
-- Para resolver automáticamente "el depósito de la sucursal X" en ventas,
-- reservas y devoluciones, cada sucursal debe tener su propio depósito principal.
--
-- Esta migración:
--   1. Backfill: garantiza 1 depósito principal por sucursal (crea/promueve)
--   2. Cambia el índice único: (org) → (org, sucursal_id) WHERE principal
--   3. get_deposito_de_sucursal(sucursal_id): resuelve el principal de la sucursal
--   4. get_deposito_principal(org): determinista (prioriza el de la sucursal principal)
--   5. Trigger AFTER INSERT ON sucursales: auto-crea depósito principal
--
-- Idempotente y zero-downtime (DDL sobre índice parcial + backfill con guards).
-- El índice viejo se dropea ANTES del backfill porque promover principales en
-- sucursales secundarias crearía 2 principales por org (lo que el índice viejo
-- prohíbe; el nuevo (org, sucursal) lo permite).
-- ========================================

-- 1. Dropear el índice viejo (org-scoped) para permitir múltiples principales por org
DROP INDEX IF EXISTS depositos_org_principal_unique;

-- 2a. Backfill: crear depósito principal para sucursales SIN ningún depósito
-- Nombre único por org: existe constraint depositos_org_nombre_unique sobre
-- (organization_id, lower(nombre)). Se usa 'Depósito ' || nombre de la sucursal
-- (único por org, ya que el nombre de sucursal es único por org).
INSERT INTO depositos (organization_id, nombre, principal, activo, sucursal_id)
SELECT s.organization_id, 'Depósito ' || s.nombre, true, true, s.id
FROM sucursales s
WHERE s.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM depositos d
    WHERE d.sucursal_id = s.id AND d.deleted_at IS NULL
  );

-- 2b. Backfill: promover un depósito a principal para sucursales que tienen
--     depósitos pero ninguno principal (elige el más antiguo activo).
WITH candidato AS (
  SELECT DISTINCT ON (d.sucursal_id) d.id
  FROM depositos d
  JOIN sucursales s ON s.id = d.sucursal_id
  WHERE d.deleted_at IS NULL
    AND s.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM depositos dp
      WHERE dp.sucursal_id = d.sucursal_id
        AND dp.principal = true AND dp.deleted_at IS NULL
    )
  ORDER BY d.sucursal_id, d.created_at ASC, d.id ASC
)
UPDATE depositos SET principal = true
WHERE id IN (SELECT id FROM candidato);

-- 3. Nuevo índice único: un principal por (org, sucursal)
CREATE UNIQUE INDEX IF NOT EXISTS depositos_org_sucursal_principal_unique
  ON depositos(organization_id, sucursal_id)
  WHERE principal = true AND deleted_at IS NULL;

-- 4. Helper: resolver el depósito principal de una sucursal.
--    Fallback defensivo al principal de la org si la sucursal no tuviera uno.
CREATE OR REPLACE FUNCTION get_deposito_de_sucursal(p_sucursal_id TEXT)
RETURNS TEXT AS $$
  SELECT COALESCE(
    (SELECT d.id FROM depositos d
     WHERE d.sucursal_id = p_sucursal_id
       AND d.principal = true AND d.deleted_at IS NULL
     LIMIT 1),
    (SELECT get_deposito_principal(s.organization_id)
     FROM sucursales s WHERE s.id = p_sucursal_id AND s.deleted_at IS NULL)
  );
$$ LANGUAGE sql STABLE;

-- 4b. get_deposito_principal ahora puede ver varios principales por org.
--     Hacerlo determinista: priorizar el de la sucursal principal (Casa Central).
--     LEFT JOIN para NO excluir nunca un depósito principal válido cuya sucursal
--     fue soft-deleted (con INNER JOIN devolvería NULL → rompería stock ops).
CREATE OR REPLACE FUNCTION get_deposito_principal(p_org_id TEXT)
RETURNS TEXT AS $$
  SELECT d.id FROM depositos d
  LEFT JOIN sucursales s ON s.id = d.sucursal_id
  WHERE d.organization_id = p_org_id
    AND d.principal = true AND d.deleted_at IS NULL
  ORDER BY (s.principal = true) DESC NULLS LAST, d.created_at ASC, d.id ASC
  LIMIT 1;
$$ LANGUAGE sql STABLE;

-- 5. Trigger: auto-crear depósito principal al crear una sucursal.
--    Idempotente (guard NOT EXISTS) — compone con el trigger de org (mig 217):
--    al crear una org, 217 inserta Casa Central, lo que dispara ESTE trigger y
--    crea su depósito; el INSERT de depósito que hace 217 a continuación ve el
--    guard y no duplica. El índice único (org, sucursal) es el backstop final.
CREATE OR REPLACE FUNCTION sucursal_crear_deposito_principal()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO depositos (organization_id, nombre, principal, activo, sucursal_id)
  SELECT NEW.organization_id, 'Depósito ' || NEW.nombre, true, true, NEW.id
  WHERE NOT EXISTS (
    SELECT 1 FROM depositos d
    WHERE d.sucursal_id = NEW.id
      AND d.principal = true AND d.deleted_at IS NULL
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sucursales_crear_deposito_principal ON sucursales;
CREATE TRIGGER sucursales_crear_deposito_principal
  AFTER INSERT ON sucursales
  FOR EACH ROW EXECUTE FUNCTION sucursal_crear_deposito_principal();

-- 6. Simplificar el trigger de org (mig 217): ahora SOLO crea la sucursal
--    Casa Central; el depósito principal lo crea el trigger de sucursal de
--    arriba. Elimina la doble responsabilidad y el guard org-scoped que quedó
--    obsoleto con el modelo principal-por-sucursal.
CREATE OR REPLACE FUNCTION org_crear_deposito_principal()
RETURNS TRIGGER AS $$
DECLARE
  v_sucursal_id TEXT;
BEGIN
  SELECT id INTO v_sucursal_id
  FROM sucursales
  WHERE organization_id = NEW.id AND principal = true AND deleted_at IS NULL
  LIMIT 1;

  IF v_sucursal_id IS NULL THEN
    -- El AFTER INSERT ON sucursales (sucursal_crear_deposito_principal) crea
    -- el depósito principal de esta Casa Central automáticamente.
    INSERT INTO sucursales (organization_id, nombre, principal, activo)
    VALUES (NEW.id, 'Casa Central', true, true);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
