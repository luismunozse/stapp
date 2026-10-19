-- Probes de la 369. Abren su propia transaccion y la revierten: db-run.mjs
-- detecta el BEGIN y rechaza --apply. Correr DESPUES de aplicar la 369 (y la 368):
--   npm run db:dry -- supabase/migrations/verify/369_probes.sql
-- (o en el editor SQL de Supabase; ver "Pasos manuales" del plan del PR4).
-- Contra una base sin la 369 cortan en el primer anular_devolucion_venta.
--
-- El invariante del spec: emitir una NC y despues anularla deja stock por
-- deposito, series, garantias, caja, cuenta corriente, pendiente, estado_pago y
-- comision exactamente como estaban (probes 2 y 10: foto antes = foto despues).
--
-- Fixture propia (org-probe-369, y org-probe-369-x como taller ajeno). La
-- sucursal y el deposito principales los crea el alta de la org (217/221); se
-- suman el deposito "Norte" en la principal y la sucursal B (con su propio
-- deposito, que crea el trigger de la 221).
-- Las NC se emiten con registrar_devolucion_atomica, como la ruta del PR3.
-- Los literales que van a columnas enum llevan su cast.
BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);
CREATE TEMP TABLE _nc (clave TEXT PRIMARY KEY, res JSONB);
CREATE TEMP TABLE _foto (clave TEXT PRIMARY KEY, foto JSONB);

INSERT INTO organizations (id, nombre, nombre_mostrar, slug)
VALUES ('org-probe-369', 'Probe 369', 'Probe 369', 'probe-369-' || substr(md5(random()::text), 1, 8)),
       ('org-probe-369-x', 'Probe 369 X', 'Probe 369 X', 'probe-369-x-' || substr(md5(random()::text), 1, 8));

INSERT INTO users (id, organization_id, sucursal_id, email, nombre, password, rol)
VALUES ('usr-probe-369', 'org-probe-369',
        (SELECT id FROM sucursales WHERE organization_id = 'org-probe-369' AND principal),
        'admin@probe-369.invalid', 'Probe 369', 'x', 'ADMIN'),
       ('usr-probe-369-x', 'org-probe-369-x',
        (SELECT id FROM sucursales WHERE organization_id = 'org-probe-369-x' AND principal),
        'admin@probe-369-x.invalid', 'Probe 369 X', 'x', 'ADMIN');

INSERT INTO sucursales (id, organization_id, nombre, principal)
VALUES ('suc-probe-369-b', 'org-probe-369', 'Sucursal B probe 369', false);

INSERT INTO clientes (id, nombre, telefono, organization_id)
VALUES ('cli-probe-369', 'Cliente probe 369', '369-0001', 'org-probe-369');

INSERT INTO depositos (id, organization_id, sucursal_id, nombre, principal, activo)
VALUES ('dep-probe-369-n', 'org-probe-369',
        (SELECT id FROM sucursales WHERE organization_id = 'org-probe-369' AND principal),
        'Norte probe 369', false, true);

-- S: con series (6: 2 en la principal, 4 en Norte). P: fundas, 10. D: 3.
INSERT INTO inventario (id, organization_id, codigo, nombre, categoria, precio_compra, precio_venta, stock, trackea_series)
VALUES ('inv-probe-369-s', 'org-probe-369', 'P369-S', 'Celular probe 369', 'Probe', 50, 100, 6, true),
       ('inv-probe-369-p', 'org-probe-369', 'P369-P', 'Funda probe 369', 'Probe', 10, 50, 10, false),
       ('inv-probe-369-d', 'org-probe-369', 'P369-D', 'Producto probe 369 D', 'Probe', 10, 50, 3, false);
UPDATE inventario_depositos SET stock = 2
WHERE inventario_id = 'inv-probe-369-s' AND deposito_id = get_deposito_principal('org-probe-369');
INSERT INTO inventario_depositos (inventario_id, deposito_id, stock, organization_id)
VALUES ('inv-probe-369-s', 'dep-probe-369-n', 4, 'org-probe-369');

-- A (1): dos celulares con 90 dias de garantia, pagada; salieron de Norte (series A1, A2)
-- B (2): $100 con $60 cobrados (el ejemplo del spec), con cliente
-- B2 (3): pagada, con cliente (saldo a favor que el cliente usa)
-- C (4): pagada, de mostrador (dos NC: LIFO)
-- D (5): un producto D, pagada (stock que ya no esta)
-- E (6): un celular sin garantia, pagada (serie que se revende)
-- F (7): pagada (venta anulada)
-- G (8): pagada (historial DEV-)
-- H (9): un celular sin garantia, pagada (NC anterior a la 368)
-- I (10) y J (11): pagadas (efectivo con egreso de la ruta vieja / sin egreso)
-- N (12): dos fundas, fiada, con cliente (la anulada no cuenta para la NC siguiente)
INSERT INTO ventas (id, numero_venta, cliente_id, cliente_nombre, vendedor_id, subtotal, total,
                    metodo_pago, estado, organization_id, sucursal_id, monto_abonado, estado_pago)
SELECT v.id, v.numero, v.cliente, 'Probe 369', 'usr-probe-369', v.total, v.total,
       'EFECTIVO'::metodo_pago_venta, 'COMPLETADA'::estado_venta, 'org-probe-369',
       (SELECT id FROM sucursales WHERE organization_id = 'org-probe-369' AND principal),
       v.abonado, v.estado_pago
