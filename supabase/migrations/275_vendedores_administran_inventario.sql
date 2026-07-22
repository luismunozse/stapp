-- ============================================================================
-- 275: permiso opcional para que VENDEDORES administren inventario
-- ============================================================================
-- Toggle por organización (default apagado): muchos admins NO quieren que los
-- vendedores toquen inventario, así que el acceso es opt-in explícito.
-- Preferencia de la org (como modulo_agenda) — NO va en plans.feature_flags,
-- que es gating comercial por plan.
-- ============================================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS vendedores_administran_inventario BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN organizations.vendedores_administran_inventario IS
  'Si true, los usuarios con rol VENDEDOR pueden administrar inventario (productos, stock, depósitos, ajustes, conteos). Default false: solo ADMIN.';
