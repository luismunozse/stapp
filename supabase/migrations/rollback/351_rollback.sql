-- Rollback de la 351.
--
-- Restaura la FK de la 350 (sin ON DELETE, o sea NO ACTION). Con ella vuelve a
-- fallar la purga de una organizacion que tenga NC con items con deposito
-- (lib/account-deletion/purge-organization.ts), asi que no revertir mientras
-- siga vigente esa purga.
--
-- Los deposito_id que la 351 dejo en NULL no se recuperan.

ALTER TABLE items_nota_credito DROP CONSTRAINT items_nota_credito_deposito_id_fkey;
ALTER TABLE items_nota_credito ADD CONSTRAINT items_nota_credito_deposito_id_fkey
  FOREIGN KEY (deposito_id) REFERENCES depositos(id);

COMMENT ON COLUMN items_nota_credito.deposito_id IS NULL;
