-- Probes de la 365. Abren su propia transaccion y la revierten: db-run.mjs
-- detecta el BEGIN y rechaza --apply. Correr DESPUES de aplicar la 365:
--   npm run db:dry -- supabase/migrations/verify/365_probes.sql
-- (o pegar el archivo entero en el editor SQL de Supabase).
-- Contra una base sin la 365 corta al crear pg_temp.nc_monto: la funcion no
-- tiene p_modo.
--
-- Fixture propia (org-probe-365, y org-probe-365-x como taller ajeno). La
-- sucursal y el deposito principales los crea el trigger de alta de la org
-- (217); se agrega una sucursal B con su caja abierta para ver que un egreso
-- nunca se engancha a la caja de otra sucursal.
-- Los casos de plata son los de __tests__/lib/notas-credito-reparto.test.ts.
-- Los literales que van a columnas enum (ventas.estado, ventas.metodo_pago,
-- garantias_venta.estado) llevan su cast: salidos de un VALUES como tabla son
-- text y no se convierten solos.
BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);
CREATE TEMP TABLE _nc (clave TEXT PRIMARY KEY, res JSONB);

INSERT INTO organizations (id, nombre, nombre_mostrar, slug)
VALUES ('org-probe-365', 'Probe 365', 'Probe 365', 'probe-365-' || substr(md5(random()::text), 1, 8));

INSERT INTO users (id, organization_id, sucursal_id, email, nombre, password, rol)
VALUES ('usr-probe-365', 'org-probe-365',
        (SELECT id FROM sucursales WHERE organization_id = 'org-probe-365' AND principal),
        'admin@probe-365.invalid', 'Probe 365', 'x', 'ADMIN');

INSERT INTO sucursales (id, organization_id, nombre, principal)
VALUES ('suc-probe-365-b', 'org-probe-365', 'Sucursal B probe 365', false);

-- Caja abierta SOLO en la sucursal B: la principal arranca sin caja.
INSERT INTO sesiones_caja (id, organization_id, usuario_apertura_id, sucursal_id, estado)
VALUES ('ses-probe-365-b', 'org-probe-365', 'usr-probe-365', 'suc-probe-365-b', 'ABIERTA');

INSERT INTO clientes (id, nombre, telefono, organization_id)
VALUES ('cli-probe-365', 'Cliente probe 365', '365-0001', 'org-probe-365');

-- 1 y 2: el ejemplo del spec (total 100, cobrado 60, con cliente)
-- 3: pagada entera, de mostrador (sin cliente)
-- 4: fiada entera (cobrado 0, con cliente)
-- 5: pagada entera, con cliente (centavos)
-- 6: un producto x10 a $10, pagada, con garantia (productos y monto mezclados)
-- 7: pagada, un producto (ventana de deploy)
-- 8: pagada entera, con cliente (reintegro a cuenta corriente)
-- 9: ANULADA (no admite NC)
INSERT INTO ventas (id, numero_venta, cliente_id, cliente_nombre, vendedor_id, subtotal, total,
                    metodo_pago, estado, organization_id, sucursal_id, monto_abonado, estado_pago)
SELECT v.id, v.numero, v.cliente, 'Probe 365', 'usr-probe-365', v.total, v.total,
       'EFECTIVO'::metodo_pago_venta, v.estado::estado_venta, 'org-probe-365',
       (SELECT id FROM sucursales WHERE organization_id = 'org-probe-365' AND principal),
       v.abonado, v.estado_pago
FROM (VALUES
  ('vta-probe-365-1', 1, 'cli-probe-365', 100.00, 60.00, 'COMPLETADA', 'PAGADO_PARCIAL'),
  ('vta-probe-365-2', 2, 'cli-probe-365', 100.00, 60.00, 'COMPLETADA', 'PAGADO_PARCIAL'),
  ('vta-probe-365-3', 3, NULL, 1000.00, 1000.00, 'COMPLETADA', 'PAGADO'),
  ('vta-probe-365-4', 4, 'cli-probe-365', 500.00, 0.00, 'COMPLETADA', 'PENDIENTE'),
  ('vta-probe-365-5', 5, 'cli-probe-365', 100.00, 100.00, 'COMPLETADA', 'PAGADO'),
  ('vta-probe-365-6', 6, 'cli-probe-365', 100.00, 100.00, 'COMPLETADA', 'PAGADO'),
  ('vta-probe-365-7', 7, 'cli-probe-365', 100.00, 100.00, 'COMPLETADA', 'PAGADO'),
  ('vta-probe-365-8', 8, 'cli-probe-365', 100.00, 100.00, 'COMPLETADA', 'PAGADO'),
  ('vta-probe-365-9', 9, 'cli-probe-365', 100.00, 100.00, 'ANULADA', 'ANULADA')
) AS v(id, numero, cliente, total, abonado, estado, estado_pago);

