-- ========================================
-- LEADS: flag "visto" para notificación in-app de leads calientes
-- ========================================
-- Permite mostrar badge en navbar superadmin con leads calientes (score >= 80)
-- aún no revisados. Se marca true cuando el admin abre el detalle del lead.
-- Cuando un lead existente sube de < 80 a >= 80, el flag se resetea a false.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS visto BOOLEAN NOT NULL DEFAULT FALSE;

-- Índice parcial para conteo rápido en endpoint stats.
CREATE INDEX IF NOT EXISTS idx_leads_no_vistos_calientes
  ON leads(visto)
  WHERE visto = FALSE AND score >= 80;

COMMENT ON COLUMN leads.visto IS
  'TRUE cuando un superadmin abrió el detalle del lead. Se usa para badge "leads calientes nuevos" en navbar.';
