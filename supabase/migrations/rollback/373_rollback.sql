-- Rollback de avisos_push (migracion 373).
--
-- ORDEN: primero quitar el cron /api/cron/avisos-push (vercel.json) y redeployar;
-- mientras el cron siga vivo, borrar la funcion lo hace fallar cada minuto.

DROP FUNCTION IF EXISTS claim_avisos_para_push(INT);
ALTER TABLE user_notifications DROP COLUMN IF EXISTS push_enviado_at;
