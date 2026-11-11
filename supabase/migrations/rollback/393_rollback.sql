-- Rollback de pago_idempotency_crear (393). Los cobros vuelven al camino JS de respaldo.
SET LOCAL lock_timeout = '3s';
DROP TABLE IF EXISTS pago_idempotency;
