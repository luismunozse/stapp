-- ========================================
-- 257 — Commission flag: ENTREGADO_SIN_REPARACION orders
-- ========================================
-- Configures whether technician commission applies to orders diagnosed but
-- returned unrepaired. Default false = consistent behavior: not payable
-- and not deducted in P&L. Set to true to enable both (opt-in per org).
-- Applied manually in Supabase SQL editor.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS comision_aplica_sin_reparacion BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN organizations.comision_aplica_sin_reparacion IS
  'If true, ENTREGADO_SIN_REPARACION orders pay técnico commission and that commission is deducted in P&L. If false (default), such orders neither generate payable commission nor are deducted in P&L.';
