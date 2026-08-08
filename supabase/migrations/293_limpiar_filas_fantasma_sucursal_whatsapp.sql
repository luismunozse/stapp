-- ========================================
-- 293: limpiar filas fantasma de sucursal_whatsapp_config
-- ========================================
-- El GET de poll (/api/sucursales/[id]/whatsapp/qr) hacía upsert y creaba
-- filas con evolution_instance_name para instancias que NUNCA se crearon en
-- Evolution: bastaba que un admin abriera la pantalla de configuración.
-- El health check las reporta como "no aparece en fetchInstances" en cada
-- corrida, para siempre (indeterminadas).
--
-- Criterio de fila fantasma: nunca hubo QR (evolution_last_qr_at IS NULL) y el
-- estado quedó en 'unknown' (el connect real siempre deja qr/connecting/open).
-- Las filas se borran enteras: el POST /connect las recrea correctamente si el
-- taller conecta de verdad. Idempotente.

DELETE FROM sucursal_whatsapp_config
WHERE evolution_connection_state = 'unknown'
  AND evolution_last_qr_at IS NULL;
