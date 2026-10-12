-- Rollback de 304_servicios_costo_final_huerfano.sql
--
-- La 304 no crea objetos nuevos ni hace backfill: solo reemplaza el cuerpo de
-- tres funciones que la 303 ya habia creado. No hay nada que borrar.
--
-- PARA REVERTIR: correr supabase/migrations/303_servicios_orden_monto_por_estado.sql
-- COMPLETA. Es la que restaura los cuerpos previos (CREATE OR REPLACE, sin DROP:
-- no hay forma de deshacer un reemplazo mas que reaplicando la version anterior).
--
-- ADVERTENCIA: volver a la 303 reabre el hueco de aplicar_monto_servicios_orden,
-- que deja sin costo_final a una orden ya REPARADA cuando no tiene lineas. Eso
-- hace desaparecer la deuda al entregar. No revertir sin entender ese costo.
--
-- Los costo_final que la 304 haya limpiado NO se restauran: eran valores que la
-- regla vieja habia escrito y que la regla nueva no gobierna. Si hace falta
-- recuperar alguno, sale del historial de la orden.

SELECT 'Correr 303_servicios_orden_monto_por_estado.sql para revertir la 304' AS instruccion;
