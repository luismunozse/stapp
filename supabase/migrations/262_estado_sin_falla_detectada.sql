-- Migration 262: nuevo estado SIN_FALLA_DETECTADA.
-- Para equipos que ingresan con una falla reportada que, al revisarlos, no se
-- reproduce (ej. "no carga" pero el problema era el cargador). No es lo mismo
-- que SIN_REPARACION (no se pudo reparar): acá el equipo está OK.
--
-- Es un resultado de diagnóstico que termina en entrega/retiro (con o sin cobro
-- de revisión), igual que SIN_REPARACION. No es un estado de entrega, por eso
-- NO se toca el trigger registrar_cambio_estado_tiempo (token expiry).
--
-- Applied manually in Supabase SQL editor.

ALTER TYPE estado_orden ADD VALUE IF NOT EXISTS 'SIN_FALLA_DETECTADA';
