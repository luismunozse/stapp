-- Rollback of comisiones_pagar_rpc (migration 378).
--
-- Drops pagar_comisiones and comisiones_sincronizar_flags. No data is lost: the payouts and
-- items stay in the 376 tables. The legacy flags (comision_pagada, fecha_pago_comision,
-- comision_pago_notas) stay as last synced; nothing keeps them in step with new payouts
-- until the functions are restored.
-- Run the 379 rollback first if it exists: it shares the advisory lock key and reads these tables.

DROP FUNCTION IF EXISTS pagar_comisiones(TEXT, TEXT, TEXT, JSONB, TEXT);
DROP FUNCTION IF EXISTS comisiones_sincronizar_flags(TEXT, TEXT, TEXT[]);