FROM (VALUES
  ('vta-probe-369-a', 1, 'cli-probe-369', 200.00, 200.00, 'PAGADO'),
  ('vta-probe-369-b', 2, 'cli-probe-369', 100.00, 60.00, 'PAGADO_PARCIAL'),
  ('vta-probe-369-b2', 3, 'cli-probe-369', 100.00, 100.00, 'PAGADO'),
  ('vta-probe-369-c', 4, NULL, 100.00, 100.00, 'PAGADO'),
  ('vta-probe-369-d', 5, NULL, 50.00, 50.00, 'PAGADO'),
  ('vta-probe-369-e', 6, 'cli-probe-369', 100.00, 100.00, 'PAGADO'),
  ('vta-probe-369-f', 7, NULL, 100.00, 100.00, 'PAGADO'),
  ('vta-probe-369-g', 8, NULL, 100.00, 100.00, 'PAGADO'),
  ('vta-probe-369-h', 9, 'cli-probe-369', 100.00, 100.00, 'PAGADO'),
  ('vta-probe-369-i', 10, NULL, 100.00, 100.00, 'PAGADO'),
  ('vta-probe-369-j', 11, NULL, 100.00, 100.00, 'PAGADO'),
  ('vta-probe-369-n', 12, 'cli-probe-369', 100.00, 0.00, 'PENDIENTE')
) AS v(id, numero, cliente, total, abonado, estado_pago);

INSERT INTO ventas (id, numero_venta, cliente_id, cliente_nombre, vendedor_id, subtotal, total,
                    metodo_pago, estado, organization_id, sucursal_id, monto_abonado, estado_pago)
VALUES ('vta-probe-369-x', 1, NULL, 'Probe 369 X', 'usr-probe-369-x', 100, 100,
        'EFECTIVO'::metodo_pago_venta, 'COMPLETADA'::estado_venta, 'org-probe-369-x',
        (SELECT id FROM sucursales WHERE organization_id = 'org-probe-369-x' AND principal), 100, 'PAGADO');

INSERT INTO items_venta (id, venta_id, inventario_id, descripcion, cantidad, precio_unitario, subtotal, dias_garantia)
VALUES ('iv-probe-369-a', 'vta-probe-369-a', 'inv-probe-369-s', 'Celular probe 369', 2, 100, 200, 90),
       ('iv-probe-369-d', 'vta-probe-369-d', 'inv-probe-369-d', 'Producto probe 369 D', 1, 50, 50, 0),
       ('iv-probe-369-e', 'vta-probe-369-e', 'inv-probe-369-s', 'Celular probe 369', 1, 100, 100, 0),
       ('iv-probe-369-h', 'vta-probe-369-h', 'inv-probe-369-s', 'Celular probe 369', 1, 100, 100, 0),
       ('iv-probe-369-n', 'vta-probe-369-n', 'inv-probe-369-p', 'Funda probe 369', 2, 50, 100, 0);

-- A, E y H salieron de Norte; D de la principal.
INSERT INTO movimientos_inventario (inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
                                    referencia_id, referencia_tipo, organization_id, deposito_id)
VALUES ('inv-probe-369-s', 'VENTA', -2, 8, 6, 'vta-probe-369-a', 'VENTA', 'org-probe-369', 'dep-probe-369-n'),
       ('inv-probe-369-s', 'VENTA', -1, 7, 6, 'vta-probe-369-e', 'VENTA', 'org-probe-369', 'dep-probe-369-n'),
       ('inv-probe-369-s', 'VENTA', -1, 7, 6, 'vta-probe-369-h', 'VENTA', 'org-probe-369', 'dep-probe-369-n'),
       ('inv-probe-369-d', 'VENTA', -1, 4, 3, 'vta-probe-369-d', 'VENTA', 'org-probe-369',
        get_deposito_principal('org-probe-369'));

INSERT INTO inventario_series (id, inventario_id, numero_serie, estado, fecha_venta, fecha_garantia_vence,
                               venta_id, cliente_id, deposito_id, organization_id)
VALUES ('ser-probe-369-a1', 'inv-probe-369-s', 'IMEI-369-A1', 'GARANTIA_ACTIVA', '2026-10-01 12:00:00+00', '2026-12-30',
        'vta-probe-369-a', 'cli-probe-369', 'dep-probe-369-n', 'org-probe-369'),
       ('ser-probe-369-a2', 'inv-probe-369-s', 'IMEI-369-A2', 'GARANTIA_ACTIVA', '2026-10-01 12:00:00+00', '2026-12-30',
        'vta-probe-369-a', 'cli-probe-369', 'dep-probe-369-n', 'org-probe-369'),
       ('ser-probe-369-a3', 'inv-probe-369-s', 'IMEI-369-A3', 'DISPONIBLE', NULL, NULL,
        NULL, NULL, 'dep-probe-369-n', 'org-probe-369'),
       ('ser-probe-369-e1', 'inv-probe-369-s', 'IMEI-369-E1', 'VENDIDO', '2026-10-03 09:00:00+00', '2027-02-01',
        'vta-probe-369-e', 'cli-probe-369', 'dep-probe-369-n', 'org-probe-369'),
       ('ser-probe-369-h1', 'inv-probe-369-s', 'IMEI-369-H1', 'VENDIDO', '2026-10-04 09:00:00+00', NULL,
        'vta-probe-369-h', 'cli-probe-369', 'dep-probe-369-n', 'org-probe-369');

INSERT INTO garantias_venta (id, venta_id, item_venta_id, numero_garantia, dias_validez, fecha_vencimiento, estado, organization_id)
VALUES ('gar-probe-369-a', 'vta-probe-369-a', 'iv-probe-369-a', 'GAR-P369-A', 90, now() + interval '90 days',
        'ACTIVA'::estado_garantia_venta, 'org-probe-369');

