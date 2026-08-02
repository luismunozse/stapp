-- Rollback de 284_servicios_orden_atomico.sql
--
-- Restaura el comportamiento previo: app/api/ordenes/[id]/servicios/route.ts
-- vuelve a hacer SELECT-then-decide-then-UPDATE sin lock (reintroduce la
-- condicion de carrera que corrige 284). No aplicar sin revertir también el
-- código de la ruta a la versión pre-284.

DROP FUNCTION IF EXISTS agregar_servicio_orden(TEXT, TEXT, TEXT, TEXT, INTEGER, NUMERIC);
DROP FUNCTION IF EXISTS eliminar_servicio_orden(TEXT, TEXT, TEXT);
