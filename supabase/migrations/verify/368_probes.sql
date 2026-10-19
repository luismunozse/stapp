-- Probes de la 368. Abren su propia transaccion y la revierten: db-run.mjs
-- detecta el BEGIN y rechaza --apply. Correr DESPUES de aplicar la 368:
--   npm run db:dry -- supabase/migrations/verify/368_probes.sql
-- (o en el editor SQL de Supabase; ver "Pasos manuales" del plan del PR4).
-- Contra una base sin la 368 cortan al crear pg_temp.series_de, antes del
-- probe 1 (la columna series_devueltas no existe).
--
-- Fixture propia (org-probe-368). La sucursal y el deposito principales los
-- crea el alta de la org (217/221); se suma el deposito "Norte" en la misma
-- sucursal. Las NC "anuladas" de estos probes se marcan a mano (UPDATE anulada
-- = true): aca se prueba que los lectores las ignoren. La anulacion de verdad,
-- con sus reversas, es de la 369.
-- Los literales que van a columnas enum (ventas.estado, ventas.metodo_pago,
-- garantias_venta.estado) llevan su cast.
BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);
CREATE TEMP TABLE _nc (clave TEXT PRIMARY KEY, res JSONB);

INSERT INTO organizations (id, nombre, nombre_mostrar, slug)
VALUES ('org-probe-368', 'Probe 368', 'Probe 368', 'probe-368-' || substr(md5(random()::text), 1, 8));

INSERT INTO users (id, organization_id, sucursal_id, email, nombre, password, rol)
VALUES ('usr-probe-368', 'org-probe-368',
        (SELECT id FROM sucursales WHERE organization_id = 'org-probe-368' AND principal),
        'admin@probe-368.invalid', 'Probe 368', 'x', 'ADMIN');

INSERT INTO clientes (id, nombre, telefono, organization_id)
VALUES ('cli-probe-368', 'Cliente probe 368', '368-0001', 'org-probe-368');

INSERT INTO depositos (id, organization_id, sucursal_id, nombre, principal, activo)
VALUES ('dep-probe-368-n', 'org-probe-368',
        (SELECT id FROM sucursales WHERE organization_id = 'org-probe-368' AND principal),
        'Norte probe 368', false, true);

-- S: con series, 5 unidades (2 en la principal, 3 en Norte). P: sin series, 20 en la principal.
INSERT INTO inventario (id, organization_id, codigo, nombre, categoria, precio_compra, precio_venta, stock, trackea_series)
VALUES ('inv-probe-368-s', 'org-probe-368', 'P368-S', 'Celular probe 368', 'Probe', 50, 100, 5, true),
       ('inv-probe-368-p', 'org-probe-368', 'P368-P', 'Funda probe 368', 'Probe', 10, 50, 20, false);
-- El alta (291) sembro todo S en la principal: 3 unidades pasan a Norte.
UPDATE inventario_depositos SET stock = 2
WHERE inventario_id = 'inv-probe-368-s' AND deposito_id = get_deposito_principal('org-probe-368');
INSERT INTO inventario_depositos (inventario_id, deposito_id, stock, organization_id)
VALUES ('inv-probe-368-s', 'dep-probe-368-n', 3, 'org-probe-368');

-- 1: dos celulares con 90 dias de garantia, pagada (series S1 y S2, salieron de Norte)
-- 2 y 3: dos fundas a $50; la 2 pagada, la 3 fiada
-- 4: dos productos sin inventario con 30 dias de garantia, pagada
-- 5: un celular sin garantia del taller, pagada (serie S4)
-- 6: fiada, sin productos (NC por monto + cobro)
-- 7: dos fundas, de mostrador, pagada (anulacion de la venta)
-- 8: pagada, con cliente (saldo a favor en cuenta corriente)
INSERT INTO ventas (id, numero_venta, cliente_id, cliente_nombre, vendedor_id, subtotal, total,
                    metodo_pago, estado, organization_id, sucursal_id, monto_abonado, estado_pago)