-- Otro taller, para ver que nadie emite sobre una venta ajena (probe 33).
INSERT INTO organizations (id, nombre, nombre_mostrar, slug)
VALUES ('org-probe-365-x', 'Probe 365 X', 'Probe 365 X', 'probe-365-x-' || substr(md5(random()::text), 1, 8));

INSERT INTO items_venta (id, venta_id, descripcion, cantidad, precio_unitario, subtotal)
VALUES ('iv-probe-365-6', 'vta-probe-365-6', 'Producto probe 365', 10, 10, 100),
       ('iv-probe-365-7', 'vta-probe-365-7', 'Producto probe 365', 1, 100, 100);

INSERT INTO garantias_venta (id, venta_id, item_venta_id, numero_garantia, dias_validez,
                             fecha_vencimiento, estado, organization_id)
VALUES ('gar-probe-365-6', 'vta-probe-365-6', 'iv-probe-365-6', 'GAR-P365', 90,
        now() + interval '90 days', 'ACTIVA'::estado_garantia_venta, 'org-probe-365');

-- Atajos: una NC por monto o por productos con egreso adentro (lo que manda la
-- ruta del PR3), y el mensaje de error de una sentencia ('sin error' si anda).
CREATE FUNCTION pg_temp.nc_monto(p_venta TEXT, p_monto NUMERIC, p_motivo_nc TEXT, p_metodo TEXT, p_key TEXT)
RETURNS JSONB LANGUAGE sql AS $$
  SELECT registrar_devolucion_atomica(
    p_org_id => 'org-probe-365', p_venta_id => p_venta, p_user_id => 'usr-probe-365',
    p_numero_devolucion => NULL, p_motivo => 'Probe 365', p_observaciones => NULL,
    p_metodo_reembolso => p_metodo, p_reembolso_referencia => NULL, p_items => '[]'::jsonb,
    p_idempotency_key => p_key, p_modo => 'MONTO', p_monto => p_monto,
    p_motivo_nc => p_motivo_nc, p_registrar_egreso => true)
$$;

CREATE FUNCTION pg_temp.nc_items(p_venta TEXT, p_items JSONB, p_motivo_nc TEXT, p_metodo TEXT, p_key TEXT)
RETURNS JSONB LANGUAGE sql AS $$
  SELECT registrar_devolucion_atomica(
    p_org_id => 'org-probe-365', p_venta_id => p_venta, p_user_id => 'usr-probe-365',
    p_numero_devolucion => NULL, p_motivo => 'Probe 365', p_observaciones => NULL,
    p_metodo_reembolso => p_metodo, p_reembolso_referencia => NULL, p_items => p_items,
    p_idempotency_key => p_key, p_modo => 'ITEMS', p_monto => NULL,
    p_motivo_nc => p_motivo_nc, p_registrar_egreso => true)
$$;

CREATE FUNCTION pg_temp.error_de(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'sin error';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;

-- ── Firma y permisos ───────────────────────────────────────────────────────
INSERT INTO _r SELECT 1, 'registrar_devolucion_atomica: una sola firma, de 14 parametros', '1 / 14',
  COUNT(*)::TEXT || ' / ' || COALESCE(MAX(p.pronargs)::TEXT, '-')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'registrar_devolucion_atomica';

INSERT INTO _r SELECT 2, 'registrar_devolucion_monto existe', '1',
  COUNT(*)::TEXT
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'registrar_devolucion_monto';

INSERT INTO _r SELECT 3, 'atomica y monto: EXECUTE solo para service_role',
  'false / false / true / false / false / true',
  has_function_privilege('anon',
    'public.registrar_devolucion_atomica(text,text,text,text,text,text,text,text,jsonb,text,text,numeric,text,boolean)', 'EXECUTE')::TEXT || ' / ' ||
  has_function_privilege('authenticated',
    'public.registrar_devolucion_atomica(text,text,text,text,text,text,text,text,jsonb,text,text,numeric,text,boolean)', 'EXECUTE')::TEXT || ' / ' ||
  has_function_privilege('service_role',
    'public.registrar_devolucion_atomica(text,text,text,text,text,text,text,text,jsonb,text,text,numeric,text,boolean)', 'EXECUTE')::TEXT || ' / ' ||
  has_function_privilege('anon',
    'public.registrar_devolucion_monto(text,text,text,text,numeric,text,text,text,text,text,text)', 'EXECUTE')::TEXT || ' / ' ||
  has_function_privilege('authenticated',
    'public.registrar_devolucion_monto(text,text,text,text,numeric,text,text,text,text,text,text)', 'EXECUTE')::TEXT || ' / ' ||
  has_function_privilege('service_role',
    'public.registrar_devolucion_monto(text,text,text,text,numeric,text,text,text,text,text,text)', 'EXECUTE')::TEXT;

INSERT INTO _r SELECT 4, 'movimientos_caja.devolucion_id: FK a devoluciones_venta con ON DELETE SET NULL',
  'devoluciones_venta / n',
  -- confdeltype es "char": sin el cast, text || "char" es ambiguo y corta el archivo.
  COALESCE((SELECT c.confrelid::regclass::TEXT || ' / ' || c.confdeltype::TEXT
              FROM pg_constraint c
             WHERE c.conrelid = 'public.movimientos_caja'::regclass AND c.contype = 'f'
               AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                                      WHERE attrelid = 'public.movimientos_caja'::regclass
                                        AND attname = 'devolucion_id')]::int2[]), 'no existe');

