-- Rollback de la migracion 314.
--
-- Saca la columna del permiso. Toda organizacion que lo tuviera prendido
-- vuelve a la conducta previa: el POS queda cerrado al TECNICO.
--
-- Se pierde que orgs lo tenian habilitado. Es informacion recuperable a mano
-- (son pocas y opt-in explicito), y el codigo de la app degrada solo: la
-- lectura del flag es fail-closed, asi que con la columna ausente el tecnico
-- queda afuera sin romper nada. Aun asi, conviene anotar la lista antes de
-- correr esto si el rollback no es inmediato.

ALTER TABLE organizations
  DROP COLUMN IF EXISTS tecnicos_operan_pos;