SELECT v.id, v.numero, v.cliente, 'Probe 368', 'usr-probe-368', v.total, v.total,
       'EFECTIVO'::metodo_pago_venta, 'COMPLETADA'::estado_venta, 'org-probe-368',
       (SELECT id FROM sucursales WHERE organization_id = 'org-probe-368' AND principal),
       v.abonado, v.estado_pago
FROM (VALUES
  ('vta-probe-368-1', 1, 'cli-probe-368', 200.00, 200.00, 'PAGADO'),
  ('vta-probe-368-2', 2, 'cli-probe-368', 100.00, 100.00, 'PAGADO'),
  ('vta-probe-368-3', 3, 'cli-probe-368', 100.00, 0.00, 'PENDIENTE'),
  ('vta-probe-368-4', 4, 'cli-probe-368', 100.00, 100.00, 'PAGADO'),
  ('vta-probe-368-5', 5, 'cli-probe-368', 100.00, 100.00, 'PAGADO'),
  ('vta-probe-368-6', 6, 'cli-probe-368', 100.00, 0.00, 'PENDIENTE'),
  ('vta-probe-368-7', 7, NULL, 100.00, 100.00, 'PAGADO'),
  ('vta-probe-368-8', 8, 'cli-probe-368', 100.00, 100.00, 'PAGADO')
) AS v(id, numero, cliente, total, abonado, estado_pago);

INSERT INTO items_venta (id, venta_id, inventario_id, descripcion, cantidad, precio_unitario, subtotal, dias_garantia)
VALUES ('iv-probe-368-1', 'vta-probe-368-1', 'inv-probe-368-s', 'Celular probe 368', 2, 100, 200, 90),
       ('iv-probe-368-2', 'vta-probe-368-2', 'inv-probe-368-p', 'Funda probe 368', 2, 50, 100, 0),
       ('iv-probe-368-3', 'vta-probe-368-3', 'inv-probe-368-p', 'Funda probe 368', 2, 50, 100, 0),
       ('iv-probe-368-4', 'vta-probe-368-4', NULL, 'Servicio probe 368', 2, 50, 100, 30),
       ('iv-probe-368-5', 'vta-probe-368-5', 'inv-probe-368-s', 'Celular probe 368', 1, 100, 100, 0),
       ('iv-probe-368-7', 'vta-probe-368-7', 'inv-probe-368-p', 'Funda probe 368', 2, 50, 100, 0);

-- La venta 1 salio del deposito Norte: la devolucion repone ahi (224).
INSERT INTO movimientos_inventario (inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
                                    referencia_id, referencia_tipo, organization_id, deposito_id)
VALUES ('inv-probe-368-s', 'VENTA', -2, 7, 5, 'vta-probe-368-1', 'VENTA', 'org-probe-368', 'dep-probe-368-n');

INSERT INTO inventario_series (id, inventario_id, numero_serie, estado, fecha_venta, fecha_garantia_vence,
                               venta_id, cliente_id, deposito_id, organization_id)
VALUES ('ser-probe-368-1', 'inv-probe-368-s', 'IMEI-368-1', 'GARANTIA_ACTIVA', '2026-10-01 12:00:00+00', '2026-12-30',
        'vta-probe-368-1', 'cli-probe-368', 'dep-probe-368-n', 'org-probe-368'),
       ('ser-probe-368-2', 'inv-probe-368-s', 'IMEI-368-2', 'GARANTIA_ACTIVA', '2026-10-01 12:00:00+00', '2026-12-30',
        'vta-probe-368-1', 'cli-probe-368', 'dep-probe-368-n', 'org-probe-368'),
       ('ser-probe-368-3', 'inv-probe-368-s', 'IMEI-368-3', 'DISPONIBLE', NULL, NULL,
        NULL, NULL, 'dep-probe-368-n', 'org-probe-368'),
       -- Vendida sin garantia del taller: la fecha que tiene es la del proveedor (317).
       ('ser-probe-368-4', 'inv-probe-368-s', 'IMEI-368-4', 'VENDIDO', '2026-10-02 10:00:00+00', '2027-01-15',
        'vta-probe-368-5', 'cli-probe-368', 'dep-probe-368-n', 'org-probe-368');

