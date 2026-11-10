-- Probes de la 387 (nc_tope_idempotencia). Abre su propia transaccion y la
-- revierte: db-run.mjs detecta el BEGIN y rechaza --apply. Correr DESPUES de
-- aplicar la 387:
--   npm run db:dry -- supabase/migrations/verify/387_probes.sql
-- Contra una base sin la 387 el probe 1 da la firma vieja.
--
-- Arma una org propia (org-probe-387) y llama a la RPC real:
--   o1: cobrado 1000 (cobros_orden)         -> NC 600 ok, NC 500 rechazada,
--                                              NC 400 ok, anular la de 600 libera tope
--   o2: cobrado 300 + cobro anulado de 900  -> el anulado no cuenta
--   o3: cobrado 500, reembolso a CC         -> reintento con la misma clave no
--                                              duplica NC ni saldo
BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

-- 1. Firma: la de 10 parametros existe y la de 9 no
INSERT INTO _r SELECT 1, 'firmas de crear_nota_credito', '10',
  (SELECT string_agg(pronargs::TEXT, ',' ORDER BY pronargs) FROM pg_proc WHERE proname = 'crear_nota_credito');

-- 2. Permisos: solo service_role
INSERT INTO _r SELECT 2, 'ejecutable por anon / authenticated / service_role', 'false / false / true',
  has_function_privilege('anon', 'crear_nota_credito(text,text,text,text,numeric,text,text,text,jsonb,text)', 'EXECUTE')::TEXT
  || ' / ' ||
  has_function_privilege('authenticated', 'crear_nota_credito(text,text,text,text,numeric,text,text,text,jsonb,text)', 'EXECUTE')::TEXT
  || ' / ' ||
  has_function_privilege('service_role', 'crear_nota_credito(text,text,text,text,numeric,text,text,text,jsonb,text)', 'EXECUTE')::TEXT;

-- Fixture
INSERT INTO organizations (id, nombre, nombre_mostrar, slug)
VALUES ('org-probe-387', 'Probe 387', 'Probe 387', 'probe-387-' || substr(md5(random()::text), 1, 8));
INSERT INTO organizations (id, nombre, nombre_mostrar, slug)
VALUES ('org-probe-387b', 'Probe 387b', 'Probe 387b', 'probe-387b-' || substr(md5(random()::text), 1, 8));

INSERT INTO clientes (id, nombre, telefono, organization_id, saldo_cuenta)
VALUES ('cli-probe-387', 'Cliente probe 387', '387-0001', 'org-probe-387', 0);

INSERT INTO ordenes_servicio (
  id, numero_orden, cliente_id, organization_id, sucursal_id,
  dispositivo, tipo_dispositivo, problema_reportado, estado,
  costo_final, descuento_cobro, total_cobrado, estado_cobro
)
SELECT v.id, v.numero, 'cli-probe-387', 'org-probe-387',
       (SELECT id FROM sucursales WHERE organization_id = 'org-probe-387' AND principal),
       'Celular', 'CELULAR', 'Probe 387', 'ENTREGADO'::estado_orden, 2000, 0, 0, 'PENDIENTE'
FROM (VALUES ('ord-probe-387-1', 1), ('ord-probe-387-2', 2), ('ord-probe-387-3', 3)) AS v(id, numero);

INSERT INTO cobros_orden (orden_id, organization_id, monto, metodo_pago, anulado) VALUES
  ('ord-probe-387-1', 'org-probe-387', 1000, 'EFECTIVO', false),
  ('ord-probe-387-2', 'org-probe-387',  300, 'EFECTIVO', false),
  ('ord-probe-387-2', 'org-probe-387',  900, 'EFECTIVO', true),
  ('ord-probe-387-3', 'org-probe-387',  500, 'EFECTIVO', false);

-- 3. Dentro del tope
DO $$
DECLARE v JSON;
BEGIN
  v := crear_nota_credito('org-probe-387', NULL, 'ord-probe-387-1', 'OTRO', 600, 'NOTA_CREDITO_INTERNA', NULL, NULL, NULL, NULL);
  INSERT INTO _r VALUES (3, 'NC 600 sobre cobrado 1000', 'ok', CASE WHEN (v->>'success')::BOOLEAN THEN 'ok' ELSE v::TEXT END);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES (3, 'NC 600 sobre cobrado 1000', 'ok', 'FALLO: ' || SQLERRM);
END $$;

-- 4. 600 + 500 > 1000: P0040
DO $$
BEGIN
  PERFORM crear_nota_credito('org-probe-387', NULL, 'ord-probe-387-1', 'OTRO', 500, 'NOTA_CREDITO_INTERNA', NULL, NULL, NULL, NULL);
  INSERT INTO _r VALUES (4, 'NC 500 con 600 previas y cobrado 1000', 'error P0040', 'FALLO: no levanto excepcion');
EXCEPTION WHEN SQLSTATE 'P0040' THEN
  INSERT INTO _r VALUES (4, 'NC 500 con 600 previas y cobrado 1000', 'error P0040', 'OK: ' || SQLERRM);
END $$;