-- Caja abierta en la principal (la de A); la cierra el probe 20.
INSERT INTO sesiones_caja (id, organization_id, usuario_apertura_id, sucursal_id, estado)
VALUES ('ses-probe-369-a', 'org-probe-369', 'usr-probe-369',
        (SELECT id FROM sucursales WHERE organization_id = 'org-probe-369' AND principal), 'ABIERTA');

-- Atajos: NC como la manda la ruta del PR3; anular como la ruta del PR4; error de una sentencia.
CREATE FUNCTION pg_temp.nc_items(p_venta TEXT, p_items JSONB, p_metodo TEXT, p_key TEXT)
RETURNS JSONB LANGUAGE sql AS $$
  SELECT registrar_devolucion_atomica(
    p_org_id => 'org-probe-369', p_venta_id => p_venta, p_user_id => 'usr-probe-369',
    p_numero_devolucion => NULL, p_motivo => 'Probe 369', p_observaciones => NULL,
    p_metodo_reembolso => p_metodo, p_reembolso_referencia => NULL, p_items => p_items,
    p_idempotency_key => p_key, p_modo => 'ITEMS', p_monto => NULL,
    p_motivo_nc => 'DEVOLUCION', p_registrar_egreso => true)
$$;

CREATE FUNCTION pg_temp.nc_monto(p_venta TEXT, p_monto NUMERIC, p_metodo TEXT, p_key TEXT, p_egreso BOOLEAN DEFAULT true)
RETURNS JSONB LANGUAGE sql AS $$
  SELECT registrar_devolucion_atomica(
    p_org_id => 'org-probe-369', p_venta_id => p_venta, p_user_id => 'usr-probe-369',
    p_numero_devolucion => NULL, p_motivo => 'Probe 369', p_observaciones => NULL,
    p_metodo_reembolso => p_metodo, p_reembolso_referencia => NULL, p_items => '[]'::jsonb,
    p_idempotency_key => p_key, p_modo => 'MONTO', p_monto => p_monto,
    p_motivo_nc => 'AJUSTE_PRECIO', p_registrar_egreso => p_egreso)
$$;

CREATE FUNCTION pg_temp.anular(p_venta TEXT, p_clave TEXT, p_motivo TEXT DEFAULT 'Se cargo por error')
RETURNS JSONB LANGUAGE sql AS $$
  SELECT anular_devolucion_venta('org-probe-369', p_venta, (SELECT res->>'id' FROM _nc WHERE clave = p_clave),
                                 'usr-probe-369', p_motivo)
$$;

CREATE FUNCTION pg_temp.error_de(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'sin error';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;

-- Todo lo que una NC toca, de una venta y del taller.
CREATE FUNCTION pg_temp.foto(p_venta TEXT) RETURNS JSONB LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'stock', (SELECT jsonb_object_agg(id, stock) FROM inventario WHERE organization_id = 'org-probe-369'),
    'depositos', (SELECT jsonb_object_agg(inventario_id || '@' || deposito_id, stock)
                    FROM inventario_depositos WHERE organization_id = 'org-probe-369'),
    'series', (SELECT jsonb_object_agg(id, jsonb_build_array(estado, venta_id, cliente_id, fecha_venta, fecha_garantia_vence))
                 FROM inventario_series WHERE organization_id = 'org-probe-369'),
    'garantias', (SELECT COALESCE(jsonb_object_agg(id, estado), '{}'::jsonb) FROM garantias_venta WHERE venta_id = p_venta),
    'estado_pago', (SELECT estado_pago FROM ventas WHERE id = p_venta),
    'pendiente', (SELECT v.total - COALESCE(v.monto_abonado, 0)
                         - COALESCE((SELECT SUM(d.monto_aplicado_deuda) FROM devoluciones_venta d
                                      WHERE d.venta_id = v.id AND d.anulada = false), 0)
                    FROM ventas v WHERE v.id = p_venta),
    'saldo_cliente', (SELECT saldo_cuenta FROM clientes WHERE id = 'cli-probe-369'),
    'cuenta_corriente_venta', (SELECT COALESCE(SUM(monto), 0) FROM cuenta_corriente
                                WHERE referencia_tipo = 'VENTA' AND referencia_id = p_venta),
    'caja', (SELECT COALESCE(SUM(CASE WHEN tipo = 'INGRESO' THEN monto ELSE -monto END), 0)
               FROM movimientos_caja WHERE organization_id = 'org-probe-369'),
    'comision_devuelto', (SELECT monto_devuelto FROM v_comisiones_ventas WHERE venta_id = p_venta),
    'nc_activas', (SELECT COUNT(*) FROM devoluciones_venta WHERE venta_id = p_venta AND anulada = false))
$$;

-- ── Permisos ───────────────────────────────────────────────────────────────
INSERT INTO _r SELECT 1, 'anular_devolucion_venta: una sola firma de 5 / EXECUTE anon / authenticated / service_role',
  '1 / 5 / false / false / true',
  COUNT(*)::TEXT || ' / ' || COALESCE(MAX(p.pronargs)::TEXT, '-') || ' / ' ||
  has_function_privilege('anon', 'public.anular_devolucion_venta(text,text,text,text,text)', 'EXECUTE')::TEXT || ' / ' ||
  has_function_privilege('authenticated', 'public.anular_devolucion_venta(text,text,text,text,text)', 'EXECUTE')::TEXT || ' / ' ||
  has_function_privilege('service_role', 'public.anular_devolucion_venta(text,text,text,text,text)', 'EXECUTE')::TEXT
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'anular_devolucion_venta';

