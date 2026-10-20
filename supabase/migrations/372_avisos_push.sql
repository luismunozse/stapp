-- ============================================================================
-- 372: push por aviso (outbox sobre user_notifications)
-- ============================================================================
-- QUE: cada fila de user_notifications (el "aviso" de la campanita) tiene que
-- llegar tambien como push al user_id, sin importar quien la escribio: codigo
-- Node (send-direct, whatsapp/health, cotizar, broadcast, renew, trial-extension)
-- o el trigger SQL notify_stock_bajo_on_movimiento (168), que nunca pasa por Node.
--
-- COMO: outbox. El cron /api/cron/avisos-push (cada minuto) llama a
-- claim_avisos_para_push(), que marca y devuelve de forma atomica las filas aun
-- no pusheadas. Un solo camino cubre a todos los escritores, presentes y futuros.
--
-- DECISIONES:
--   - push_enviado_at IS NULL = todavia no se intento. Se marca al RECLAMAR, no al
--     entregar: es at-most-once. Un push perdido es mejor que uno duplicado cada
--     minuto; el aviso sigue en la campanita igual.
--   - Ventana de 15 minutos: si el cron estuvo caido, no se disparan pushes viejos
--     de golpe al volver.
--   - Solo se reclaman avisos de usuarios con al menos una suscripcion web activa
--     o un token nativo activo. Los demas no se tocan: envejecen fuera de la
--     ventana (a proposito) y no se gasta una escritura por ellos.
--   - FOR UPDATE SKIP LOCKED: dos corridas concurrentes nunca reclaman la misma fila.
--   - SECURITY INVOKER: el cron usa service_role, que ya tiene acceso a las tablas.
--     Sin SECURITY DEFINER no hay nada que escalar; igual se revoca a anon y
--     authenticated para que la anon key (va en el bundle) no pueda reclamar avisos.
--   - Indice: user_notifications_created_idx (056) cubre el barrido por ventana.
--
-- DEPLOY: aditiva y sin downtime. APLICAR ANTES de mergear el PR: el cron llama a
-- esta funcion y, sin ella, falla cada minuto.
--
-- Filas existentes: quedan con push_enviado_at NULL, pero todas son mas viejas que
-- la ventana, asi que nunca se reclaman.
-- ============================================================================

ALTER TABLE user_notifications
  ADD COLUMN IF NOT EXISTS push_enviado_at TIMESTAMPTZ;

COMMENT ON COLUMN user_notifications.push_enviado_at IS
  'Cuando el barrido avisos-push reclamo este aviso para mandarlo como push. NULL = pendiente (o usuario sin suscripcion).';

CREATE OR REPLACE FUNCTION claim_avisos_para_push(p_limit INT DEFAULT 500)
RETURNS TABLE (
  id         TEXT,
  user_id    TEXT,
  title      TEXT,
  body       TEXT,
  action_url TEXT,
  orden_id   TEXT,
  type       TEXT
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  UPDATE user_notifications AS n
     SET push_enviado_at = now()
   WHERE n.id IN (
     SELECT c.id
       FROM user_notifications AS c
      WHERE c.push_enviado_at IS NULL
        AND c.created_at > now() - interval '15 minutes'
        AND (
          EXISTS (
            SELECT 1 FROM web_push_subscriptions AS w
             WHERE w.user_id = c.user_id AND w.active = TRUE
          )
          OR EXISTS (
            SELECT 1 FROM push_tokens AS t
             WHERE t.user_id = c.user_id AND t.active = TRUE
          )
        )
      ORDER BY c.created_at
      LIMIT p_limit
        FOR UPDATE OF c SKIP LOCKED
   )
  RETURNING n.id, n.user_id, n.title, n.body, n.action_url, n.orden_id, n.type;
$$;

REVOKE EXECUTE ON FUNCTION claim_avisos_para_push(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_avisos_para_push(INT) TO service_role;
