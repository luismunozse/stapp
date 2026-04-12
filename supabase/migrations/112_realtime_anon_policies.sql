-- =============================================
-- 112: Habilitar Realtime - Políticas anon SELECT
-- El cliente WebSocket conecta con anon key, que no
-- tiene JWT ni headers → RLS bloqueaba todos los eventos.
-- Agregamos SELECT para anon en las tablas de realtime
-- y sumamos repuestos_orden a la publicación.
-- =============================================

-- 1. Políticas SELECT para rol anon en tablas ya publicadas
CREATE POLICY "anon_realtime_select" ON ordenes_servicio
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_realtime_select" ON cotizaciones
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_realtime_select" ON orden_eventos
  FOR SELECT TO anon USING (true);

-- 2. Agregar repuestos_orden a la publicación de realtime
ALTER PUBLICATION supabase_realtime ADD TABLE repuestos_orden;

CREATE POLICY "anon_realtime_select" ON repuestos_orden
  FOR SELECT TO anon USING (true);
