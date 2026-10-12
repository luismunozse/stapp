-- Rollback de 303_servicios_orden_monto_por_estado.sql
--
-- No revierte datos: la 303 no hace backfill ni toca filas existentes, solo
-- cambia el comportamiento de las altas y bajas futuras. Los presupuestos que
-- se hayan escrito mientras estuvo aplicada quedan como estan, que es correcto:
-- son montos reales que el taller cargo.
--
-- ORDEN OBLIGATORIO
--   1. Volver a correr supabase/migrations/301_servicios_orden_atomico.sql
--      COMPLETA. Es la que restaura los cuerpos previos de agregar_servicio_orden
--      y eliminar_servicio_orden (CREATE OR REPLACE, sin DROP: no hay forma de
--      "deshacer" un reemplazo mas que reaplicando la version anterior).
--   2. Recien despues correr este archivo, que borra la funcion nueva.
--
-- Si se corre este archivo SIN el paso 1, los dos RPCs siguen sincronizando por
-- estado y la UI vieja lee costoFinalActualizado:false en las ordenes previas a
-- APROBADO, mostrando el banner de "Aplicar al total" de mas.

DROP FUNCTION IF EXISTS aplicar_monto_servicios_orden(TEXT, TEXT);
