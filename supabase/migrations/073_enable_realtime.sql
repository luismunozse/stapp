-- Enable Supabase Realtime for key tables
-- This allows the frontend to subscribe to changes in real-time

ALTER PUBLICATION supabase_realtime ADD TABLE ordenes_servicio;
ALTER PUBLICATION supabase_realtime ADD TABLE cotizaciones;
ALTER PUBLICATION supabase_realtime ADD TABLE orden_eventos;
