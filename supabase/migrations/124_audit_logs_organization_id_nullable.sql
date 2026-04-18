-- ============================================
-- Migration 124: Permitir organization_id NULL en audit_logs
-- ============================================
-- Acciones de superadmin a nivel de sistema (LOGIN, LOGOUT,
-- LOGIN_FAILED, BROADCAST, EMAIL_CAMPAIGN, CRON_RUN, PLAN_TOGGLE,
-- plan CREATE/UPDATE, changelog, waitlistBulkDelete, leadUpdate,
-- etc.) no están asociadas a ninguna organización específica.
--
-- El helper lib/superadmin-audit.ts usaba el UUID sentinel
-- '00000000-0000-0000-0000-000000000000' como placeholder, pero
-- ese id no existe en organizations, causando:
--   insert or update on table "audit_logs" violates foreign key
--   constraint "audit_logs_organization_id_fkey"
-- y los eventos no quedaban registrados.
--
-- Sigue el patrón de las migraciones 095 (entity_id) y 115
-- (user_id), que ya removieron NOT NULL por la misma razón.
-- ============================================

ALTER TABLE audit_logs ALTER COLUMN organization_id DROP NOT NULL;
