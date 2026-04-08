-- ============================================
-- Migration 095: Permitir entity_id NULL en audit_logs
-- ============================================
-- Algunas acciones de auditoría no apuntan a una entidad puntual
-- (LOGIN, LOGOUT, LOGIN_FAILED, BROADCAST, EMAIL_CAMPAIGN, CRON_RUN,
-- BULK_ACTION sobre múltiples ids, etc). Hasta ahora estos inserts
-- fallaban con:
--   null value in column "entity_id" of relation "audit_logs"
--   violates not-null constraint
-- y los eventos no quedaban registrados. Helpers afectados en
-- lib/superadmin-audit.ts: logLoginEvent, logLogoutEvent,
-- bulkToggleOrgs, broadcast, emailCampaign, cronRun,
-- subscriptionRenew, trialExtension, waitlistBulkDelete.
-- ============================================

ALTER TABLE audit_logs ALTER COLUMN entity_id DROP NOT NULL;
