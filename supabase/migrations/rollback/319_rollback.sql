-- Rollback de la migracion 319.
--
-- Saca la columna del permiso. Toda organizacion que lo tuviera prendido
-- vuelve a la conducta previa: la caja queda cerrada al VENDEDOR y solo el
-- ADMIN abre, cierra y carga movimientos.
--
-- Se pierde que orgs lo tenian habilitado. Es informacion recuperable a mano
-- (son pocas y opt-in explicito), y el codigo de la app degrada solo: la
-- lectura del flag es fail-closed, asi que con la columna ausente el vendedor
-- queda afuera sin romper nada. Aun asi, conviene anotar la lista antes de
-- correr esto si el rollback no es inmediato.
--
-- Ojo con el turno abierto: si una sucursal quedo con la caja abierta por un
-- vendedor, despues del rollback solo el ADMIN puede cerrarla.

ALTER TABLE organizations
  DROP COLUMN IF EXISTS vendedores_manejan_caja;
