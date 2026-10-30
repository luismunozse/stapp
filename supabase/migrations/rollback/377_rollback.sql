-- Rollback of comisiones_definicion (migration 377).
--
-- WARNING: the RPCs of 378/379 read these views and stop working until 377 is reapplied.
-- Run the 379 and 378 rollbacks first. Nothing is lost: the views hold no data.

DROP VIEW IF EXISTS v_comisiones_devengadas;
DROP VIEW IF EXISTS v_comisiones_filas;