-- 5. El indice que impide sacar dos veces la plata de una NC: unico, sobre
-- (devolucion_id, tipo) en ese orden y parcial (los egresos sin NC no cuentan).
INSERT INTO _r SELECT 5, 'indice de los movimientos de una NC: tabla / unico / columnas / predicado',
  'movimientos_caja / true / devolucion_id,tipo / (devolucion_id IS NOT NULL)',
  COALESCE((SELECT i.indrelid::regclass::TEXT || ' / ' || i.indisunique::TEXT || ' / ' ||
                   (SELECT string_agg(a.attname::TEXT, ',' ORDER BY k.ord)
                      FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
                      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum) || ' / ' ||
                   COALESCE(pg_get_expr(i.indpred, i.indrelid), 'sin predicado')
              FROM pg_index i
             WHERE i.indexrelid = to_regclass('public.movimientos_caja_devolucion_tipo_unique')), 'no existe');

-- ── Casos de plata (los mismos del test TS) ────────────────────────────────
-- 6 y 7. Spec: venta de $100 con $60 cobrados. NC de $30: baja la deuda, no reintegra.
INSERT INTO _nc SELECT 'v1', pg_temp.nc_monto('vta-probe-365-1', 30, 'AJUSTE_PRECIO', NULL, 'k-365-1');
INSERT INTO _r SELECT 6, 'NC $30 sobre $40 de deuda: modo / tipo / acredita / baja deuda / reintegra / motivo / numero',
  'MONTO / PARCIAL / 30.00 / 30.00 / 0.00 / AJUSTE_PRECIO / NC-000001',
  dv.modo || ' / ' || dv.tipo || ' / ' || dv.monto_devolucion::TEXT || ' / ' ||
  dv.monto_aplicado_deuda::TEXT || ' / ' || (dv.monto_devolucion - dv.monto_aplicado_deuda)::TEXT || ' / ' ||
  dv.motivo_nc || ' / ' || dv.numero_devolucion
  FROM devoluciones_venta dv WHERE dv.id = (SELECT res->>'id' FROM _nc WHERE clave = 'v1');

INSERT INTO _r SELECT 7, 'venta 1 despues: pendiente / estado_pago / credito en cuenta corriente',
  '10.00 / PAGADO_PARCIAL / 30.00',
  (v.total - v.monto_abonado
     - (SELECT SUM(monto_aplicado_deuda) FROM devoluciones_venta WHERE venta_id = v.id AND anulada = false))::TEXT
  || ' / ' || v.estado_pago || ' / ' ||
  COALESCE((SELECT SUM(monto)::TEXT FROM cuenta_corriente
             WHERE organization_id = 'org-probe-365' AND referencia_tipo = 'VENTA'
               AND referencia_id = v.id AND tipo::TEXT = 'DEVOLUCION'), '0')
  FROM ventas v WHERE v.id = 'vta-probe-365-1';

-- 8 y 9. Spec: NC de $50 sobre $40 de deuda, en efectivo, sin caja abierta en la
-- sucursal de la venta (la unica abierta es la de B).
INSERT INTO _nc SELECT 'v2', pg_temp.nc_monto('vta-probe-365-2', 50, 'ERROR_FACTURACION', 'EFECTIVO', 'k-365-2');
INSERT INTO _r SELECT 8, 'NC $50 sobre $40 de deuda: baja deuda / reintegra / medio / estado_pago',
  '40.00 / 10.00 / EFECTIVO / PAGADO',
  dv.monto_aplicado_deuda::TEXT || ' / ' || (dv.monto_devolucion - dv.monto_aplicado_deuda)::TEXT || ' / ' ||
  dv.metodo_reembolso::TEXT || ' / ' || v.estado_pago
  FROM devoluciones_venta dv JOIN ventas v ON v.id = dv.venta_id
  WHERE dv.id = (SELECT res->>'id' FROM _nc WHERE clave = 'v2');

