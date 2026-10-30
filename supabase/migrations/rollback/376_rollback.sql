-- Rollback of comisiones_fundacion (migration 376).
--
-- WARNING: this loses every commission payout, payout item and adjustment recorded
-- since 376 was applied (the tables are removed, not archived). Run 377_rollback first:
-- later objects depend on these tables.
--
-- Export before removing anything:
--   SELECT * FROM comisiones_pagos p JOIN comisiones_pagos_items i ON i.pago_id = p.id;
--   SELECT * FROM comisiones_ajustes;
--
-- Legacy paid flags stay correct because the RPCs keep them in sync with the payouts.
-- ventas.fecha_anulacion has no other reader, so it is safe to remove.

-- DROP COLUMN on ventas takes ACCESS EXCLUSIVE: do not queue behind a long transaction.
SET LOCAL lock_timeout = '3s';

DROP TABLE IF EXISTS comisiones_pagos_items;
DROP TABLE IF EXISTS comisiones_pagos;
DROP TABLE IF EXISTS comisiones_ajustes;

DROP TRIGGER IF EXISTS ventas_fecha_anulacion ON ventas;
DROP FUNCTION IF EXISTS set_fecha_anulacion_venta();
ALTER TABLE ventas DROP COLUMN IF EXISTS fecha_anulacion;
