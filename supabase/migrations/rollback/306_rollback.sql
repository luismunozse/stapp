-- Rollback de 306_cc_numero_recibo.sql
--
-- La 306 agrega la columna cuenta_corriente.numero_recibo, un indice unico
-- parcial por organizacion y la funcion asignar_numero_recibo_cc().
--
-- ADVERTENCIA: dropear numero_recibo BORRA los numeros de todos los recibos ya
-- emitidos. Al volver a aplicar la 306, la numeracion arranca de 1 y un cliente
-- que ya tiene el REC-00007 impreso en la mano va a recibir otro papel con ese
-- mismo numero apuntando a otro movimiento. Antes de correr esto, exportar:
--
--   SELECT id, organization_id, numero_recibo
--   FROM cuenta_corriente
--   WHERE numero_recibo IS NOT NULL
--   ORDER BY organization_id, numero_recibo;
--
-- Si solo hace falta deshabilitar la emision sin perder los numeros, alcanza
-- con dropear la funcion: la ruta del recibo responde 503 y la columna queda
-- intacta.

DROP FUNCTION IF EXISTS asignar_numero_recibo_cc(TEXT, TEXT);

DROP INDEX IF EXISTS cuenta_corriente_numero_recibo_org_uniq;

ALTER TABLE cuenta_corriente DROP COLUMN IF EXISTS numero_recibo;