INSERT INTO _r SELECT 9, 'egreso de la NC 2: filas / monto / medio / origen / afecta / sesion / sucursal de la venta / id devuelto',
  '1 / 10.00 / EFECTIVO / DEVOLUCION / false / sin sesion / true / true',
  COUNT(*)::TEXT || ' / ' || MAX(m.monto)::TEXT || ' / ' || MAX(m.metodo_pago) || ' / ' || MAX(m.origen) || ' / ' ||
  bool_and(m.afecta_rentabilidad)::TEXT || ' / ' ||
  CASE WHEN bool_and(m.sesion_caja_id IS NULL) THEN 'sin sesion' ELSE 'con sesion' END || ' / ' ||
  bool_and(m.sucursal_id = (SELECT sucursal_id FROM ventas WHERE id = 'vta-probe-365-2'))::TEXT || ' / ' ||
  bool_and(m.id = (SELECT res->>'movimientoCajaId' FROM _nc WHERE clave = 'v2'))::TEXT
  FROM movimientos_caja m
  WHERE m.devolucion_id = (SELECT res->>'id' FROM _nc WHERE clave = 'v2') AND m.tipo = 'EGRESO';

-- 10. Pagada entera y de mostrador, con caja abierta en la principal (y otra en
-- B): reintegra todo y el egreso se engancha a la caja de SU sucursal.
INSERT INTO sesiones_caja (id, organization_id, usuario_apertura_id, sucursal_id, estado)
VALUES ('ses-probe-365-a', 'org-probe-365', 'usr-probe-365',
        (SELECT id FROM sucursales WHERE organization_id = 'org-probe-365' AND principal), 'ABIERTA');
INSERT INTO _nc SELECT 'v3', pg_temp.nc_monto('vta-probe-365-3', 300, 'DESCUENTO_RETRO', 'EFECTIVO', 'k-365-3');
INSERT INTO _r SELECT 10, 'NC $300 sobre venta pagada: baja deuda / reintegra / caja del egreso',
  '0.00 / 300.00 / ses-probe-365-a',
  (res->>'montoAplicadoDeuda')::NUMERIC(12,2)::TEXT || ' / ' || (res->>'montoReembolso')::NUMERIC(12,2)::TEXT || ' / ' ||
  COALESCE((SELECT sesion_caja_id FROM movimientos_caja WHERE id = res->>'movimientoCajaId'), 'sin egreso')
  FROM _nc WHERE clave = 'v3';

-- 11. Doble click / reintento con la misma clave: misma NC, mismo numero,
-- replayed, un solo egreso y el contador sin avanzar (ultimo emitido = 3).
INSERT INTO _nc SELECT 'v3-bis', pg_temp.nc_monto('vta-probe-365-3', 300, 'DESCUENTO_RETRO', 'EFECTIVO', 'k-365-3');
INSERT INTO _r SELECT 11, 'reintento: misma NC / mismo numero / replayed / egresos / mismo egreso / ultimo numero emitido',
  'true / true / true / 1 / true / 3',
  ((b.res->>'id') = (a.res->>'id'))::TEXT || ' / ' ||
  ((b.res->>'numero') = (a.res->>'numero'))::TEXT || ' / ' ||
  (b.res->>'replayed') || ' / ' ||
  (SELECT COUNT(*)::TEXT FROM movimientos_caja WHERE devolucion_id = a.res->>'id') || ' / ' ||
  ((b.res->>'movimientoCajaId') = (a.res->>'movimientoCajaId'))::TEXT || ' / ' ||
  (SELECT next_number::TEXT FROM notas_credito_counter WHERE organization_id = 'org-probe-365')
  FROM _nc a, _nc b WHERE a.clave = 'v3' AND b.clave = 'v3-bis';

-- 12. Fiada entera, NC por el total con 'efectivo' elegido: todo baja la deuda,
-- TOTAL, PAGADO, sin medio guardado (nada se devolvio) y sin egreso.
INSERT INTO _nc SELECT 'v4', pg_temp.nc_monto('vta-probe-365-4', 500, 'ERROR_FACTURACION', 'EFECTIVO', 'k-365-4');
INSERT INTO _r SELECT 12, 'NC por el total de una fiada: tipo / baja deuda / reintegra / medio / estado_pago / egresos / credito CC',
  'TOTAL / 500.00 / 0.00 / sin medio / PAGADO / 0 / 500.00',
  dv.tipo || ' / ' || dv.monto_aplicado_deuda::TEXT || ' / ' ||
  (dv.monto_devolucion - dv.monto_aplicado_deuda)::TEXT || ' / ' ||
  COALESCE(dv.metodo_reembolso::TEXT, 'sin medio') || ' / ' || v.estado_pago || ' / ' ||
  (SELECT COUNT(*)::TEXT FROM movimientos_caja WHERE devolucion_id = dv.id) || ' / ' ||
  COALESCE((SELECT SUM(monto)::TEXT FROM cuenta_corriente
             WHERE referencia_tipo = 'VENTA' AND referencia_id = v.id AND tipo::TEXT = 'DEVOLUCION'), '0')
  FROM devoluciones_venta dv JOIN ventas v ON v.id = dv.venta_id
  WHERE dv.id = (SELECT res->>'id' FROM _nc WHERE clave = 'v4');

