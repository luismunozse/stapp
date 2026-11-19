-- Rollback de la 419. Borra los avisos de pago (los cobros confirmados quedan:
-- viven en cobros_orden). Los comprobantes subidos quedan en
-- comprobantes-gastos/<org>/pagos-informados/ y se pueden borrar a mano.
DROP TABLE IF EXISTS public.pagos_informados;
NOTIFY pgrst, 'reload schema';