INSERT INTO garantias_venta (id, venta_id, item_venta_id, numero_garantia, dias_validez, fecha_vencimiento, estado, organization_id)
VALUES ('gar-probe-368-1', 'vta-probe-368-1', 'iv-probe-368-1', 'GAR-P368-1', 90, now() + interval '90 days',
        'ACTIVA'::estado_garantia_venta, 'org-probe-368'),
       ('gar-probe-368-4', 'vta-probe-368-4', 'iv-probe-368-4', 'GAR-P368-4', 30, now() + interval '30 days',
        'ACTIVA'::estado_garantia_venta, 'org-probe-368');

-- Atajos: una NC por productos o por monto como la manda la ruta del PR3, y el
-- mensaje de error de una sentencia ('sin error' si anda).
CREATE FUNCTION pg_temp.nc_items(p_venta TEXT, p_items JSONB, p_metodo TEXT, p_key TEXT)
RETURNS JSONB LANGUAGE sql AS $$
  SELECT registrar_devolucion_atomica(
    p_org_id => 'org-probe-368', p_venta_id => p_venta, p_user_id => 'usr-probe-368',
    p_numero_devolucion => NULL, p_motivo => 'Probe 368', p_observaciones => NULL,
    p_metodo_reembolso => p_metodo, p_reembolso_referencia => NULL, p_items => p_items,
    p_idempotency_key => p_key, p_modo => 'ITEMS', p_monto => NULL,
    p_motivo_nc => 'DEVOLUCION', p_registrar_egreso => true)
$$;

CREATE FUNCTION pg_temp.nc_monto(p_venta TEXT, p_monto NUMERIC, p_metodo TEXT, p_key TEXT)
RETURNS JSONB LANGUAGE sql AS $$
  SELECT registrar_devolucion_atomica(
    p_org_id => 'org-probe-368', p_venta_id => p_venta, p_user_id => 'usr-probe-368',
    p_numero_devolucion => NULL, p_motivo => 'Probe 368', p_observaciones => NULL,
    p_metodo_reembolso => p_metodo, p_reembolso_referencia => NULL, p_items => '[]'::jsonb,
    p_idempotency_key => p_key, p_modo => 'MONTO', p_monto => p_monto,
    p_motivo_nc => 'AJUSTE_PRECIO', p_registrar_egreso => true)
$$;

CREATE FUNCTION pg_temp.error_de(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'sin error';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;

-- Las series que guardo la linea de una NC: "id:estado:cliente:vence", por id.
CREATE FUNCTION pg_temp.series_de(p_nc TEXT) RETURNS TEXT LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(
           (e->>'id') || ':' || (e->>'estado') || ':' || COALESCE(e->>'cliente_id', '-') || ':'
             || COALESCE(e->>'fecha_garantia_vence', '-'), ' ' ORDER BY e->>'id'), 'ninguna')
  FROM items_devolucion idv, jsonb_array_elements(idv.series_devueltas) e
  WHERE idv.devolucion_id = p_nc
$$;

-- ── Esquema y permisos ─────────────────────────────────────────────────────
INSERT INTO _r SELECT 1, 'items_devolucion: series_devueltas jsonb que admite NULL / FK a inventario ON DELETE SET NULL',
  'jsonb / YES / inventario / n',
  COALESCE((SELECT data_type || ' / ' || is_nullable FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'items_devolucion'
               AND column_name = 'series_devueltas'), 'no existe') || ' / ' ||
  COALESCE((SELECT c.confrelid::regclass::TEXT || ' / ' || c.confdeltype::TEXT
              FROM pg_constraint c
             WHERE c.conname = 'items_devolucion_inventario_id_fkey'
               AND c.conrelid = 'public.items_devolucion'::regclass), 'sin FK');

INSERT INTO _r SELECT 2, 'nucleo: una sola firma de 10 / EXECUTE anon / authenticated / service_role',
  '1 / 10 / false / false / true',
  COUNT(*)::TEXT || ' / ' || COALESCE(MAX(p.pronargs)::TEXT, '-') || ' / ' ||
  has_function_privilege('anon', 'public.registrar_devolucion_nucleo(text,text,text,text,text,text,text,text,jsonb,text)', 'EXECUTE')::TEXT || ' / ' ||
  has_function_privilege('authenticated', 'public.registrar_devolucion_nucleo(text,text,text,text,text,text,text,text,jsonb,text)', 'EXECUTE')::TEXT || ' / ' ||
  has_function_privilege('service_role', 'public.registrar_devolucion_nucleo(text,text,text,text,text,text,text,text,jsonb,text)', 'EXECUTE')::TEXT
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'registrar_devolucion_nucleo';

