-- ============================================
-- Migration 241: CHECK — los usuarios no-admin deben tener sucursal_id
-- ============================================
-- Cinturón de seguridad a nivel DB para el invariante de sucursales:
-- un usuario con rol distinto de ADMIN DEBE tener sucursal_id (no nulo).
-- El ADMIN queda libre (su sucursal_id se ignora en la lógica; por
-- convención es NULL = ve todas las sucursales).
--
-- Hasta hoy el invariante era 100% app-layer. Si un write path lo olvida
-- (o una acción directa por SQL deja un no-admin sin sucursal), el read path
-- fail-closed (centinela SUCURSAL_NINGUNA) evita la fuga, pero la fila queda
-- corrupta. Este CHECK lo impide de raíz.
--
-- NOTA: aplicar a mano en el SQL editor de Supabase (sin runner CLI).
-- Idempotente: se puede re-ejecutar sin error.

-- 1. Backfill: asignar la sucursal principal a cualquier no-admin sin sucursal
--    (p. ej. un ADMIN degradado a TECNICO/VENDEDOR antes del fix de change-role).
UPDATE users t
SET sucursal_id = s.id
FROM sucursales s
WHERE t.sucursal_id IS NULL
  AND t.rol <> 'ADMIN'
  AND s.organization_id = t.organization_id
  AND s.principal = true
  AND s.deleted_at IS NULL;

-- 2. Guarda: abortar con mensaje claro si quedan violadores
--    (organización sin sucursal principal). Hay que resolverlos a mano antes
--    de reintentar; no se fuerza el constraint sobre datos inválidos.
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM users
  WHERE rol <> 'ADMIN' AND sucursal_id IS NULL;

  IF v_count > 0 THEN
    RAISE EXCEPTION
      'No se puede aplicar el constraint: % usuario(s) no-admin sin sucursal_id (org sin sucursal principal). Asignar sucursal manualmente antes de reintentar.',
      v_count;
  END IF;
END $$;

-- 3. (Re)crear el CHECK constraint de forma idempotente
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_sucursal_required_non_admin;

ALTER TABLE users
  ADD CONSTRAINT users_sucursal_required_non_admin
  CHECK (rol = 'ADMIN' OR sucursal_id IS NOT NULL);

COMMENT ON CONSTRAINT users_sucursal_required_non_admin ON users IS
  'Los usuarios no-admin (TECNICO/VENDEDOR) deben estar atados a una sucursal. El ADMIN queda libre (sucursal_id NULL = ve todas).';
