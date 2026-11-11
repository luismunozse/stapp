-- Verificación de pago_idempotency_crear (393).
--
-- Se puede correr ANTES o DESPUÉS de aplicar la 393 (sin --apply: termina en
-- ROLLBACK). Si la tabla no existe la crea dentro de la transacción, así que
-- antes de aplicar sirve para probar el cambio de camino sin dejar nada.
--
-- Toma una venta, una orden y una factura reales con al menos $1 pendiente y
-- cobra $1 en EFECTIVO dos veces con la misma clave. Todo se revierte; ningún
-- trigger de esas tablas sale de la base (no hay net.http ni dblink).
--
-- Qué prueba, por cada función:
--   a  el primer cobro no es replay y registra exactamente una fila de pago;
--   b  el segundo, con la misma clave, es replay y no agrega otra fila;
--   c  el replay devuelve la misma respuesta que el primero;
--   d  el saldo de la venta / orden / factura subió exactamente $1.
-- Y además: la tabla tiene RLS y anon/authenticated no tienen privilegios.
--
-- Resultado: UN select. Verde = esperado igual a obtenido.

BEGIN;

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

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

INSERT INTO _r SELECT 0, 'RLS activo y sin privilegios para anon/authenticated', 'true / 0',
  (SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.pago_idempotency'::regclass) || ' / ' ||
  (SELECT count(*)::text FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'pago_idempotency' AND grantee IN ('anon', 'authenticated'));

-- ---------------------------------------------------------------- ventas
DO $$
DECLARE
  v RECORD; u TEXT; r1 JSONB; r2 JSONB; n0 INT; n1 INT; n2 INT; a0 NUMERIC; a2 NUMERIC;
  pagos JSONB := '[{"monto": 1, "metodo": "EFECTIVO"}]';
BEGIN
  SELECT ve.* INTO v FROM ventas ve
   WHERE ve.estado <> 'ANULADA' AND ve.cliente_id IS NULL
     AND ve.total - COALESCE(ve.monto_abonado, 0)
         - COALESCE((SELECT SUM(monto_aplicado_deuda) FROM devoluciones_venta d WHERE d.venta_id = ve.id), 0) >= 1
   ORDER BY ve.created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO _r VALUES (1, 'ventas: hay una venta con $1 pendiente para probar', 'sí', 'no');
    RETURN;
  END IF;
  SELECT id INTO u FROM users WHERE organization_id = v.organization_id LIMIT 1;
  SELECT count(*) INTO n0 FROM pagos_venta WHERE venta_id = v.id;
  a0 := COALESCE(v.monto_abonado, 0);
  r1 := registrar_pagos_venta_atomica(v.organization_id, v.id, u, NULL, 'probe 393', pagos, 'probe-393-venta');
  SELECT count(*) INTO n1 FROM pagos_venta WHERE venta_id = v.id;
  r2 := registrar_pagos_venta_atomica(v.organization_id, v.id, u, NULL, 'probe 393', pagos, 'probe-393-venta');
  SELECT count(*) INTO n2 FROM pagos_venta WHERE venta_id = v.id;
  SELECT COALESCE(monto_abonado, 0) INTO a2 FROM ventas WHERE id = v.id;
  INSERT INTO _r VALUES
    (1, 'ventas a: primer cobro registra 1 pago', 'false / 1', (r1->>'replayed') || ' / ' || (n1 - n0)),
    (2, 'ventas b: reintento es replay y no duplica', 'true / 0', (r2->>'replayed') || ' / ' || (n2 - n1)),
    (3, 'ventas c: replay devuelve la misma respuesta', 'true', ((r1->'response') = (r2->'response'))::text),
    (4, 'ventas d: monto_abonado sube $1', '1.00', to_char(a2 - a0, 'FM9990.00'));
END $$;

-- ---------------------------------------------------------------- órdenes
DO $$
DECLARE
  o RECORD; u TEXT; r1 JSONB; r2 JSONB; n0 INT; n1 INT; n2 INT; t0 NUMERIC; t2 NUMERIC;
  pagos JSONB := '[{"monto": 1, "metodo": "EFECTIVO"}]';
BEGIN
  SELECT * INTO o FROM ordenes_servicio
   WHERE COALESCE(costo_final, 0) - COALESCE(descuento_cobro, 0) - COALESCE(total_cobrado, 0) >= 1
     AND cliente_id IS NOT NULL
   ORDER BY fecha_ingreso DESC LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO _r VALUES (5, 'órdenes: hay una orden con $1 pendiente para probar', 'sí', 'no');
    RETURN;
  END IF;
  SELECT id INTO u FROM users WHERE organization_id = o.organization_id LIMIT 1;
  SELECT count(*) INTO n0 FROM cobros_orden WHERE orden_id = o.id;
  t0 := COALESCE(o.total_cobrado, 0);
  r1 := registrar_cobros_orden_atomica(o.organization_id, o.id, u, pagos, 'probe 393', 0, 'probe-393-orden');
  SELECT count(*) INTO n1 FROM cobros_orden WHERE orden_id = o.id;
  r2 := registrar_cobros_orden_atomica(o.organization_id, o.id, u, pagos, 'probe 393', 0, 'probe-393-orden');
  SELECT count(*) INTO n2 FROM cobros_orden WHERE orden_id = o.id;
  SELECT COALESCE(total_cobrado, 0) INTO t2 FROM ordenes_servicio WHERE id = o.id;
  INSERT INTO _r VALUES
    (5, 'órdenes a: primer cobro registra 1 cobro', 'false / 1', (r1->>'replayed') || ' / ' || (n1 - n0)),
    (6, 'órdenes b: reintento es replay y no duplica', 'true / 0', (r2->>'replayed') || ' / ' || (n2 - n1)),
    (7, 'órdenes c: replay devuelve la misma respuesta', 'true', ((r1->'response') = (r2->'response'))::text),
    (8, 'órdenes d: total_cobrado sube $1', '1.00', to_char(t2 - t0, 'FM9990.00'));
END $$;

-- ---------------------------------------------------------------- facturas
DO $$
DECLARE
  f RECORD; u TEXT; r1 JSONB; r2 JSONB; n0 INT; n1 INT; n2 INT; a0 NUMERIC; a2 NUMERIC;
  pagos JSONB := '[{"monto": 1, "metodo": "EFECTIVO"}]';
BEGIN
  SELECT fa.*, o.organization_id AS org_id INTO f
    FROM facturas fa JOIN ordenes_servicio o ON o.id = fa.orden_id
   WHERE fa.estado_pago::text <> 'ANULADA' AND fa.total - COALESCE(fa.monto_abonado, 0) >= 1
   ORDER BY fa.fecha DESC LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO _r VALUES (9, 'facturas: hay una factura con $1 pendiente para probar', 'sí', 'no');
    RETURN;
  END IF;
  SELECT id INTO u FROM users WHERE organization_id = f.org_id LIMIT 1;
  SELECT count(*) INTO n0 FROM pagos_parciales WHERE factura_id = f.id;
  a0 := COALESCE(f.monto_abonado, 0);
  r1 := registrar_pago_factura_atomica(f.org_id, f.id, u, NULL, 'probe 393', pagos, 'probe-393-factura');
  SELECT count(*) INTO n1 FROM pagos_parciales WHERE factura_id = f.id;
  r2 := registrar_pago_factura_atomica(f.org_id, f.id, u, NULL, 'probe 393', pagos, 'probe-393-factura');
  SELECT count(*) INTO n2 FROM pagos_parciales WHERE factura_id = f.id;
  SELECT COALESCE(monto_abonado, 0) INTO a2 FROM facturas WHERE id = f.id;
  INSERT INTO _r VALUES
    (9,  'facturas a: primer pago registra 1 pago', 'false / 1', (r1->>'replayed') || ' / ' || (n1 - n0)),
    (10, 'facturas b: reintento es replay y no duplica', 'true / 0', (r2->>'replayed') || ' / ' || (n2 - n1)),
    (11, 'facturas c: replay devuelve la misma respuesta', 'true', ((r1->'response') = (r2->'response'))::text),
    (12, 'facturas d: monto_abonado sube $1', '1.00', to_char(a2 - a0, 'FM9990.00'));
END $$;

SELECT orden, probe, esperado, obtenido, esperado = obtenido AS ok FROM _r ORDER BY orden;

ROLLBACK;