INSERT INTO _r SELECT 3, 'cobros: una sola firma de 7 / EXECUTE anon / authenticated / service_role',
  '1 / 7 / false / false / true',
  COUNT(*)::TEXT || ' / ' || COALESCE(MAX(p.pronargs)::TEXT, '-') || ' / ' ||
  has_function_privilege('anon', 'public.registrar_pagos_venta_atomica(text,text,text,text,text,jsonb,text)', 'EXECUTE')::TEXT || ' / ' ||
  has_function_privilege('authenticated', 'public.registrar_pagos_venta_atomica(text,text,text,text,text,jsonb,text)', 'EXECUTE')::TEXT || ' / ' ||
  has_function_privilege('service_role', 'public.registrar_pagos_venta_atomica(text,text,text,text,text,jsonb,text)', 'EXECUTE')::TEXT
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'registrar_pagos_venta_atomica';

INSERT INTO _r SELECT 4, 'vistas: security_invoker (comisiones / drift) y SELECT de anon / authenticated',
  'true / true / false / false / false / false',
  (SELECT COALESCE('security_invoker=true' = ANY(reloptions), false) FROM pg_class WHERE oid = 'public.v_comisiones_ventas'::regclass)::TEXT || ' / ' ||
  (SELECT COALESCE('security_invoker=true' = ANY(reloptions), false) FROM pg_class WHERE oid = 'public.v_cc_drift'::regclass)::TEXT || ' / ' ||
  has_table_privilege('anon', 'public.v_comisiones_ventas', 'SELECT')::TEXT || ' / ' ||
  has_table_privilege('authenticated', 'public.v_comisiones_ventas', 'SELECT')::TEXT || ' / ' ||
  has_table_privilege('anon', 'public.v_cc_drift', 'SELECT')::TEXT || ' / ' ||
  has_table_privilege('authenticated', 'public.v_cc_drift', 'SELECT')::TEXT;

-- ── El nucleo registra las series ──────────────────────────────────────────
-- 5 y 6. Venta 1: vuelven los dos celulares al stock. La linea guarda S1 y S2
-- con su estado anterior; S3 (disponible, de nadie) no se toca.
INSERT INTO _nc SELECT 'v1', pg_temp.nc_items('vta-probe-368-1',
  '[{"itemVentaId":"iv-probe-368-1","cantidad":2,"restaurarStock":true}]', 'EFECTIVO', 'k-368-1');
INSERT INTO _r SELECT 5, 'series que guardo la NC por productos (estado anterior)',
  'ser-probe-368-1:GARANTIA_ACTIVA:cli-probe-368:2026-12-30 ser-probe-368-2:GARANTIA_ACTIVA:cli-probe-368:2026-12-30',
  pg_temp.series_de((SELECT res->>'id' FROM _nc WHERE clave = 'v1'));

INSERT INTO _r SELECT 6, 'el resto de la 330 sigue igual: S1 / S2 / S3 / stock S / Norte / garantia',
  'DISPONIBLE / DISPONIBLE / DISPONIBLE / 7 / 5 / ANULADA',
  (SELECT estado FROM inventario_series WHERE id = 'ser-probe-368-1') || ' / ' ||
  (SELECT estado FROM inventario_series WHERE id = 'ser-probe-368-2') || ' / ' ||
  (SELECT estado FROM inventario_series WHERE id = 'ser-probe-368-3') || ' / ' ||
  (SELECT stock::TEXT FROM inventario WHERE id = 'inv-probe-368-s') || ' / ' ||
  (SELECT stock::TEXT FROM inventario_depositos WHERE inventario_id = 'inv-probe-368-s' AND deposito_id = 'dep-probe-368-n') || ' / ' ||
  (SELECT estado::TEXT FROM garantias_venta WHERE id = 'gar-probe-368-1');

