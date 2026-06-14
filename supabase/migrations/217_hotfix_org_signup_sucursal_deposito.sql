-- ========================================
-- Migration 217: HOTFIX — signup de orgs nuevas roto
-- ========================================
-- INCIDENTE: desde la migración 207 (depositos.sucursal_id NOT NULL), el trigger
-- org_crear_deposito_principal (208) inserta un depósito SIN sucursal_id →
-- viola NOT NULL → la excepción aborta el INSERT en organizations → el registro
-- de toda organización nueva falla.
--
-- Causa raíz adicional: ningún flujo (ni app-layer ni trigger) crea la sucursal
-- "Casa Central" para orgs nuevas. La migración 201 solo backfilleó orgs
-- existentes. Por eso las orgs nuevas quedarían sin sucursal aunque el depósito
-- funcionara.
--
-- FIX: el trigger ahora crea, de forma idempotente:
--   1. la sucursal principal "Casa Central" (si no existe)
--   2. el depósito principal "Principal" atado a esa sucursal (si no existe)
--
-- Idempotente y defensivo: usa guards NOT EXISTS y maneja el caso de que el
-- signup app-layer ya haya creado la sucursal por su cuenta en el futuro.
-- ========================================

CREATE OR REPLACE FUNCTION org_crear_deposito_principal()
RETURNS TRIGGER AS $$
DECLARE
  v_sucursal_id TEXT;
BEGIN
  -- 1. Resolver / crear la sucursal principal "Casa Central"
  SELECT id INTO v_sucursal_id
  FROM sucursales
  WHERE organization_id = NEW.id
    AND principal = true
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_sucursal_id IS NULL THEN
    INSERT INTO sucursales (organization_id, nombre, principal, activo)
    VALUES (NEW.id, 'Casa Central', true, true)
    RETURNING id INTO v_sucursal_id;
  END IF;

  -- 2. Crear el depósito principal atado a esa sucursal (si no existe)
  INSERT INTO depositos (organization_id, nombre, principal, activo, sucursal_id)
  SELECT NEW.id, 'Principal', true, true, v_sucursal_id
  WHERE NOT EXISTS (
    SELECT 1 FROM depositos d
    WHERE d.organization_id = NEW.id
      AND d.principal = true
      AND d.deleted_at IS NULL
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger sin cambios (AFTER INSERT ON organizations) — solo se redefine la función.
DROP TRIGGER IF EXISTS organizations_crear_deposito_principal ON organizations;
CREATE TRIGGER organizations_crear_deposito_principal
  AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION org_crear_deposito_principal();

-- ========================================
-- Backfill correctivo: orgs que quedaron sin sucursal o sin depósito
-- (por signups que corrieron entre la 207 y este hotfix, o estados a medias).
-- ========================================

-- 1. Crear Casa Central para orgs sin ninguna sucursal principal
INSERT INTO sucursales (organization_id, nombre, principal, activo)
SELECT o.id, 'Casa Central', true, true
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM sucursales s
  WHERE s.organization_id = o.id AND s.principal = true AND s.deleted_at IS NULL
);

-- 2. Crear depósito principal (atado a Casa Central) para orgs sin depósito principal
INSERT INTO depositos (organization_id, nombre, principal, activo, sucursal_id)
SELECT o.id, 'Principal', true, true,
  (SELECT s.id FROM sucursales s
   WHERE s.organization_id = o.id AND s.principal = true AND s.deleted_at IS NULL
   LIMIT 1)
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM depositos d
  WHERE d.organization_id = o.id AND d.principal = true AND d.deleted_at IS NULL
);