-- ── Emitir + anular = identidad: productos con series, en efectivo ─────────
-- 2 a 9. Venta A: vuelven los dos celulares a Norte y se le devuelven $200 en
-- efectivo desde la caja abierta. Anular deja todo como estaba.
INSERT INTO _foto SELECT 'a0', pg_temp.foto('vta-probe-369-a');
INSERT INTO _nc SELECT 'a', pg_temp.nc_items('vta-probe-369-a',
  '[{"itemVentaId":"iv-probe-369-a","cantidad":2,"restaurarStock":true}]', 'EFECTIVO', 'k-369-a');
INSERT INTO _foto SELECT 'a1', pg_temp.foto('vta-probe-369-a');
INSERT INTO _nc SELECT 'a-anulada', pg_temp.anular('vta-probe-369-a', 'a');
INSERT INTO _foto SELECT 'a2', pg_temp.foto('vta-probe-369-a');

INSERT INTO _r SELECT 2, 'A: emitir + anular = identidad (stock por deposito, series, garantia, caja, comision, pendiente)',
  'true', ((SELECT foto FROM _foto WHERE clave = 'a0') = (SELECT foto FROM _foto WHERE clave = 'a2'))::TEXT;

INSERT INTO _r SELECT 3, 'A: la NC si habia cambiado todo eso', 'true',
  ((SELECT foto FROM _foto WHERE clave = 'a0') <> (SELECT foto FROM _foto WHERE clave = 'a1'))::TEXT;

INSERT INTO _r SELECT 4, 'A: replayed / unidades / series / garantias / cuenta corriente / efectivo sin egreso',
  'false / 2 / 2 / 1 / 0 / false',
  (res->>'replayed') || ' / ' || (res->>'unidadesDescontadas') || ' / ' || (res->>'seriesRestauradas') || ' / ' ||
  (res->>'garantiasReactivadas') || ' / ' || (res->>'cargoCuentaCorriente') || ' / ' || (res->>'efectivoSinEgreso')
  FROM _nc WHERE clave = 'a-anulada';

INSERT INTO _r SELECT 5, 'A: el ingreso vuelve a la misma caja: monto / sesion / origen / afecta / concepto / enlazado / id devuelto',
  '200.00 / ses-probe-369-a / DEVOLUCION / false / true / true / true',
  m.monto::TEXT || ' / ' || COALESCE(m.sesion_caja_id, 'sin sesion') || ' / ' || m.origen || ' / ' ||
  m.afecta_rentabilidad::TEXT || ' / ' ||
  (m.concepto = 'Anulación de nota de crédito ' || (SELECT res->>'numero' FROM _nc WHERE clave = 'a') || ' - Venta V0001')::TEXT || ' / ' ||
  (m.devolucion_id = (SELECT res->>'id' FROM _nc WHERE clave = 'a'))::TEXT || ' / ' ||
  (m.id = (SELECT res->>'movimientoCajaId' FROM _nc WHERE clave = 'a-anulada'))::TEXT
  FROM movimientos_caja m
  WHERE m.devolucion_id = (SELECT res->>'id' FROM _nc WHERE clave = 'a') AND m.tipo = 'INGRESO';

INSERT INTO _r SELECT 6, 'A: movimiento de stock: tipo / cantidad / deposito / series / referencia',
  'ANULACION / -2 / dep-probe-369-n / {ser-probe-369-a1,ser-probe-369-a2} / ANULACION_DEVOLUCION_VENTA',
  m.tipo || ' / ' || m.cantidad::TEXT || ' / ' || m.deposito_id || ' / ' ||
  (SELECT array_agg(x ORDER BY x) FROM unnest(m.serie_ids) x)::TEXT || ' / ' || m.referencia_tipo
  FROM movimientos_inventario m
  WHERE m.referencia_id = (SELECT res->>'id' FROM _nc WHERE clave = 'a') AND m.tipo = 'ANULACION';

INSERT INTO _r SELECT 7, 'A: la NC queda anulada y visible: anulada / motivo / por / fecha / en el listado',
  'true / Se cargo por error / usr-probe-369 / true / true',
  dv.anulada::TEXT || ' / ' || dv.anulada_motivo || ' / ' || dv.anulada_por || ' / ' ||
  (dv.anulada_at IS NOT NULL)::TEXT || ' / ' ||
  (SELECT v.anulada FROM v_notas_credito v WHERE v.id = dv.id)::TEXT
  FROM devoluciones_venta dv WHERE dv.id = (SELECT res->>'id' FROM _nc WHERE clave = 'a');

-- 8. Doble click: anular otra vez devuelve lo hecho, sin otra reversa.
INSERT INTO _nc SELECT 'a-otra-vez', pg_temp.anular('vta-probe-369-a', 'a');
INSERT INTO _r SELECT 8, 'reintento: replayed / mismo ingreso / ingresos / movimientos ANULACION / foto igual',
  'true / true / 1 / 1 / true',
  (b.res->>'replayed') || ' / ' ||
  ((b.res->>'movimientoCajaId') = (a.res->>'movimientoCajaId'))::TEXT || ' / ' ||
  (SELECT COUNT(*)::TEXT FROM movimientos_caja
    WHERE devolucion_id = (SELECT res->>'id' FROM _nc WHERE clave = 'a') AND tipo = 'INGRESO') || ' / ' ||
  (SELECT COUNT(*)::TEXT FROM movimientos_inventario
    WHERE referencia_id = (SELECT res->>'id' FROM _nc WHERE clave = 'a') AND tipo = 'ANULACION') || ' / ' ||
  ((SELECT foto FROM _foto WHERE clave = 'a0') = pg_temp.foto('vta-probe-369-a'))::TEXT
  FROM _nc a, _nc b WHERE a.clave = 'a-anulada' AND b.clave = 'a-otra-vez';

