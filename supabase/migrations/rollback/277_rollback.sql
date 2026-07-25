-- Rollback de 277_trigger_recalcular_estado_cobro.sql
--
-- Restaura el comportamiento previo: estado_cobro deja de recalcularse
-- automáticamente ante cambios de costo_final o descuento_cobro.
-- Ojo: eso reintroduce el bug descrito en la migración 277.

DROP TRIGGER IF EXISTS ordenes_recalcular_cobro ON ordenes_servicio;
DROP FUNCTION IF EXISTS trg_recalcular_estado_cobro();