-- 7. Ventana de deploy: la ruta anterior al PR3b llama con los 10 parametros
-- (sin motivo del catalogo y sin egreso en la RPC). Devolver sin reponer: la
-- serie queda DEVUELTO y la NC guarda que estaba VENDIDO, con la fecha del proveedor.
INSERT INTO _nc SELECT 'v5', registrar_devolucion_atomica(
  p_org_id => 'org-probe-368', p_venta_id => 'vta-probe-368-5', p_user_id => 'usr-probe-368',
  p_numero_devolucion => NULL, p_motivo => 'Probe 368 codigo anterior', p_observaciones => NULL,
  p_metodo_reembolso => 'EFECTIVO', p_reembolso_referencia => NULL,
  p_items => '[{"itemVentaId":"iv-probe-368-5","cantidad":1,"restaurarStock":false}]'::jsonb,
  p_idempotency_key => 'k-368-5');
INSERT INTO _r SELECT 7, 'codigo anterior: numero NC- / serie / lo que guardo / egresos de la RPC',
  'true / DEVUELTO / ser-probe-368-4:VENDIDO:cli-probe-368:2027-01-15 / 0',
  ((SELECT res->>'numero' FROM _nc WHERE clave = 'v5') LIKE 'NC-%')::TEXT || ' / ' ||
  (SELECT estado FROM inventario_series WHERE id = 'ser-probe-368-4') || ' / ' ||
  pg_temp.series_de((SELECT res->>'id' FROM _nc WHERE clave = 'v5')) || ' / ' ||
  (SELECT COUNT(*)::TEXT FROM movimientos_caja WHERE devolucion_id = (SELECT res->>'id' FROM _nc WHERE clave = 'v5'));

-- ── Las anuladas no cuentan en el nucleo ───────────────────────────────────
-- 8. Venta 2: una NC por monto de $100 (la agota) se anula; devolver las dos
-- fundas acredita $100 en TOTAL (sin el filtro: tope en 0, CHECK monto > 0).
INSERT INTO _nc SELECT 'v2-monto', pg_temp.nc_monto('vta-probe-368-2', 100, 'TRANSFERENCIA', 'k-368-2a');
UPDATE devoluciones_venta SET anulada = true WHERE id = (SELECT res->>'id' FROM _nc WHERE clave = 'v2-monto');
INSERT INTO _nc SELECT 'v2-items', pg_temp.nc_items('vta-probe-368-2',
  '[{"itemVentaId":"iv-probe-368-2","cantidad":2,"restaurarStock":false}]', 'TRANSFERENCIA', 'k-368-2b');
INSERT INTO _r SELECT 8, 'tope y TOTAL ignoran la NC anulada: tipo / acredita', 'TOTAL / 100.00',
  (res->>'tipo') || ' / ' || (res->>'montoDevolucion')::NUMERIC(12,2)::TEXT
  FROM _nc WHERE clave = 'v2-items';

-- 9. Venta 3 (fiada): devolver las dos fundas baja la deuda entera; esa NC se
-- anula y se vuelven a devolver las dos. Ya devuelto por linea, tope y lo que
-- ya bajo la deuda ignoran la anulada: otra vez $100 a la deuda, sin reintegro
-- (y sin pedir medio: lo mismo que calcula saldoPendienteVenta).
INSERT INTO _nc SELECT 'v3a', pg_temp.nc_items('vta-probe-368-3',
  '[{"itemVentaId":"iv-probe-368-3","cantidad":2,"restaurarStock":false}]', NULL, 'k-368-3a');
UPDATE devoluciones_venta SET anulada = true WHERE id = (SELECT res->>'id' FROM _nc WHERE clave = 'v3a');
INSERT INTO _r SELECT 9, 'pendiente sin la anulada (como la app) antes de la segunda NC', '100.00',
  (v.total - v.monto_abonado - COALESCE((SELECT SUM(monto_aplicado_deuda) FROM devoluciones_venta
                                          WHERE venta_id = v.id AND anulada = false), 0))::TEXT
  FROM ventas v WHERE v.id = 'vta-probe-368-3';