-- 13. Venta agotada: cualquier NC nueva, por monto o por productos, se rechaza
-- con un mensaje claro (antes: CHECK monto_devolucion > 0, error 500).
INSERT INTO _r SELECT 13, 'venta sin saldo para acreditar: por monto / por productos',
  'La venta ya no tiene saldo para acreditar / La venta ya no tiene saldo para acreditar',
  pg_temp.error_de($q$SELECT pg_temp.nc_monto('vta-probe-365-4', 1, 'OTRO', NULL, 'k-365-4b')$q$) || ' / ' ||
  pg_temp.error_de($q$SELECT pg_temp.nc_items('vta-probe-365-4',
    '[{"itemVentaId":"no-existe","cantidad":1,"restaurarStock":false}]', 'DEVOLUCION', NULL, 'k-365-4c')$q$);

-- 14 y 15. Centavos y tope exacto: $33,33; despues $66,68 se rechaza sin quemar
-- numero; $66,67 cierra la venta en TOTAL con la suma exacta.
INSERT INTO _nc SELECT 'v5a', pg_temp.nc_monto('vta-probe-365-5', 33.33, 'AJUSTE_PRECIO', 'TRANSFERENCIA', 'k-365-5a');
INSERT INTO _r SELECT 14, '$66,68 con $66,67 disponibles', 'El monto supera lo disponible para acreditar. Máximo: 66.67',
  pg_temp.error_de($q$SELECT pg_temp.nc_monto('vta-probe-365-5', 66.68, 'AJUSTE_PRECIO', 'TRANSFERENCIA', 'k-365-5b')$q$);
INSERT INTO _nc SELECT 'v5c', pg_temp.nc_monto('vta-probe-365-5', 66.67, 'AJUSTE_PRECIO', 'TRANSFERENCIA', 'k-365-5c');
INSERT INTO _r SELECT 15, 'la que cierra: tipo / suma acreditada / numero consecutivo (el rechazo no quemo) / egresos por transferencia',
  'TOTAL / 100.00 / true / 0',
  (c.res->>'tipo') || ' / ' ||
  (SELECT SUM(monto_devolucion)::TEXT FROM devoluciones_venta WHERE venta_id = 'vta-probe-365-5') || ' / ' ||
  (substring(c.res->>'numero' from 4)::INT = substring(a.res->>'numero' from 4)::INT + 1)::TEXT || ' / ' ||
  (SELECT COUNT(*)::TEXT FROM movimientos_caja m JOIN devoluciones_venta dv ON dv.id = m.devolucion_id
    WHERE dv.venta_id = 'vta-probe-365-5')
  FROM _nc a, _nc c WHERE a.clave = 'v5a' AND c.clave = 'v5c';

-- ── Productos por el envoltorio nuevo, y mezclados con monto ───────────────
-- 16. Por productos con motivo del catalogo y efectivo: el nucleo de la 330 hace
-- la devolucion; el envoltorio guarda el motivo y saca la plata.
INSERT INTO _nc SELECT 'v6a', pg_temp.nc_items('vta-probe-365-6',
  '[{"itemVentaId":"iv-probe-365-6","cantidad":1,"restaurarStock":false}]', 'GARANTIA', 'EFECTIVO', 'k-365-6a');
INSERT INTO _r SELECT 16, 'por productos: modo / motivo / monto / items / egreso',
  'ITEMS / GARANTIA / 10.00 / 1 / 10.00',
  dv.modo || ' / ' || dv.motivo_nc || ' / ' || dv.monto_devolucion::TEXT || ' / ' ||
  (SELECT COUNT(*)::TEXT FROM items_devolucion WHERE devolucion_id = dv.id) || ' / ' ||
  COALESCE((SELECT monto::TEXT FROM movimientos_caja WHERE devolucion_id = dv.id AND tipo = 'EGRESO'), 'sin egreso')
  FROM devoluciones_venta dv WHERE dv.id = (SELECT res->>'id' FROM _nc WHERE clave = 'v6a');

-- 17. Por productos sin productos: rechazado en el envoltorio.
INSERT INTO _r SELECT 17, 'por productos sin productos', 'Elegí al menos un producto para devolver',
  pg_temp.error_de($q$SELECT pg_temp.nc_items('vta-probe-365-6', '[]', 'DEVOLUCION', NULL, 'k-365-6x')$q$);

