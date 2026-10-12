-- ============================================================================
-- 314: permiso opcional para que los TECNICOS operen el POS y las ventas
-- ============================================================================
-- Toggle por organizacion (default apagado), mismo patron que la 275
-- (vendedores_administran_inventario): preferencia de la org, NO gating
-- comercial por plan (eso vive en plans.feature_flags).
--
-- Existe porque hasta ahora la unica forma de darle POS a un tecnico era
-- cambiarle el rol a VENDEDOR, y eso es un canje y no una suma: al dejar de
-- ser TECNICO desaparecia de la lista de asignables a ordenes, perdia
-- "Mi desempeno" y sus comisiones de reparacion. El permiso no toca el rol.
--
-- Lo que el permiso NO abre: anular, editar o eliminar ventas, registrar
-- pagos y crear devoluciones siguen siendo solo de ADMIN, igual que para el
-- VENDEDOR. Los costos de compra siguen fuera: eso lo gobierna la 275.
-- ============================================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS tecnicos_operan_pos BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN organizations.tecnicos_operan_pos IS
  'Si true, los usuarios con rol TECNICO pueden operar el POS y las ventas de mostrador (crear ventas, ver las propias). Default false: solo ADMIN y VENDEDOR. No modifica el rol del usuario.';