INSERT INTO _nc SELECT 'v3b', pg_temp.nc_items('vta-probe-368-3',
  '[{"itemVentaId":"iv-probe-368-3","cantidad":2,"restaurarStock":false}]', NULL, 'k-368-3b');
INSERT INTO _r SELECT 10, 'segunda NC sobre la fiada: tipo / acredita / baja deuda / reintegra',
  'TOTAL / 100.00 / 100.00 / 0.00',
  (res->>'tipo') || ' / ' || (res->>'montoDevolucion')::NUMERIC(12,2)::TEXT || ' / ' ||
  (res->>'montoAplicadoDeuda')::NUMERIC(12,2)::TEXT || ' / ' || (res->>'montoReembolso')::NUMERIC(12,2)::TEXT
  FROM _nc WHERE clave = 'v3b';

-- 11. Venta 4: devolver las dos lineas anula la garantia; esa NC se anula (y la
-- garantia vuelve, como hara la 369). Devolver una sola ya no la anula, y es
-- PARCIAL por $50 (si el TOTAL contara la anulada: TOTAL por $100).
INSERT INTO _nc SELECT 'v4a', pg_temp.nc_items('vta-probe-368-4',
  '[{"itemVentaId":"iv-probe-368-4","cantidad":2,"restaurarStock":false}]', 'TRANSFERENCIA', 'k-368-4a');
CREATE TEMP TABLE _gar4 AS SELECT estado::TEXT AS devuelta_entera FROM garantias_venta WHERE id = 'gar-probe-368-4';
UPDATE devoluciones_venta SET anulada = true WHERE id = (SELECT res->>'id' FROM _nc WHERE clave = 'v4a');
UPDATE garantias_venta SET estado = 'ACTIVA'::estado_garantia_venta WHERE id = 'gar-probe-368-4';
INSERT INTO _nc SELECT 'v4b', pg_temp.nc_items('vta-probe-368-4',
  '[{"itemVentaId":"iv-probe-368-4","cantidad":1,"restaurarStock":false}]', 'TRANSFERENCIA', 'k-368-4b');
INSERT INTO _r SELECT 11, 'garantia: devuelta entera / despues de anular esa NC y devolver una sola / tipo / acredita',
  'ANULADA / ACTIVA / PARCIAL / 50.00',
  (SELECT devuelta_entera FROM _gar4) || ' / ' ||
  (SELECT estado::TEXT FROM garantias_venta WHERE id = 'gar-probe-368-4') || ' / ' ||
  (SELECT (res->>'tipo') || ' / ' || (res->>'montoDevolucion')::NUMERIC(12,2)::TEXT FROM _nc WHERE clave = 'v4b');

-- ── Los demas lectores ─────────────────────────────────────────────────────
-- 12. Venta 6 (fiada): una NC de $40 bajo la deuda y se anula. Se pueden cobrar
-- los $100 (sin el filtro: "El monto total (100.00) excede el pendiente (60.00)").
INSERT INTO _nc SELECT 'v6', pg_temp.nc_monto('vta-probe-368-6', 40, NULL, 'k-368-6');
UPDATE devoluciones_venta SET anulada = true WHERE id = (SELECT res->>'id' FROM _nc WHERE clave = 'v6');
INSERT INTO _nc SELECT 'v6-cobro', registrar_pagos_venta_atomica(
  'org-probe-368', 'vta-probe-368-6', 'usr-probe-368', NULL, NULL,
  '[{"monto":100,"metodo":"EFECTIVO"}]'::jsonb, NULL);
INSERT INTO _r SELECT 12, 'cobro despues de anular: replayed / cobrado / estado_pago', 'false / 100.00 / PAGADO',
  (n.res->>'replayed') || ' / ' || v.monto_abonado::TEXT || ' / ' || v.estado_pago
  FROM _nc n, ventas v WHERE n.clave = 'v6-cobro' AND v.id = 'vta-probe-368-6';