-- 18. Por monto en la misma venta: sin items, la garantia de la linea sigue
-- ACTIVA y no hay movimientos de stock.
INSERT INTO _nc SELECT 'v6b', pg_temp.nc_monto('vta-probe-365-6', 50, 'AJUSTE_PRECIO', 'TRANSFERENCIA', 'k-365-6b');
INSERT INTO _r SELECT 18, 'por monto no toca productos: items / garantia / movimientos de stock', '0 / ACTIVA / 0',
  (SELECT COUNT(*)::TEXT FROM items_devolucion WHERE devolucion_id = n.res->>'id') || ' / ' ||
  (SELECT estado::TEXT FROM garantias_venta WHERE id = 'gar-probe-365-6') || ' / ' ||
  (SELECT COUNT(*)::TEXT FROM movimientos_inventario WHERE referencia_id = n.res->>'id')
  FROM _nc n WHERE n.clave = 'v6b';

-- 19. Despues de la NC por monto, devolver lo que queda cierra en TOTAL por el
-- resto: la suma de la venta nunca pasa lo facturado. La linea queda devuelta
-- entera y su garantia se retira (paso 6b de la 330).
-- Deuda conocida y aceptada (PR5): las lineas de esta NC suman 90 (9 x $10, el
-- precio pagado) aunque acredita 40, porque los otros 50 ya los acredito la NC
-- por monto. El probe fija ese desfase para que un cambio no pase inadvertido.
INSERT INTO _nc SELECT 'v6c', pg_temp.nc_items('vta-probe-365-6',
  '[{"itemVentaId":"iv-probe-365-6","cantidad":9,"restaurarStock":false}]', 'DEVOLUCION', 'TRANSFERENCIA', 'k-365-6c');
INSERT INTO _r SELECT 19, 'productos despues de monto: tipo / monto / suma de la venta / garantia / suma de sus lineas',
  'TOTAL / 40.00 / 100.00 / ANULADA / 90.00',
  (n.res->>'tipo') || ' / ' || (n.res->>'montoDevolucion')::NUMERIC(12,2)::TEXT || ' / ' ||
  (SELECT SUM(monto_devolucion)::TEXT FROM devoluciones_venta WHERE venta_id = 'vta-probe-365-6') || ' / ' ||
  (SELECT estado::TEXT FROM garantias_venta WHERE id = 'gar-probe-365-6') || ' / ' ||
  COALESCE((SELECT SUM(subtotal)::TEXT FROM items_devolucion WHERE devolucion_id = n.res->>'id'), 'sin lineas')
  FROM _nc n WHERE n.clave = 'v6c';

-- ── Validaciones del modo monto (venta 3: pagada, sin cliente, $700 disponibles) ─
INSERT INTO _r SELECT 20, 'por monto sin motivo', 'El motivo de la nota de crédito es obligatorio',
  pg_temp.error_de($q$SELECT pg_temp.nc_monto('vta-probe-365-3', 10, NULL, 'EFECTIVO', 'k-365-e1')$q$);
INSERT INTO _r SELECT 21, 'por monto con un motivo fuera del catalogo',
  'new row for relation "devoluciones_venta" violates check constraint "devoluciones_venta_motivo_nc_check"',
  pg_temp.error_de($q$SELECT pg_temp.nc_monto('vta-probe-365-3', 10, 'INVENTADO', 'EFECTIVO', 'k-365-e2')$q$);
INSERT INTO _r SELECT 22, 'por monto con reintegro y sin medio', 'Falta el medio de reintegro',
  pg_temp.error_de($q$SELECT pg_temp.nc_monto('vta-probe-365-3', 10, 'OTRO', NULL, 'k-365-e3')$q$);
INSERT INTO _r SELECT 23, 'a cuenta corriente sin cliente', 'Para devolver a cuenta corriente la venta tiene que tener un cliente',
  pg_temp.error_de($q$SELECT pg_temp.nc_monto('vta-probe-365-3', 10, 'OTRO', 'CUENTA_CORRIENTE', 'k-365-e4')$q$);
INSERT INTO _r SELECT 24, 'monto cero', 'El monto de la nota de crédito tiene que ser mayor a cero',
  pg_temp.error_de($q$SELECT pg_temp.nc_monto('vta-probe-365-3', 0, 'OTRO', 'EFECTIVO', 'k-365-e5')$q$);

-- ── Ventana de deploy ──────────────────────────────────────────────────────
-- 25. El codigo anterior llama con los 10 parametros por nombre (asi arma la
-- llamada PostgREST): devolucion por productos, numero NC-, sin motivo del
-- catalogo, y el egreso NO lo hace la RPC (lo sigue haciendo esa ruta).
INSERT INTO _nc SELECT 'v7', registrar_devolucion_atomica(
  p_org_id => 'org-probe-365', p_venta_id => 'vta-probe-365-7', p_user_id => 'usr-probe-365',
  p_numero_devolucion => NULL, p_motivo => 'Probe 365 codigo anterior', p_observaciones => NULL,
  p_metodo_reembolso => 'EFECTIVO', p_reembolso_referencia => NULL,
  p_items => '[{"itemVentaId":"iv-probe-365-7","cantidad":1,"restaurarStock":false}]'::jsonb,
  p_idempotency_key => 'k-365-7');
