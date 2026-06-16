-- ========================================
-- 230 — Dormant-org auto-archive: warning timestamp
-- ========================================
-- Tracks when the dormant-org archival WARNING email was delivered. The
-- auto-archive cron (app/api/cron/auto-archive-dormant) only archives an org
-- AFTER a warning was actually sent and a grace window elapsed with continued
-- dormancy. Cleared (back to NULL) if the org comes back to life or starts
-- paying before the grace runs out.
--
-- Purely additive, nullable. NULL = never warned.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS archival_warned_at TIMESTAMPTZ;