-- 13. Venta 7: una NC repuso una funda y se anula (la 369 la vuelve a sacar:
-- aca a mano). Anular la venta devuelve las DOS fundas al stock.
INSERT INTO _nc SELECT 'v7', pg_temp.nc_items('vta-probe-368-7',
  '[{"itemVentaId":"iv-probe-368-7","cantidad":1,"restaurarStock":true}]', 'TRANSFERENCIA', 'k-368-7');
UPDATE devoluciones_venta SET anulada = true WHERE id = (SELECT res->>'id' FROM _nc WHERE clave = 'v7');
UPDATE inventario SET stock = stock - 1 WHERE id = 'inv-probe-368-p';
UPDATE inventario_depositos SET stock = stock - 1
WHERE inventario_id = 'inv-probe-368-p' AND deposito_id = get_deposito_principal('org-probe-368');
CREATE TEMP TABLE _stock7 AS SELECT stock FROM inventario WHERE id = 'inv-probe-368-p';
UPDATE ventas SET estado = 'ANULADA'::estado_venta WHERE id = 'vta-probe-368-7';
INSERT INTO _r SELECT 13, 'anular la venta repone lo vendido menos las NC activas', '2',
  ((SELECT stock FROM inventario WHERE id = 'inv-probe-368-p') - (SELECT stock FROM _stock7))::TEXT;

-- 14. Comision: en la venta 2 solo cuenta la NC por productos ($100); la de
-- monto anulada no.
INSERT INTO _r SELECT 14, 'v_comisiones_ventas: devuelto de la venta 2', '100.00',
  monto_devuelto::TEXT FROM v_comisiones_ventas WHERE venta_id = 'vta-probe-368-2';

-- 15. Reconciliacion: venta 8, una NC de $20 a saldo a favor, anulada. Aunque
-- falte su movimiento DEVOLUCION, no se marca como credito sin aplicar.
INSERT INTO _nc SELECT 'v8', pg_temp.nc_monto('vta-probe-368-8', 20, 'CUENTA_CORRIENTE', 'k-368-8');
UPDATE devoluciones_venta SET anulada = true WHERE id = (SELECT res->>'id' FROM _nc WHERE clave = 'v8');
DELETE FROM cuenta_corriente WHERE referencia_id = 'vta-probe-368-8' AND tipo::TEXT = 'DEVOLUCION';
INSERT INTO _r SELECT 15, 'v_cc_drift: la NC anulada no es un credito sin aplicar', '0',
  COUNT(*)::TEXT FROM v_cc_drift
  WHERE tipo_drift = 'DEVOLUCION_CC_SIN_CREDITO' AND referencia_id = 'vta-probe-368-8';

-- ── Purga de la organizacion ───────────────────────────────────────────────
-- 16 y 17. Con NC (anuladas y activas), series registradas, movimientos de
-- stock y de caja, cuenta corriente y una venta anulada: no se traba.
DO $$
DECLARE v_msg TEXT := 'OK';
BEGIN
  BEGIN
    DELETE FROM organizations WHERE id = 'org-probe-368';
  EXCEPTION WHEN OTHERS THEN
    v_msg := 'FALLO: ' || SQLERRM;
  END;
  INSERT INTO _r VALUES (16, 'borrar la org con NC, series y movimientos no se traba', 'OK', v_msg);
END $$;

INSERT INTO _r SELECT 17, 'la cascada se llevo NC, lineas, movimientos de stock y series', '0 / 0 / 0 / 0',
  (SELECT COUNT(*)::TEXT FROM devoluciones_venta WHERE organization_id = 'org-probe-368') || ' / ' ||
  (SELECT COUNT(*)::TEXT FROM items_devolucion WHERE item_venta_id LIKE 'iv-probe-368-%') || ' / ' ||
  (SELECT COUNT(*)::TEXT FROM movimientos_inventario WHERE organization_id = 'org-probe-368') || ' / ' ||
  (SELECT COUNT(*)::TEXT FROM inventario_series WHERE organization_id = 'org-probe-368');

SELECT orden, probe, esperado, obtenido,
       CASE WHEN obtenido LIKE 'SALTEADO%' THEN 'SALTEADO'
            WHEN esperado = obtenido THEN 'OK'
            ELSE 'FALLA' END AS resultado
  FROM _r ORDER BY orden;

ROLLBACK;
