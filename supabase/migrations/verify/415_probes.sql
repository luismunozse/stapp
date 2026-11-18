-- Verification of 415: ordenes_servicio.trabajo_a_realizar.
--
-- Run AFTER 415 is applied:  node scripts/db-run.mjs <this file>
-- (no --apply: the file opens its own transaction and always ends in ROLLBACK).
-- No data is created. Green = obtenido equals esperado.

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

INSERT INTO _r SELECT 1, 'la columna existe, es text y admite NULL', 'text/YES',
  (SELECT data_type || '/' || is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ordenes_servicio' AND column_name = 'trabajo_a_realizar');

INSERT INTO _r SELECT 2, 'hay un CHECK de largo sobre la columna', 'true',
  EXISTS (SELECT 1 FROM pg_constraint c
           WHERE c.conrelid = 'public.ordenes_servicio'::regclass AND c.contype = 'c'
             AND pg_get_constraintdef(c.oid) ILIKE '%trabajo_a_realizar%')::text;

INSERT INTO _r SELECT 3, 'las órdenes existentes quedan sin trabajo cargado', '0',
  (SELECT count(*)::text FROM public.ordenes_servicio WHERE trabajo_a_realizar IS NOT NULL);

SELECT orden, probe, esperado, obtenido,
       CASE WHEN esperado = obtenido THEN 'OK' ELSE 'FALLO' END AS resultado
  FROM _r ORDER BY orden;

ROLLBACK;
