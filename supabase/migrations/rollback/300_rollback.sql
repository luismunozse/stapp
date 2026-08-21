-- Rollback de 300_servicios.sql
-- Destructivo: elimina el catálogo de servicios y todas las líneas asignadas.

DROP TABLE IF EXISTS servicios_orden;
DROP TABLE IF EXISTS servicios;