INSERT INTO _r SELECT 25, 'codigo anterior: modo / numero NC- / motivo del catalogo / egresos de la RPC',
  'ITEMS / true / sin motivo / 0',
  dv.modo || ' / ' || (dv.numero_devolucion LIKE 'NC-%')::TEXT || ' / ' ||
  COALESCE(dv.motivo_nc, 'sin motivo') || ' / ' ||
  (SELECT COUNT(*)::TEXT FROM movimientos_caja WHERE devolucion_id = dv.id)
  FROM devoluciones_venta dv WHERE dv.id = (SELECT res->>'id' FROM _nc WHERE clave = 'v7');

-- 26. Un segundo egreso para la misma NC choca con el indice unico.
INSERT INTO _r SELECT 26, 'segundo egreso de la misma NC',
  'duplicate key value violates unique constraint "movimientos_caja_devolucion_tipo_unique"',
  pg_temp.error_de(format($q$
    INSERT INTO movimientos_caja (organization_id, tipo, monto, metodo_pago, concepto, usuario_id,
                                  afecta_rentabilidad, sucursal_id, origen, devolucion_id)
    VALUES ('org-probe-365', 'EGRESO', 10, 'EFECTIVO', 'duplicado', 'usr-probe-365', false,
            (SELECT id FROM sucursales WHERE organization_id = 'org-probe-365' AND principal),
            'DEVOLUCION', %L)$q$, (SELECT res->>'id' FROM _nc WHERE clave = 'v2')));

-- ── Reintegro a cuenta corriente, aislamiento y estado de la venta ─────────
-- 32. Venta pagada con cliente, reintegro elegido como "credito en tienda": se
-- guarda como cuenta corriente, la plata queda a favor del cliente y no sale de
-- la caja aunque la principal tenga una abierta (la de la probe 10).
INSERT INTO _nc SELECT 'v8', pg_temp.nc_monto('vta-probe-365-8', 40, 'OTRO', 'CREDITO_TIENDA', 'k-365-8');
INSERT INTO _r SELECT 32,
  'reintegro a cuenta corriente: medio / baja deuda / reintegra / movimientos CC / concepto CC / egresos / egreso en la respuesta',
  'CUENTA_CORRIENTE / 0.00 / 40.00 / 1 x 40.00 / true / 0 / sin egreso',
  dv.metodo_reembolso::TEXT || ' / ' || dv.monto_aplicado_deuda::TEXT || ' / ' ||
  (dv.monto_devolucion - dv.monto_aplicado_deuda)::TEXT || ' / ' ||
  (SELECT COUNT(*)::TEXT || ' x ' || COALESCE(SUM(monto)::TEXT, '0') FROM cuenta_corriente
    WHERE organization_id = 'org-probe-365' AND referencia_tipo = 'VENTA'
      AND referencia_id = 'vta-probe-365-8' AND tipo::TEXT = 'DEVOLUCION') || ' / ' ||
  COALESCE((SELECT bool_and(observaciones = 'Nota de credito ' || dv.numero_devolucion)::TEXT FROM cuenta_corriente
             WHERE referencia_tipo = 'VENTA' AND referencia_id = 'vta-probe-365-8'), 'sin movimiento') || ' / ' ||
  (SELECT COUNT(*)::TEXT FROM movimientos_caja WHERE devolucion_id = dv.id) || ' / ' ||
  COALESCE(n.res->>'movimientoCajaId', 'sin egreso')
  FROM _nc n JOIN devoluciones_venta dv ON dv.id = n.res->>'id'
  WHERE n.clave = 'v8';

-- 33. Otro taller no emite sobre una venta ajena, ni con la firma nueva ni con
-- la de 10 parametros: para el, la venta no existe.
INSERT INTO _r SELECT 33, 'venta de otro taller: firma nueva / firma de 10',
  'Venta no encontrada / Venta no encontrada',
  pg_temp.error_de($q$SELECT registrar_devolucion_atomica(
    p_org_id => 'org-probe-365-x', p_venta_id => 'vta-probe-365-8', p_user_id => 'usr-probe-365',
    p_numero_devolucion => NULL, p_motivo => 'Probe 365', p_observaciones => NULL,
    p_metodo_reembolso => 'EFECTIVO', p_reembolso_referencia => NULL, p_items => '[]'::jsonb,
    p_idempotency_key => 'k-365-x1', p_modo => 'MONTO', p_monto => 10,
    p_motivo_nc => 'OTRO', p_registrar_egreso => true)$q$) || ' / ' ||
  pg_temp.error_de($q$SELECT registrar_devolucion_atomica(
    p_org_id => 'org-probe-365-x', p_venta_id => 'vta-probe-365-7', p_user_id => 'usr-probe-365',
    p_numero_devolucion => NULL, p_motivo => 'Probe 365', p_observaciones => NULL,
    p_metodo_reembolso => 'EFECTIVO', p_reembolso_referencia => NULL,
    p_items => '[{"itemVentaId":"iv-probe-365-7","cantidad":1,"restaurarStock":false}]'::jsonb,
    p_idempotency_key => 'k-365-x2')$q$);