-- 5. Justo hasta el tope (600 + 400 = 1000)
DO $$
BEGIN
  PERFORM crear_nota_credito('org-probe-387', NULL, 'ord-probe-387-1', 'OTRO', 400, 'NOTA_CREDITO_INTERNA', NULL, NULL, NULL, NULL);
  INSERT INTO _r VALUES (5, 'NC 400 completa exactamente lo cobrado', 'ok', 'ok');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES (5, 'NC 400 completa exactamente lo cobrado', 'ok', 'FALLO: ' || SQLERRM);
END $$;

-- 6. Una NC anulada no cuenta para el tope
UPDATE notas_credito SET anulada = true WHERE orden_id = 'ord-probe-387-1' AND monto = 600;
DO $$
BEGIN
  PERFORM crear_nota_credito('org-probe-387', NULL, 'ord-probe-387-1', 'OTRO', 600, 'NOTA_CREDITO_INTERNA', NULL, NULL, NULL, NULL);
  INSERT INTO _r VALUES (6, 'anular la de 600 libera 600 de tope', 'ok', 'ok');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES (6, 'anular la de 600 libera 600 de tope', 'ok', 'FALLO: ' || SQLERRM);
END $$;

-- 7. Un cobro anulado no cuenta como cobrado (o2: 300 validos, 900 anulados)
DO $$
BEGIN
  PERFORM crear_nota_credito('org-probe-387', NULL, 'ord-probe-387-2', 'OTRO', 301, 'NOTA_CREDITO_INTERNA', NULL, NULL, NULL, NULL);
  INSERT INTO _r VALUES (7, 'NC 301 con cobrado 300 (+900 anulado)', 'error P0040', 'FALLO: no levanto excepcion');
EXCEPTION WHEN SQLSTATE 'P0040' THEN
  INSERT INTO _r VALUES (7, 'NC 301 con cobrado 300 (+900 anulado)', 'error P0040', 'OK: ' || SQLERRM);
END $$;

-- 8. Idempotencia: el reintento devuelve la misma NC y no acredita dos veces
DO $$
DECLARE a JSON; b JSON;
BEGIN
  a := crear_nota_credito('org-probe-387', NULL, 'ord-probe-387-3', 'OTRO', 200, 'CUENTA_CORRIENTE', NULL, NULL, NULL, 'clave-probe-387');
  b := crear_nota_credito('org-probe-387', NULL, 'ord-probe-387-3', 'OTRO', 200, 'CUENTA_CORRIENTE', NULL, NULL, NULL, 'clave-probe-387');
  INSERT INTO _r VALUES (8, 'reintento: misma NC / replayed / NC de la orden / saldo CC', 'true / true / 1 / 200.00',
    ((a->>'id') = (b->>'id'))::TEXT || ' / ' || COALESCE(b->>'replayed', 'null') || ' / ' ||
    (SELECT COUNT(*)::TEXT FROM notas_credito WHERE orden_id = 'ord-probe-387-3') || ' / ' ||
    (SELECT ROUND(saldo_cuenta, 2)::TEXT FROM clientes WHERE id = 'cli-probe-387'));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES (8, 'reintento: misma NC / replayed / NC de la orden / saldo CC', 'true / true / 1 / 200.00', 'FALLO: ' || SQLERRM);
END $$;

-- 9. La misma clave en otra orden: P0041
DO $$
BEGIN
  PERFORM crear_nota_credito('org-probe-387', NULL, 'ord-probe-387-2', 'OTRO', 10, 'NOTA_CREDITO_INTERNA', NULL, NULL, NULL, 'clave-probe-387');
  INSERT INTO _r VALUES (9, 'clave reutilizada en otra orden', 'error P0041', 'FALLO: no levanto excepcion');
EXCEPTION WHEN SQLSTATE 'P0041' THEN
  INSERT INTO _r VALUES (9, 'clave reutilizada en otra orden', 'error P0041', 'OK: ' || SQLERRM);
END $$;

-- 10. Orden de otra organizacion: P0002
DO $$
BEGIN
  PERFORM crear_nota_credito('org-probe-387b', NULL, 'ord-probe-387-1', 'OTRO', 10, 'NOTA_CREDITO_INTERNA', NULL, NULL, NULL, NULL);
  INSERT INTO _r VALUES (10, 'orden de otra organizacion', 'error P0002', 'FALLO: no levanto excepcion');
EXCEPTION WHEN SQLSTATE 'P0002' THEN
  INSERT INTO _r VALUES (10, 'orden de otra organizacion', 'error P0002', 'OK: ' || SQLERRM);
END $$;

-- 11. La llamada de 9 parametros con nombre (codigo previo al deploy) resuelve
--     a la funcion nueva por el DEFAULT
DO $$
BEGIN
  PERFORM crear_nota_credito(
    p_org_id => 'org-probe-387', p_venta_id => NULL, p_orden_id => 'ord-probe-387-2',
    p_motivo => 'OTRO', p_monto => 100, p_metodo_devolucion => 'NOTA_CREDITO_INTERNA',
    p_notas => NULL, p_user_id => NULL, p_items => NULL);
  INSERT INTO _r VALUES (11, 'llamada con los 9 parametros de antes', 'ok', 'ok');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES (11, 'llamada con los 9 parametros de antes', 'ok', 'FALLO: ' || SQLERRM);
END $$;

SELECT orden, probe, esperado, obtenido FROM _r ORDER BY orden, probe;

ROLLBACK;
