-- Rollback de la migracion 322.
--
-- Saca la columna del permiso. Toda organizacion que lo tuviera prendido
-- vuelve a la conducta previa: convertir una cotizacion aceptada en venta
-- queda solo para el ADMIN, y el tecnico vuelve a depender del dueno para
-- cerrar cada cobro.
--
-- Se pierde que orgs lo tenian habilitado. Es informacion recuperable a mano
-- (son pocas y opt-in explicito), y el codigo de la app degrada solo: la
-- lectura del flag es fail-closed, asi que con la columna ausente el tecnico
-- queda afuera sin romper nada. Aun asi, conviene anotar la lista antes de
-- correr esto si el rollback no es inmediato.
--
-- Nada que revertir del lado de los datos: las ventas ya generadas por un
-- tecnico son ventas normales y validas, con el acreditado como vendedor.
-- El rollback corta el permiso hacia adelante, no deshace cobros.

ALTER TABLE organizations
  DROP COLUMN IF EXISTS tecnicos_cobran_cotizaciones;
