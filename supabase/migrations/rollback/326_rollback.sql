-- Rollback de la migracion 326.
--
-- Saca la columna. Toda organizacion que lo hubiera APAGADO vuelve a mostrarle
-- los reportes de ingresos a sus vendedores.
--
-- Ojo con esto, que es lo contrario de los rollbacks de los otros permisos:
-- los demas nacen apagados, asi que revertirlos CIERRA algo. Este nace
-- prendido y solo se apaga a pedido, asi que revertirlo ABRE lo que un taller
-- decidio cerrar. No es "volver al estado seguro": es deshacer una decision
-- explicita del dueno.
--
-- Antes de correr esto, anotar que organizaciones lo tenian en false:
--
--   SELECT id, nombre_mostrar FROM organizations WHERE vendedores_ven_ingresos = false;
--
-- y avisarles, o volver a aplicar la migracion y restaurarles el valor.
--
-- El codigo degrada solo: con la columna ausente, resolveVendedoresVenIngresos
-- devuelve true (fail-open, ver lib/auth-utils.ts) y el vendedor vuelve a ver
-- los reportes, que es exactamente la conducta previa a esta migracion.

ALTER TABLE organizations
  DROP COLUMN IF EXISTS vendedores_ven_ingresos;
