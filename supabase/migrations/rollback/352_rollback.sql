-- Rollback de 352_entregar_lote_recepcion.sql
--
-- Elimina la funcion entregar_lote_recepcion. Las ordenes ya entregadas por el
-- lote NO se tocan (son filas comunes de ordenes_servicio / cobros_orden).
-- Si 353 esta aplicada, correr primero 353_rollback.sql (o simplemente este: el
-- DROP elimina la version vigente sea cual sea).

DROP FUNCTION IF EXISTS entregar_lote_recepcion(TEXT,TEXT,TEXT,JSONB,TEXT,TEXT,TEXT,TEXT);