-- 9. Despues, anular la venta (334) repone las dos unidades en Norte y libera
-- las series, como si la NC no hubiera existido.
UPDATE ventas SET estado = 'ANULADA'::estado_venta WHERE id = 'vta-probe-369-a';
INSERT INTO _r SELECT 9, 'anular la venta A despues: Norte / A1 / A2 / garantia', '6 / DISPONIBLE / DISPONIBLE / ANULADA',
  (SELECT stock::TEXT FROM inventario_depositos WHERE inventario_id = 'inv-probe-369-s' AND deposito_id = 'dep-probe-369-n') || ' / ' ||
  (SELECT estado FROM inventario_series WHERE id = 'ser-probe-369-a1') || ' / ' ||
  (SELECT estado FROM inventario_series WHERE id = 'ser-probe-369-a2') || ' / ' ||
  (SELECT estado::TEXT FROM garantias_venta WHERE id = 'gar-probe-369-a');

-- ── Emitir + anular = identidad: por monto, deuda y saldo a favor ──────────
-- 10 y 11. Venta B (el ejemplo del spec): $100, $60 cobrados. NC de $50: $40
-- bajan la deuda y $10 quedan a favor en cuenta corriente.
INSERT INTO _foto SELECT 'b0', pg_temp.foto('vta-probe-369-b');
INSERT INTO _nc SELECT 'b', pg_temp.nc_monto('vta-probe-369-b', 50, 'CUENTA_CORRIENTE', 'k-369-b');
INSERT INTO _nc SELECT 'b-anulada', pg_temp.anular('vta-probe-369-b', 'b');
INSERT INTO _r SELECT 10, 'B: emitir + anular = identidad (pendiente, estado_pago, saldo del cliente, cuenta corriente)',
  'true', ((SELECT foto FROM _foto WHERE clave = 'b0') = pg_temp.foto('vta-probe-369-b'))::TEXT;

INSERT INTO _r SELECT 11, 'B: un CARGO por cada credito, con referencia a la venta y el numero de la NC',
  'CARGO:-40.00:true CARGO:-10.00:true',
  string_agg(tipo || ':' || monto::TEXT || ':' ||
             (observaciones LIKE 'Anulación de la nota de crédito ' || (SELECT res->>'numero' FROM _nc WHERE clave = 'b') || ' (%')::TEXT,
             ' ' ORDER BY monto)
  FROM cuenta_corriente
  WHERE referencia_tipo = 'VENTA' AND referencia_id = 'vta-probe-369-b' AND tipo::TEXT = 'CARGO';

-- 12. Venta B2: NC de $30 a favor; el cliente usa $20; al anular queda debiendo $20.
INSERT INTO _nc SELECT 'b2', pg_temp.nc_monto('vta-probe-369-b2', 30, 'CUENTA_CORRIENTE', 'k-369-b2');
INSERT INTO _nc SELECT 'uso', usar_cuenta_corriente('org-probe-369', 'cli-probe-369', 20, 'VENTA', 'vta-probe-369-c', 'usr-probe-369',
  (SELECT id FROM sucursales WHERE organization_id = 'org-probe-369' AND principal));
INSERT INTO _nc SELECT 'b2-anulada', pg_temp.anular('vta-probe-369-b2', 'b2');
INSERT INTO _r SELECT 12, 'B2: el cliente ya uso $20 del saldo a favor: queda debiendo $20 (sin bloquear)', '-20.00',
  (SELECT saldo_cuenta::TEXT FROM clientes WHERE id = 'cli-probe-369');

-- ── LIFO ───────────────────────────────────────────────────────────────────
-- 13 y 14. Venta C: dos NC por monto. La primera no se anula mientras la segunda
-- este activa; en orden inverso, las dos.
INSERT INTO _nc SELECT 'c1', pg_temp.nc_monto('vta-probe-369-c', 10, 'TRANSFERENCIA', 'k-369-c1');
INSERT INTO _nc SELECT 'c2', pg_temp.nc_monto('vta-probe-369-c', 10, 'TRANSFERENCIA', 'k-369-c2');
INSERT INTO _r SELECT 13, 'LIFO: anular la primera con la segunda activa',
  'Solo se puede anular la nota de crédito más reciente de la venta: primero anulá la ' ||
    (SELECT res->>'numero' FROM _nc WHERE clave = 'c2'),
  pg_temp.error_de($q$SELECT pg_temp.anular('vta-probe-369-c', 'c1')$q$);
INSERT INTO _nc SELECT 'c2-anulada', pg_temp.anular('vta-probe-369-c', 'c2');
INSERT INTO _nc SELECT 'c1-anulada', pg_temp.anular('vta-probe-369-c', 'c1');
INSERT INTO _r SELECT 14, 'LIFO: en orden inverso se anulan las dos', 'true / true',
  (SELECT anulada::TEXT FROM devoluciones_venta WHERE id = (SELECT res->>'id' FROM _nc WHERE clave = 'c2')) || ' / ' ||
  (SELECT anulada::TEXT FROM devoluciones_venta WHERE id = (SELECT res->>'id' FROM _nc WHERE clave = 'c1'));