-- 34. Una venta anulada no admite NC, por monto ni por productos.
INSERT INTO _r SELECT 34, 'venta anulada: por monto / por productos',
  'Solo se pueden crear devoluciones para ventas completadas / Solo se pueden crear devoluciones para ventas completadas',
  pg_temp.error_de($q$SELECT pg_temp.nc_monto('vta-probe-365-9', 10, 'OTRO', 'EFECTIVO', 'k-365-9a')$q$) || ' / ' ||
  pg_temp.error_de($q$SELECT pg_temp.nc_items('vta-probe-365-9',
    '[{"itemVentaId":"no-existe","cantidad":1,"restaurarStock":false}]', 'DEVOLUCION', 'EFECTIVO', 'k-365-9b')$q$);

-- 35. La clave de reintento es unica por taller, no por venta: reusarla en otra
-- venta no devuelve la NC de la primera (haria creer que se acredito esta).
INSERT INTO _r SELECT 35, 'clave de reintento ya usada en otra venta',
  'La clave de reintento ya se uso en una nota de credito de otra venta',
  pg_temp.error_de($q$SELECT pg_temp.nc_monto('vta-probe-365-1', 5, 'OTRO', NULL, 'k-365-3')$q$);

-- ── Integracion ────────────────────────────────────────────────────────────
-- 27. La vista unificada (listado, PDF, ticket del PR2) muestra la NC por monto.
INSERT INTO _r SELECT 27, 'v_notas_credito: la NC 2 por monto',
  'MONTO / ERROR_FACTURACION / 50.00 / 40.00 / 10.00 / EFECTIVO / false',
  v.modo || ' / ' || v.motivo_nc || ' / ' || v.monto::TEXT || ' / ' || v.monto_aplicado_deuda::TEXT || ' / ' ||
  v.monto_reembolso::TEXT || ' / ' || v.metodo || ' / ' || v.anulada::TEXT
  FROM v_notas_credito v WHERE v.id = (SELECT res->>'id' FROM _nc WHERE clave = 'v2');

-- 28. La comision del vendedor ya descuenta lo acreditado por monto (333).
INSERT INTO _r SELECT 28, 'v_comisiones_ventas: lo acreditado por monto en la venta 3', '300.00',
  monto_devuelto::TEXT FROM v_comisiones_ventas WHERE venta_id = 'vta-probe-365-3';

-- 29. Borrar una NC (lo que pasa al borrar su venta) deja su egreso: la plata salio igual.
DELETE FROM devoluciones_venta WHERE id = (SELECT res->>'id' FROM _nc WHERE clave = 'v2');
INSERT INTO _r SELECT 29, 'el egreso de la NC borrada sigue, sin vinculo', '1 / sin vinculo',
  COUNT(*)::TEXT || ' / ' || CASE WHEN bool_and(devolucion_id IS NULL) THEN 'sin vinculo' ELSE 'con vinculo' END
  FROM movimientos_caja WHERE id = (SELECT res->>'movimientoCajaId' FROM _nc WHERE clave = 'v2');

-- 30 y 31. Purga de la organizacion (eliminacion de cuenta, superadmin) con NC,
-- egresos enlazados, cajas y cuenta corriente: no se traba.
DO $$
DECLARE v_msg TEXT := 'OK';
BEGIN
  BEGIN
    DELETE FROM organizations WHERE id = 'org-probe-365';
  EXCEPTION WHEN OTHERS THEN
    v_msg := 'FALLO: ' || SQLERRM;
  END;
  INSERT INTO _r VALUES (30, 'borrar la org con NC por monto y egresos enlazados no se traba', 'OK', v_msg);
END $$;

INSERT INTO _r SELECT 31, 'la cascada se llevo NC, movimientos de caja y cajas del taller', '0 / 0 / 0',
  (SELECT COUNT(*)::TEXT FROM devoluciones_venta WHERE organization_id = 'org-probe-365') || ' / ' ||
  (SELECT COUNT(*)::TEXT FROM movimientos_caja WHERE organization_id = 'org-probe-365') || ' / ' ||
  (SELECT COUNT(*)::TEXT FROM sesiones_caja WHERE organization_id = 'org-probe-365');

SELECT orden, probe, esperado, obtenido,
       CASE WHEN obtenido LIKE 'SALTEADO%' THEN 'SALTEADO'
            WHEN esperado = obtenido THEN 'OK'
            ELSE 'FALLA' END AS resultado
  FROM _r ORDER BY orden;

ROLLBACK;
