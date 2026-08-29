-- ============================================================================
-- 320: permiso opcional para que los VENDEDORES manejen la caja
-- ============================================================================
-- Toggle por organizacion (default apagado), mismo patron que la 275
-- (vendedores_administran_inventario) y la 314 (tecnicos_operan_pos):
-- preferencia de la org, NO gating comercial por plan (eso vive en
-- plans.feature_flags).
--
-- Existe porque abrir la caja, cerrarla con arqueo y cargar un movimiento
-- manual eran todos requireAdmin(). En un local donde el dueno no esta al
-- mostrador, nadie puede arrancar el dia ni cerrar el turno sin el.
--
-- Lo que el permiso SI abre: apertura de sesion, cierre con arqueo,
-- movimientos manuales (alta, baja y comprobante adjunto).
--
-- Lo que el permiso NO abre: el export CSV de caja y el historial de cierres
-- siguen siendo solo de ADMIN. El vendedor opera SU turno; el historico
-- financiero de la organizacion es del dueno.
--
-- El alcance por sucursal no lo da este flag: el vendedor sigue atado a su
-- sucursal y solo ve y cierra la caja de esa (lib/sucursal.ts).
-- ============================================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS vendedores_manejan_caja BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN organizations.vendedores_manejan_caja IS
  'Si true, los usuarios con rol VENDEDOR pueden abrir y cerrar la caja de su sucursal y cargar movimientos manuales. El export CSV y el historial de cierres siguen siendo de ADMIN. Default false. No modifica el rol del usuario.';
