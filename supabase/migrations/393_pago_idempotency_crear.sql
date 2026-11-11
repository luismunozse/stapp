-- Crear pago_idempotency, que nunca llegó a producción.
--
-- registrar_pagos_venta_atomica (331), registrar_cobros_orden_atomica (242/269)
-- y registrar_pago_factura_atomica (243/269) guardan ahí la clave de cada cobro
-- cuando llega una. Los formularios siempre la mandan, la tabla no existía, y el
-- error "relation pago_idempotency does not exist" hacía que las rutas cayeran
-- a su camino JS de respaldo: no atómico y sin barrera contra cobros dobles.
--
-- Con la tabla, esos cobros pasan por las funciones atómicas. La nota de la 354
-- ("otro flujo depende de que siga ausente") se refería a ese cambio de camino;
-- verify/393_probes.sql ejecuta las tres funciones con clave sobre registros
-- reales dentro de una transacción que se revierte.
--
-- Forma: la de la 233 con los ALTER de la 242 (venta_id opcional, orden_id) y la
-- 243 (factura_id). Solo service_role: RLS activo y sin políticas.

SET LOCAL lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS pago_idempotency (
  organization_id TEXT        NOT NULL,
  idempotency_key TEXT        NOT NULL,
  venta_id        TEXT,
  orden_id        TEXT,
  factura_id      TEXT,
  response        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, idempotency_key)
);

ALTER TABLE pago_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pago_idempotency FROM anon, authenticated;

COMMENT ON TABLE pago_idempotency IS
  'Barrera de idempotencia de los cobros (ventas, órdenes, facturas). Una fila por '
  'clave de pedido; response se completa en la misma transacción del cobro. '
  'Solo service_role.';
