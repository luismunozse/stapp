-- Rollback of comisiones_anular_pago_rpc (migration 379).
--
-- Drops anular_pago_comisiones. No data is lost: annulled payouts and items stay annulled in the
-- 376 tables, and the audit_logs rows it wrote stay. Payouts can no longer be annulled through
-- the database until the function is restored.
-- Run this before the 378 rollback: 379 depends on comisiones_sincronizar_flags.

DROP FUNCTION IF EXISTS anular_pago_comisiones(TEXT, TEXT, TEXT, TEXT);
