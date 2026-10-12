-- Migration 351: items_nota_credito.deposito_id pasa a ON DELETE SET NULL.
--
-- La 350 agrego items_nota_credito.deposito_id con FK a depositos(id) y la
-- accion por defecto (NO ACTION). Eso rompio la purga de una organizacion
-- (lib/account-deletion/purge-organization.ts borra la fila de organizations y
-- se apoya en las cascadas): fallaba con
--   update or delete on table "depositos" violates foreign key constraint
--   "items_nota_credito_deposito_id_fkey"
--
-- Causa: las acciones referenciales que disparan las cascadas encolan sus
-- propios eventos en la cola de triggers de la sentencia externa, que se
-- procesa generacion por generacion en orden FIFO. Al borrar la organizacion,
-- la generacion 1 cascadea a depositos (FK de la 169, mas vieja, dispara
-- primero) y a notas_credito (FK de la 186). La generacion 2 queda con el
-- chequeo NO ACTION depositos -> items_nota_credito ANTES que la cascada
-- notas_credito -> items_nota_credito. El chequeo corre con los items todavia
-- vivos y falla.
--
-- ON DELETE SET NULL no depende del orden y es el patron del resto de las
-- referencias a depositos (169, 170, 175). Un item de NC no pierde sentido
-- porque se borre su deposito: el deposito solo dice a donde volvio el stock.
--
-- Las otras dos referencias nuevas de la 350 no necesitan cambio:
--   - items_nota_credito.repuesto_orden_id (NO ACTION): repuestos_orden no
--     tiene organization_id, se borra una generacion mas tarde (organizations
--     -> ordenes_servicio -> repuestos_orden), cuando los items ya no existen.
--   - notas_credito.orden_id (RESTRICT): las NC y las ordenes se borran en la
--     misma generacion (las dos cascadean directo desde organizations); el
--     chequeo RESTRICT corre en la siguiente, cuando ya no quedan NC.
--
-- Sin BEGIN/COMMIT: db-run.mjs envuelve el archivo en una transaccion y por
-- default la revierte. Un BEGIN aca haria que `npm run db:dry` lo ejecute tal
-- cual y lo COMMITEE.
--
-- Sin IF EXISTS en el DROP: si el nombre de la constraint no es el esperado
-- tiene que fallar fuerte.

ALTER TABLE items_nota_credito DROP CONSTRAINT items_nota_credito_deposito_id_fkey;
ALTER TABLE items_nota_credito ADD CONSTRAINT items_nota_credito_deposito_id_fkey
  FOREIGN KEY (deposito_id) REFERENCES depositos(id) ON DELETE SET NULL;

COMMENT ON COLUMN items_nota_credito.deposito_id IS
  'Deposito al que volvio el stock del item. ON DELETE SET NULL (Migracion 351): borrar el deposito, o la organizacion entera, no debe bloquearse por items de NC.';