-- ── Bloqueos: nada cambia ──────────────────────────────────────────────────
-- 15. Venta D: la NC repuso una unidad en la principal y despues se vendio
-- todo: no hay de donde volver a descontarla.
INSERT INTO _nc SELECT 'd', pg_temp.nc_items('vta-probe-369-d',
  '[{"itemVentaId":"iv-probe-369-d","cantidad":1,"restaurarStock":true}]', 'TRANSFERENCIA', 'k-369-d');
UPDATE inventario SET stock = 0 WHERE id = 'inv-probe-369-d';
UPDATE inventario_depositos SET stock = 0 WHERE inventario_id = 'inv-probe-369-d';
INSERT INTO _r SELECT 15, 'sin stock para volver a descontar: mensaje / la NC sigue activa', 'true / false',
  (pg_temp.error_de($q$SELECT pg_temp.anular('vta-probe-369-d', 'd')$q$)
     LIKE 'No hay stock de "Producto probe 369 D" en % para volver a descontar lo que devolvió la nota de crédito: hay 0, hacen falta 1')::TEXT
  || ' / ' || (SELECT anulada::TEXT FROM devoluciones_venta WHERE id = (SELECT res->>'id' FROM _nc WHERE clave = 'd'));

-- 16. Venta E: la serie que la NC devolvio al stock se volvio a vender.
INSERT INTO _nc SELECT 'e', pg_temp.nc_items('vta-probe-369-e',
  '[{"itemVentaId":"iv-probe-369-e","cantidad":1,"restaurarStock":true}]', 'TRANSFERENCIA', 'k-369-e');
UPDATE inventario_series SET estado = 'VENDIDO', venta_id = 'vta-probe-369-f', fecha_venta = now()
WHERE id = 'ser-probe-369-e1';
INSERT INTO _r SELECT 16, 'serie revendida: mensaje / la NC sigue activa / el stock no se toco', 'true / false / true',
  (pg_temp.error_de($q$SELECT pg_temp.anular('vta-probe-369-e', 'e')$q$)
     LIKE 'La serie IMEI-369-E1 ya no está como la dejó la nota de crédito%')::TEXT || ' / ' ||
  (SELECT anulada::TEXT FROM devoluciones_venta WHERE id = (SELECT res->>'id' FROM _nc WHERE clave = 'e')) || ' / ' ||
  ((SELECT COUNT(*) FROM movimientos_inventario
     WHERE referencia_id = (SELECT res->>'id' FROM _nc WHERE clave = 'e') AND tipo = 'ANULACION') = 0)::TEXT;

-- 17. Venta F: NC por monto y despues se anula la venta.
INSERT INTO _nc SELECT 'f', pg_temp.nc_monto('vta-probe-369-f', 10, 'TRANSFERENCIA', 'k-369-f');
UPDATE ventas SET estado = 'ANULADA'::estado_venta WHERE id = 'vta-probe-369-f';
INSERT INTO _r SELECT 17, 'venta anulada', 'La venta está anulada: sus notas de crédito ya no se pueden anular',
  pg_temp.error_de($q$SELECT pg_temp.anular('vta-probe-369-f', 'f')$q$);

-- 18. Venta G: una devolucion del historial (DEV-, reglas anteriores a la 330).
INSERT INTO devoluciones_venta (id, venta_id, numero_devolucion, motivo, tipo, monto_devolucion, estado, organization_id)
VALUES ('dev-probe-369-g', 'vta-probe-369-g', 'DEV-P369', 'Historial', 'PARCIAL', 10, 'COMPLETADA', 'org-probe-369');
INSERT INTO _nc VALUES ('g', '{"id":"dev-probe-369-g"}');
INSERT INTO _r SELECT 18, 'historial DEV-', 'Las devoluciones anteriores a las notas de crédito (DEV-) no se pueden anular',
  pg_temp.error_de($q$SELECT pg_temp.anular('vta-probe-369-g', 'g')$q$);

-- 19. Venta H: NC por productos con serie, emitida "antes de la 368" (sin registro).
INSERT INTO _nc SELECT 'h', pg_temp.nc_items('vta-probe-369-h',
  '[{"itemVentaId":"iv-probe-369-h","cantidad":1,"restaurarStock":true}]', 'TRANSFERENCIA', 'k-369-h');
UPDATE items_devolucion SET series_devueltas = NULL WHERE devolucion_id = (SELECT res->>'id' FROM _nc WHERE clave = 'h');
INSERT INTO _r SELECT 19, 'NC con series anterior a la 368',
  'La nota de crédito devolvió "Celular probe 369" antes de que el sistema guardara qué números de serie volvían: no se puede anular',
  pg_temp.error_de($q$SELECT pg_temp.anular('vta-probe-369-h', 'h')$q$);

-- 20. Sin motivo (sobre la NC de H, que igual no se podria anular: el motivo va primero).
INSERT INTO _r SELECT 20, 'motivo vacio', 'El motivo de la anulación es obligatorio',
  pg_temp.error_de($q$SELECT pg_temp.anular('vta-probe-369-h', 'h', '   ')$q$);

-- 21. Otro taller y otra venta.
INSERT INTO _r SELECT 21, 'venta de otro taller / NC de otra venta', 'Venta no encontrada / Nota de crédito no encontrada',
  pg_temp.error_de($q$SELECT anular_devolucion_venta('org-probe-369', 'vta-probe-369-x', 'cualquiera', 'usr-probe-369', 'x')$q$)
  || ' / ' ||
  pg_temp.error_de($q$SELECT pg_temp.anular('vta-probe-369-b2', 'c1')$q$);

