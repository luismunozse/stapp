-- Rollback de la 417. Saca los triggers y la funcion. NO revierte el backfill:
-- los remitos que pasaron a PAGADO / PAGADO_PARCIAL reflejan plata que la
-- orden si cobro; volverlos a PENDIENTE reabre el riesgo de cobrarla dos veces.
DROP TRIGGER IF EXISTS facturas_alta_sincroniza_remito ON facturas;
DROP TRIGGER IF EXISTS ordenes_servicio_sincroniza_remito ON ordenes_servicio;
DROP FUNCTION IF EXISTS trg_facturas_alta_sincroniza_remito();
DROP FUNCTION IF EXISTS trg_ordenes_sincroniza_remito();
DROP FUNCTION IF EXISTS sincronizar_remito_orden(TEXT);
