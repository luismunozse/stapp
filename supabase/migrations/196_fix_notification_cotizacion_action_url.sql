-- ============================================
-- 196: Fix action_url en notificaciones de cotizaciones
-- ============================================
-- Las notifs viejas (type=CATALOGO_SOLICITUD y otras de cotización) tenían
-- action_url = /cotizaciones/<id> pero esa ruta no existe como page → 404.
-- El detalle se abre como dialog en /cotizaciones?abrir=<id>.
--
-- Esta migration backfilla las action_urls existentes al formato correcto.
-- También hay un page de redirect /cotizaciones/[id] en código para capturar
-- links externos (screenshots, bookmarks), pero limpiamos lo persistido
-- igual para mantener consistencia.
-- ============================================

UPDATE user_notifications
SET action_url = regexp_replace(
  action_url,
  '^/cotizaciones/([0-9a-zA-Z_-]+)$',
  '/cotizaciones?abrir=\1'
)
WHERE action_url ~ '^/cotizaciones/[0-9a-zA-Z_-]+$';