-- ── Caja: NC sin egreso enlazado ───────────────────────────────────────────
-- Se cierra la caja de la principal y se abre la de B: el ingreso nunca va a la
-- caja de otra sucursal.
UPDATE sesiones_caja SET estado = 'CERRADA' WHERE id = 'ses-probe-369-a';
INSERT INTO sesiones_caja (id, organization_id, usuario_apertura_id, sucursal_id, estado)
VALUES ('ses-probe-369-b', 'org-probe-369', 'usr-probe-369', 'suc-probe-369-b', 'ABIERTA');

-- 22 y 23. Venta I: la ruta anterior al PR3b grabo el egreso sin enlace. Anular
-- lo encuentra por su concepto, lo enlaza y lo revierte.
INSERT INTO _nc SELECT 'i', pg_temp.nc_monto('vta-probe-369-i', 30, 'EFECTIVO', 'k-369-i', false);
INSERT INTO movimientos_caja (organization_id, tipo, monto, metodo_pago, concepto, observaciones, usuario_id,
                              afecta_rentabilidad, sucursal_id, origen)
VALUES ('org-probe-369', 'EGRESO', 30, 'EFECTIVO', 'Devolución ' || (SELECT res->>'numero' FROM _nc WHERE clave = 'i'),
        'Reembolso en efectivo de devolución de venta', 'usr-probe-369', false,
        (SELECT id FROM sucursales WHERE organization_id = 'org-probe-369' AND principal), 'DEVOLUCION');
INSERT INTO _nc SELECT 'i-anulada', pg_temp.anular('vta-probe-369-i', 'i');
INSERT INTO _r SELECT 22, 'egreso viejo: queda enlazado / ingreso / sin egreso', 'true / 30.00 / false',
  ((SELECT devolucion_id FROM movimientos_caja
     WHERE concepto = 'Devolución ' || (SELECT res->>'numero' FROM _nc WHERE clave = 'i') AND tipo = 'EGRESO')
    = (SELECT res->>'id' FROM _nc WHERE clave = 'i'))::TEXT || ' / ' ||
  (SELECT monto::TEXT FROM movimientos_caja
     WHERE devolucion_id = (SELECT res->>'id' FROM _nc WHERE clave = 'i') AND tipo = 'INGRESO') || ' / ' ||
  (SELECT res->>'efectivoSinEgreso' FROM _nc WHERE clave = 'i-anulada');
INSERT INTO _r SELECT 23, 'el ingreso no va a la caja de otra sucursal: sesion / sucursal de la venta', 'sin sesion / true',
  COALESCE(m.sesion_caja_id, 'sin sesion') || ' / ' ||
  (m.sucursal_id = (SELECT sucursal_id FROM ventas WHERE id = 'vta-probe-369-i'))::TEXT
  FROM movimientos_caja m
  WHERE m.devolucion_id = (SELECT res->>'id' FROM _nc WHERE clave = 'i') AND m.tipo = 'INGRESO';

-- 24. Venta J: nunca se grabo el egreso (la ruta lo hacia best-effort). Un
-- ingreso dejaria un sobrante en la caja: no entra plata y se avisa.
INSERT INTO _nc SELECT 'j', pg_temp.nc_monto('vta-probe-369-j', 25, 'EFECTIVO', 'k-369-j', false);
INSERT INTO _nc SELECT 'j-anulada', pg_temp.anular('vta-probe-369-j', 'j');
INSERT INTO _r SELECT 24, 'sin egreso: anulada / ingresos / aviso', 'true / 0 / true',
  (SELECT anulada::TEXT FROM devoluciones_venta WHERE id = (SELECT res->>'id' FROM _nc WHERE clave = 'j')) || ' / ' ||
  (SELECT COUNT(*)::TEXT FROM movimientos_caja WHERE devolucion_id = (SELECT res->>'id' FROM _nc WHERE clave = 'j')) || ' / ' ||
  (SELECT res->>'efectivoSinEgreso' FROM _nc WHERE clave = 'j-anulada');

-- ── La NC siguiente ve lo mismo que la app ─────────────────────────────────
-- 25. Venta N (fiada, dos fundas): devolver las dos baja toda la deuda; se anula.
-- Devolver una despues baja $50 de la deuda, sin reintegro y sin pedir medio
-- (con el nucleo viejo: deuda 0, reintegro 50 y "Falta el medio de reintegro").
INSERT INTO _nc SELECT 'n1', pg_temp.nc_items('vta-probe-369-n',
  '[{"itemVentaId":"iv-probe-369-n","cantidad":2,"restaurarStock":false}]', NULL, 'k-369-n1');
INSERT INTO _nc SELECT 'n1-anulada', pg_temp.anular('vta-probe-369-n', 'n1');
INSERT INTO _nc SELECT 'n2', pg_temp.nc_items('vta-probe-369-n',
  '[{"itemVentaId":"iv-probe-369-n","cantidad":1,"restaurarStock":false}]', NULL, 'k-369-n2');
INSERT INTO _r SELECT 25, 'NC despues de anular: tipo / acredita / baja deuda / reintegra / estado_pago',
  'PARCIAL / 50.00 / 50.00 / 0.00 / PAGADO_PARCIAL',
  (n.res->>'tipo') || ' / ' || (n.res->>'montoDevolucion')::NUMERIC(12,2)::TEXT || ' / ' ||
  (n.res->>'montoAplicadoDeuda')::NUMERIC(12,2)::TEXT || ' / ' || (n.res->>'montoReembolso')::NUMERIC(12,2)::TEXT
  || ' / ' || v.estado_pago
  FROM _nc n, ventas v WHERE n.clave = 'n2' AND v.id = 'vta-probe-369-n';

-- ── Emitir, anular, emitir otra vez y anular otra vez ──────────────────────
-- 28. Venta K (una funda con 30 dias de garantia, pagada): una NC la devuelve
-- entera y se anula; otra NC la devuelve de nuevo y tambien se anula. Para la
-- garantia no cuenta lo que devolvio la primera (anulada): vuelve a ACTIVA.
INSERT INTO ventas (id, numero_venta, cliente_id, cliente_nombre, vendedor_id, subtotal, total,
                    metodo_pago, estado, organization_id, sucursal_id, monto_abonado, estado_pago)
VALUES ('vta-probe-369-k', 13, NULL, 'Probe 369', 'usr-probe-369', 50, 50,
        'EFECTIVO'::metodo_pago_venta, 'COMPLETADA'::estado_venta, 'org-probe-369',
        (SELECT id FROM sucursales WHERE organization_id = 'org-probe-369' AND principal), 50, 'PAGADO');
INSERT INTO items_venta (id, venta_id, inventario_id, descripcion, cantidad, precio_unitario, subtotal, dias_garantia)
VALUES ('iv-probe-369-k', 'vta-probe-369-k', 'inv-probe-369-p', 'Funda probe 369', 1, 50, 50, 30);
INSERT INTO garantias_venta (id, venta_id, item_venta_id, numero_garantia, dias_validez, fecha_vencimiento, estado, organization_id)
VALUES ('gar-probe-369-k', 'vta-probe-369-k', 'iv-probe-369-k', 'GAR-P369-K', 30, now() + interval '30 days',
        'ACTIVA'::estado_garantia_venta, 'org-probe-369');
INSERT INTO _nc SELECT 'k1', pg_temp.nc_items('vta-probe-369-k',
  '[{"itemVentaId":"iv-probe-369-k","cantidad":1,"restaurarStock":false}]', 'TRANSFERENCIA', 'k-369-k1');
INSERT INTO _nc SELECT 'k1-anulada', pg_temp.anular('vta-probe-369-k', 'k1');
INSERT INTO _nc SELECT 'k2', pg_temp.nc_items('vta-probe-369-k',
  '[{"itemVentaId":"iv-probe-369-k","cantidad":1,"restaurarStock":false}]', 'TRANSFERENCIA', 'k-369-k2');
INSERT INTO _foto SELECT 'k2', to_jsonb((SELECT estado::TEXT FROM garantias_venta WHERE id = 'gar-probe-369-k'));
INSERT INTO _nc SELECT 'k2-anulada', pg_temp.anular('vta-probe-369-k', 'k2');
INSERT INTO _r SELECT 28, 'K: NC, anular, otra NC, anular: garantia con la segunda NC / despues / reactivadas',
  'ANULADA / ACTIVA / 1',
  (SELECT foto #>> '{}' FROM _foto WHERE clave = 'k2') || ' / ' ||
  (SELECT estado::TEXT FROM garantias_venta WHERE id = 'gar-probe-369-k') || ' / ' ||
  (SELECT res->>'garantiasReactivadas' FROM _nc WHERE clave = 'k2-anulada');

-- 29. Venta N: se anula tambien la segunda NC (la de una funda). Para
-- estado_pago no cuenta lo que bajo la primera (anulada): la venta vuelve a
-- deber todo, sin NC activas, y su cuenta corriente queda neta en cero.
INSERT INTO _nc SELECT 'n2-anulada', pg_temp.anular('vta-probe-369-n', 'n2');
INSERT INTO _r SELECT 29, 'N: anular la segunda NC: estado_pago / pendiente / NC activas / cuenta corriente de la venta',
  'PENDIENTE / 100.00 / 0 / 0.00',
  (x.f->>'estado_pago') || ' / ' || (x.f->>'pendiente') || ' / ' || (x.f->>'nc_activas') || ' / ' ||
  (x.f->>'cuenta_corriente_venta')
  FROM (SELECT pg_temp.foto('vta-probe-369-n') AS f) x;

-- ── Purga de la organizacion ───────────────────────────────────────────────
-- 26 y 27. Con NC anuladas, ingresos y egresos enlazados, movimientos ANULACION,
-- series restauradas, CARGOs y cajas: no se traba.
DO $$
DECLARE v_msg TEXT := 'OK';
BEGIN
  BEGIN
    DELETE FROM organizations WHERE id IN ('org-probe-369', 'org-probe-369-x');
  EXCEPTION WHEN OTHERS THEN
    v_msg := 'FALLO: ' || SQLERRM;
  END;
  INSERT INTO _r VALUES (26, 'borrar los talleres con NC anuladas y sus reversas no se traba', 'OK', v_msg);
END $$;

INSERT INTO _r SELECT 27, 'la cascada se llevo NC, movimientos de caja y de stock, y cuenta corriente', '0 / 0 / 0 / 0',
  (SELECT COUNT(*)::TEXT FROM devoluciones_venta WHERE organization_id = 'org-probe-369') || ' / ' ||
  (SELECT COUNT(*)::TEXT FROM movimientos_caja WHERE organization_id = 'org-probe-369') || ' / ' ||
  (SELECT COUNT(*)::TEXT FROM movimientos_inventario WHERE organization_id = 'org-probe-369') || ' / ' ||
  (SELECT COUNT(*)::TEXT FROM cuenta_corriente WHERE organization_id = 'org-probe-369');

SELECT orden, probe, esperado, obtenido,
       CASE WHEN obtenido LIKE 'SALTEADO%' THEN 'SALTEADO'
            WHEN esperado = obtenido THEN 'OK'
            ELSE 'FALLA' END AS resultado
  FROM _r ORDER BY orden;

ROLLBACK;
