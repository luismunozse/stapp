-- Verification of 410 (multimoneda S5): la venta guarda la foto de origen y la cotizacion.
--
-- Run AFTER 410 is applied:  node scripts/db-run.mjs supabase/migrations/verify/410_probes.sql
-- (no --apply: the file opens its own transaction and always ends in ROLLBACK; db-run.mjs sees the
-- BEGIN and refuses --apply).
--
-- Without RLS, as in verify/README.md. Only data created: one scratch organization (org-probe-410;
-- its AFTER INSERT trigger creates the sucursal "Casa Central" and the deposito "Principal"), one
-- user, three products (L local, U in USD, E in EUR) with stock in the principal deposito, and the
-- ventas below. Everything is rolled back. The rollback rehearsal at the end replaces both functions
-- until that ROLLBACK, so it runs last.
--
-- Results accumulate in _r and come out in ONE select. Green = esperado equals obtenido. Numbers
-- go through trim_scale, NULL prints as 'NULL'.

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);
CREATE TEMP TABLE _s (k TEXT PRIMARY KEY, v TEXT);

CREATE FUNCTION pg_temp.s(p_k TEXT) RETURNS TEXT LANGUAGE sql AS $$ SELECT v FROM _s WHERE k = p_k $$;

CREATE FUNCTION pg_temp.n(p NUMERIC) RETURNS TEXT LANGUAGE sql AS $$
  SELECT COALESCE(trim_scale(p)::TEXT, 'NULL')
$$;

-- A local line / a line in a foreign currency, in the p_items shape the app sends.
CREATE FUNCTION pg_temp.linea(p_inv TEXT, p_precio NUMERIC) RETURNS JSONB LANGUAGE sql AS $$
  SELECT jsonb_build_object('inventarioId', p_inv, 'descripcion', 'PROBE-410 ' || p_inv,
                            'cantidad', 1, 'precioUnitario', p_precio, 'diasGarantia', 0)
$$;
CREATE FUNCTION pg_temp.linea_div(p_inv TEXT, p_precio NUMERIC, p_moneda TEXT, p_origen NUMERIC,
                                  p_tc NUMERIC, p_costo NUMERIC) RETURNS JSONB LANGUAGE sql AS $$
  SELECT pg_temp.linea(p_inv, p_precio) || jsonb_build_object(
    'monedaOrigen', p_moneda, 'precioOrigen', p_origen, 'tipoCambio', p_tc,
    'tipoCambioFuente', 'OFICIAL', 'costoUnitario', p_costo)
$$;

-- crear_venta_atomica with subtotal = total = p_total, cash, no client. Returns the venta id.
CREATE FUNCTION pg_temp.vender(p_items JSONB, p_total NUMERIC) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  RETURN crear_venta_atomica(
    'org-probe-410', 'usr-probe-410', NULL, 'PROBE 410', NULL, p_total, 0, 'MONTO', 0, p_total,
    'EFECTIVO', NULL, NULL, 1, 0, p_total, p_items,
    p_sucursal_id => pg_temp.s('suc'))->>'ventaId';
END $$;

-- Same, but returns 'ok' or the SQLSTATE and message of the refusal.
CREATE FUNCTION pg_temp.vender_err(p_items JSONB, p_total NUMERIC) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.vender(p_items, p_total);
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END $$;

-- editar_venta_atomica with subtotal = total = p_total. Returns 'ok' or the error.
CREATE FUNCTION pg_temp.editar(p_venta TEXT, p_items JSONB, p_total NUMERIC) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  PERFORM editar_venta_atomica('org-probe-410', 'usr-probe-410', p_venta, NULL, 'PROBE 410', NULL,
                               p_total, 0, 'MONTO', 0, p_total, 'EFECTIVO', 'editada-410', p_items, NULL);
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END $$;

-- moneda_origen | precio_origen | tipo_cambio | costo_unitario_snapshot of one line of a venta.
CREATE FUNCTION pg_temp.foto(p_venta TEXT, p_inv TEXT) RETURNS TEXT LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(COALESCE(iv.moneda_origen, 'NULL') || '|' || pg_temp.n(iv.precio_origen) || '|' ||
                             pg_temp.n(iv.tipo_cambio) || '|' || pg_temp.n(iv.costo_unitario_snapshot), ' ; '),
                  'sin linea')
  FROM items_venta iv WHERE iv.venta_id = p_venta AND iv.inventario_id = p_inv
$$;

-- tipo_cambio | tipo_cambio_fuente | subtotal | total of a venta.
CREATE FUNCTION pg_temp.cabecera(p_venta TEXT) RETURNS TEXT LANGUAGE sql AS $$
  SELECT COALESCE((SELECT pg_temp.n(v.tipo_cambio) || '|' || COALESCE(v.tipo_cambio_fuente, 'NULL') || '|' ||
                          pg_temp.n(v.subtotal) || '|' || pg_temp.n(v.total)
                   FROM ventas v WHERE v.id = p_venta), 'sin venta')
$$;

-- ── Fixture ────────────────────────────────────────────────────────────────
INSERT INTO organizations (id, nombre, nombre_mostrar, slug)
VALUES ('org-probe-410', 'Probe 410', 'Probe 410', 'probe-410-' || substr(md5(random()::text), 1, 8));

INSERT INTO users (id, organization_id, sucursal_id, email, nombre, password, rol)
VALUES ('usr-probe-410', 'org-probe-410',
        (SELECT id FROM sucursales WHERE organization_id = 'org-probe-410' AND principal),
        'admin@probe-410.invalid', 'Probe 410', 'x', 'ADMIN');

DO $$
DECLARE v_dep TEXT; v_id TEXT;
BEGIN
  INSERT INTO _s VALUES ('suc', (SELECT id FROM sucursales WHERE organization_id = 'org-probe-410' AND principal));
  v_dep := get_deposito_principal('org-probe-410');
  INSERT INTO _s VALUES ('dep', v_dep);

  -- L: local, costo 500. U: USD, precio_compra 6 (divisa). E: EUR, precio_compra 8 (divisa).
  INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, stock, stock_reservado, precio_venta)
  VALUES ('org-probe-410', 'PROBE-410-L', 'PROBE-410 L', 'PROBE', 500, 50, 0, 1000) RETURNING id INTO v_id;
  INSERT INTO _s VALUES ('L', v_id);
  INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, stock, stock_reservado, precio_venta, moneda)
  VALUES ('org-probe-410', 'PROBE-410-U', 'PROBE-410 U', 'PROBE', 6, 50, 0, 10, 'USD') RETURNING id INTO v_id;
  INSERT INTO _s VALUES ('U', v_id);
  INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, stock, stock_reservado, precio_venta, moneda)
  VALUES ('org-probe-410', 'PROBE-410-E', 'PROBE-410 E', 'PROBE', 8, 50, 0, 12, 'EUR') RETURNING id INTO v_id;
  INSERT INTO _s VALUES ('E', v_id);

  INSERT INTO inventario_depositos (inventario_id, deposito_id, stock, stock_reservado, organization_id)
  SELECT v, v_dep, 50, 0, 'org-probe-410' FROM _s WHERE k IN ('L', 'U', 'E')
  ON CONFLICT (inventario_id, deposito_id) DO UPDATE SET stock = 50, stock_reservado = 0;
END $$;

INSERT INTO _r SELECT 0, 'fixture: sucursal, deposito principal y los 3 productos', '5',
  count(v)::TEXT FROM _s WHERE k IN ('suc', 'dep', 'L', 'U', 'E');

-- ── Shape ──────────────────────────────────────────────────────────────────
INSERT INTO _r SELECT 1, 'una sola crear_venta_atomica (21 args) y una sola editar_venta_atomica (15 args), no SECURITY DEFINER',
  'crear_venta_atomica:1:21:false editar_venta_atomica:1:15:false',
  string_agg(proname || ':' || c || ':' || a || ':' || s, ' ' ORDER BY proname)
  FROM (SELECT p.proname, count(*)::TEXT AS c, max(p.pronargs)::TEXT AS a, bool_or(p.prosecdef)::TEXT AS s
          FROM pg_proc p
         WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('crear_venta_atomica', 'editar_venta_atomica')
         GROUP BY p.proname) f;

-- ── crear: venta con una linea local y una en USD ─────────────────────────
INSERT INTO _s SELECT 'vA', pg_temp.vender(jsonb_build_array(
  pg_temp.linea(pg_temp.s('L'), 1000),
  pg_temp.linea_div(pg_temp.s('U'), 12000, 'USD', 10, 1200, 7250)), 13000);

INSERT INTO _r SELECT 10, 'venta mixta: ventas.tipo_cambio 1200 y la fuente; subtotal y total los del request',
  '1200|OFICIAL|13000|13000', pg_temp.cabecera(pg_temp.s('vA'));
INSERT INTO _r SELECT 11, 'linea USD: moneda, precio de origen, cotizacion y costo convertido (costoUnitario)',
  'USD|10|1200|7250', pg_temp.foto(pg_temp.s('vA'), pg_temp.s('U'));
INSERT INTO _r SELECT 12, 'linea local: sin foto, costo del inventario como siempre',
  'NULL|NULL|NULL|500', pg_temp.foto(pg_temp.s('vA'), pg_temp.s('L'));
INSERT INTO _r SELECT 13, 'linea USD: precio_unitario y subtotal en moneda local',
  '12000|12000', (SELECT pg_temp.n(precio_unitario) || '|' || pg_temp.n(subtotal)
                    FROM items_venta WHERE venta_id = pg_temp.s('vA') AND inventario_id = pg_temp.s('U'));

-- ── crear: una sola moneda y una sola cotizacion por venta ────────────────
INSERT INTO _r SELECT 20, 'dos lineas USD con tipoCambio distinto: 22023 TIPO_CAMBIO_MIXTO',
  '22023 TIPO_CAMBIO_MIXTO', pg_temp.vender_err(jsonb_build_array(
    pg_temp.linea_div(pg_temp.s('U'), 12000, 'USD', 10, 1200, 7250),
    pg_temp.linea_div(pg_temp.s('U'), 12500, 'USD', 10, 1250, 7250)), 24500);
INSERT INTO _r SELECT 21, 'una linea USD y una EUR con la misma cotizacion: 22023 TIPO_CAMBIO_MIXTO',
  '22023 TIPO_CAMBIO_MIXTO', pg_temp.vender_err(jsonb_build_array(
    pg_temp.linea_div(pg_temp.s('U'), 12000, 'USD', 10, 1200, 7250),
    pg_temp.linea_div(pg_temp.s('E'), 14400, 'EUR', 12, 1200, 9600)), 26400);
INSERT INTO _r SELECT 22, 'una linea USD sin tipoCambio: 22023 TIPO_CAMBIO_MIXTO',
  '22023 TIPO_CAMBIO_MIXTO', pg_temp.vender_err(jsonb_build_array(
    pg_temp.linea_div(pg_temp.s('U'), 12000, 'USD', 10, 1200, 7250) - 'tipoCambio'), 12000);
INSERT INTO _r SELECT 23, 'una linea USD con tipoCambio 0: 22023 TIPO_CAMBIO_MIXTO',
  '22023 TIPO_CAMBIO_MIXTO', pg_temp.vender_err(jsonb_build_array(
    pg_temp.linea_div(pg_temp.s('U'), 12000, 'USD', 10, 0, 7250)), 12000);
INSERT INTO _r SELECT 24, 'dos lineas USD con la misma cotizacion (1200 y 1200.0) pasan',
  'ok', pg_temp.vender_err(jsonb_build_array(
    pg_temp.linea_div(pg_temp.s('U'), 12000, 'USD', 10, 1200, 7250),
    pg_temp.linea_div(pg_temp.s('U'), 12000, 'USD', 10, 1200.0, 7250)), 24000);

-- ── crear: un producto en divisa sin foto de origen no guarda costo crudo ─
INSERT INTO _s SELECT 'vB', pg_temp.vender(jsonb_build_array(
  pg_temp.linea(pg_temp.s('U'), 12000) || '{"costo": 999}'::JSONB), 12000);
INSERT INTO _r SELECT 30, 'producto USD vendido sin monedaOrigen (y con costo 999 en el item): costo NULL, sin foto',
  'NULL|NULL|NULL|NULL', pg_temp.foto(pg_temp.s('vB'), pg_temp.s('U'));
INSERT INTO _r SELECT 31, 'esa venta no tiene cotizacion',
  'NULL|NULL|12000|12000', pg_temp.cabecera(pg_temp.s('vB'));

-- ── crear: una venta sin divisa da lo mismo que antes ─────────────────────
INSERT INTO _s SELECT 'vC', pg_temp.vender(jsonb_build_array(pg_temp.linea(pg_temp.s('L'), 1000)), 1000);
INSERT INTO _r SELECT 40, 'venta sin divisa: tipo_cambio NULL, subtotal y total los del request',
  'NULL|NULL|1000|1000', pg_temp.cabecera(pg_temp.s('vC'));
INSERT INTO _r SELECT 41, 'venta sin divisa: linea con costo del inventario y sin foto',
  'NULL|NULL|NULL|500', pg_temp.foto(pg_temp.s('vC'), pg_temp.s('L'));
INSERT INTO _s SELECT 'vD', pg_temp.vender(jsonb_build_array(
  jsonb_build_object('descripcion', 'PROBE-410 libre', 'cantidad', 1, 'precioUnitario', 300,
                     'diasGarantia', 0, 'costo', 120)), 300);
INSERT INTO _r SELECT 42, 'item libre local: el costo del item se sigue tomando',
  '120', (SELECT pg_temp.n(costo_unitario_snapshot) FROM items_venta WHERE venta_id = pg_temp.s('vD'));

-- ── crear por convertir_cotizacion_venta_atomica (llamada posicional, sin cotizacion) ─
DO $$
DECLARE v_res JSONB;
BEGIN
  v_res := convertir_cotizacion_venta_atomica(
    'org-probe-410', 'usr-probe-410', NULL, 'PROBE 410', NULL, 12000, 0, 'MONTO', 0, 12000,
    'EFECTIVO', NULL, NULL, 1, 0, 12000,
    jsonb_build_array(pg_temp.linea_div(pg_temp.s('U'), 12000, 'USD', 10, 1200, 7250)),
    p_sucursal_id => pg_temp.s('suc'));
  INSERT INTO _s VALUES ('vE', v_res->>'ventaId');
END $$;
INSERT INTO _r SELECT 45, 'convertir_cotizacion_venta_atomica pasa la foto a crear_venta_atomica',
  'USD|10|1200|7250 / 1200|OFICIAL|12000|12000',
  pg_temp.foto(pg_temp.s('vE'), pg_temp.s('U')) || ' / ' || pg_temp.cabecera(pg_temp.s('vE'));

-- ── editar ─────────────────────────────────────────────────────────────────
-- Sin cambiar el precio de la linea USD: la foto sigue. Las claves de divisa no se mandan (el PUT
-- de la app no las manda para lineas existentes).
INSERT INTO _r SELECT 50, 'editar la venta mixta sin cambiar el precio de la linea USD',
  'ok', pg_temp.editar(pg_temp.s('vA'), jsonb_build_array(
    pg_temp.linea(pg_temp.s('L'), 1000), pg_temp.linea(pg_temp.s('U'), 12000)), 13000);
INSERT INTO _r SELECT 51, 'la linea USD conserva la foto y el costo',
  'USD|10|1200|7250', pg_temp.foto(pg_temp.s('vA'), pg_temp.s('U'));
INSERT INTO _r SELECT 52, 'la linea local sigue sin foto',
  'NULL|NULL|NULL|500', pg_temp.foto(pg_temp.s('vA'), pg_temp.s('L'));
INSERT INTO _r SELECT 53, 'la cabecera conserva la cotizacion y la edicion se aplico',
  '1200|OFICIAL|13000|13000|editada-410',
  pg_temp.cabecera(pg_temp.s('vA')) || '|' || COALESCE((SELECT observaciones FROM ventas WHERE id = pg_temp.s('vA')), 'NULL');

-- Cambiando el precio de la linea USD: la foto se pierde (el costo local se conserva, como siempre).
INSERT INTO _r SELECT 54, 'editar la venta mixta cambiando el precio de la linea USD',
  'ok', pg_temp.editar(pg_temp.s('vA'), jsonb_build_array(
    pg_temp.linea(pg_temp.s('L'), 1000), pg_temp.linea(pg_temp.s('U'), 13000)), 14000);
INSERT INTO _r SELECT 55, 'la linea USD queda sin foto',
  'NULL|NULL|NULL|7250', pg_temp.foto(pg_temp.s('vA'), pg_temp.s('U'));
INSERT INTO _r SELECT 56, 'ventas.tipo_cambio y la fuente no se tocan aunque no quede linea con foto',
  '1200|OFICIAL|14000|14000', pg_temp.cabecera(pg_temp.s('vA'));

-- Fallback de costo desde el inventario: un producto en divisa no da costo local.
INSERT INTO _r SELECT 57, 'editar la venta del producto USD sin costo guardado',
  'ok', pg_temp.editar(pg_temp.s('vB'), jsonb_build_array(pg_temp.linea(pg_temp.s('U'), 12000)), 12000);
INSERT INTO _r SELECT 58, 'el fallback al inventario en divisa deja el costo NULL',
  'NULL|NULL|NULL|NULL', pg_temp.foto(pg_temp.s('vB'), pg_temp.s('U'));
INSERT INTO _r SELECT 59, 'editar agregando el producto local a esa venta: su costo sale del inventario',
  'ok / NULL|NULL|NULL|500', pg_temp.editar(pg_temp.s('vB'), jsonb_build_array(
    pg_temp.linea(pg_temp.s('U'), 12000), pg_temp.linea(pg_temp.s('L'), 1000)), 13000)
  || ' / ' || pg_temp.foto(pg_temp.s('vB'), pg_temp.s('L'));

-- ── Rollback rehearsal (last: it replaces both functions until the ROLLBACK) ─
-- ROLLBACK:BEGIN
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.crear_venta_atomica(p_org_id text, p_vendedor_id text, p_cliente_id text, p_cliente_nombre text, p_cliente_telefono text, p_subtotal numeric, p_descuento numeric, p_tipo_descuento text, p_porcentaje_descuento numeric, p_total numeric, p_metodo_pago text, p_observaciones text, p_numero_referencia text, p_cuotas integer, p_recargo_porcentaje numeric, p_monto_original numeric, p_items jsonb, p_pagos jsonb DEFAULT NULL::jsonb, p_idempotency_key text DEFAULT NULL::text, p_deposito_id text DEFAULT NULL::text, p_sucursal_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_venta_id TEXT;
  v_numero_venta INTEGER;
  v_item JSONB;
  v_pago JSONB;
  v_item_id TEXT;
  v_inv_stock INTEGER;
  v_inv_nombre TEXT;
  v_inv_costo DECIMAL;
  v_garantia_numero TEXT;
  v_garantias JSONB := '[]'::JSONB;
  v_items_ids JSONB := '[]'::JSONB;
  v_metodo metodo_pago_venta;
  v_total_pagos DECIMAL := 0;
  v_monto_abonado DECIMAL;
  v_estado_pago TEXT;
  v_cc_result JSONB;
  v_total_costo_mercaderia DECIMAL := 0;
  v_inv_id TEXT;
  v_req_total INTEGER;
  v_rows INTEGER;
  v_trackea_series BOOLEAN;
  v_serie_ids_in JSONB;
  v_serie_ids_out TEXT[];
  v_dias_garantia INTEGER;
  v_deposito_efectivo TEXT;
  -- Fase 5: deposito a usar cuando no se pasa uno explicito = principal de la sucursal
  v_dep_objetivo TEXT;
  -- 332: costo financiero de cada pago
  v_cf_pct DECIMAL;
BEGIN
  v_metodo := p_metodo_pago::metodo_pago_venta;

  -- 332: el cliente tiene que ser de la organizacion. Sin esto se podia cargar
  -- la deuda de una venta (o descontar saldo a favor) a un cliente de otra.
  IF NULLIF(p_cliente_id, '') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM clientes WHERE id = p_cliente_id AND organization_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'Cliente no encontrado';
  END IF;

  -- 332: "saldo a favor" (CUENTA_CORRIENTE) sin cliente quedaba cobrado sin
  -- descontar nada de ningun lado.
  IF NULLIF(p_cliente_id, '') IS NULL AND (
       (p_pagos IS NOT NULL AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(p_pagos) AS p WHERE p->>'metodo' = 'CUENTA_CORRIENTE'))
    OR (p_pagos IS NULL AND p_metodo_pago = 'CUENTA_CORRIENTE')
  ) THEN
    RAISE EXCEPTION 'Para cobrar con saldo a favor la venta tiene que tener un cliente';
  END IF;

  -- Resolver el deposito objetivo: explicito, o el principal de la sucursal.
  v_dep_objetivo := COALESCE(p_deposito_id, get_deposito_de_sucursal(p_sucursal_id));

  SELECT get_next_sale_number(p_org_id) INTO v_numero_venta;

  FOR v_inv_id, v_req_total IN
    SELECT (it->>'inventarioId'),
           SUM((it->>'cantidad')::INTEGER)
    FROM jsonb_array_elements(p_items) AS it
    WHERE (it->>'inventarioId') IS NOT NULL AND (it->>'inventarioId') != ''
    GROUP BY (it->>'inventarioId')
  LOOP
    -- 406: lo vendible es stock - stock_reservado. La reserva la toman las
    -- cotizaciones aprobadas, el catalogo publico y los repuestos de ordenes;
    -- vender por encima dejaba esas reservas sin mercaderia que las respalde.
    SELECT stock - GREATEST(COALESCE(stock_reservado, 0), 0), nombre
      INTO v_inv_stock, v_inv_nombre
    FROM inventario
    WHERE id = v_inv_id
      AND organization_id = p_org_id
    FOR UPDATE;

    IF v_inv_stock IS NULL THEN
      RAISE EXCEPTION 'Producto no encontrado: %', v_inv_id;
    END IF;

    IF v_inv_stock < v_req_total THEN
      RAISE EXCEPTION 'Stock insuficiente para "%". Disponible: %, solicitado: %',
        v_inv_nombre, v_inv_stock, v_req_total
        USING ERRCODE = 'P0003';
    END IF;
  END LOOP;

  IF p_pagos IS NOT NULL AND jsonb_array_length(p_pagos) > 0 THEN
    SELECT COALESCE(SUM((p->>'monto')::DECIMAL), 0) INTO v_total_pagos
    FROM jsonb_array_elements(p_pagos) AS p;
    v_monto_abonado := v_total_pagos;
  ELSIF p_pagos IS NOT NULL THEN
    v_monto_abonado := 0;
  ELSE
    v_monto_abonado := p_total;
  END IF;

  IF v_monto_abonado >= p_total THEN
    v_estado_pago := 'PAGADO';
  ELSIF v_monto_abonado > 0 THEN
    v_estado_pago := 'PAGADO_PARCIAL';
  ELSE
    v_estado_pago := 'PENDIENTE';
  END IF;

  INSERT INTO ventas (
    numero_venta, cliente_id, cliente_nombre, cliente_telefono,
    vendedor_id, subtotal, descuento, tipo_descuento, porcentaje_descuento,
    total, metodo_pago, monto_abonado, estado_pago, observaciones, organization_id,
    idempotency_key, sucursal_id
  ) VALUES (
    v_numero_venta,
    NULLIF(p_cliente_id, ''),
    p_cliente_nombre,
    NULLIF(p_cliente_telefono, ''),
    p_vendedor_id,
    p_subtotal,
    p_descuento,
    COALESCE(p_tipo_descuento, 'MONTO'),
    COALESCE(p_porcentaje_descuento, 0),
    p_total,
    v_metodo,
    v_monto_abonado,
    v_estado_pago,
    NULLIF(p_observaciones, ''),
    p_org_id,
    NULLIF(p_idempotency_key, ''),
    p_sucursal_id
  ) RETURNING id INTO v_venta_id;

  IF p_pagos IS NOT NULL AND jsonb_array_length(p_pagos) > 0 THEN
    FOR v_pago IN SELECT * FROM jsonb_array_elements(p_pagos)
    LOOP
      IF (v_pago->>'metodo') = 'CUENTA_CORRIENTE' AND p_cliente_id IS NOT NULL AND p_cliente_id != '' THEN
        SELECT usar_cuenta_corriente(
          p_org_id,
          p_cliente_id,
          (v_pago->>'monto')::DECIMAL,
          'VENTA',
          v_venta_id,
          p_vendedor_id,
          p_sucursal_id
        ) INTO v_cc_result;
      END IF;

      -- 332: costo de la terminal (lo que absorbe el comercio). El POS lo pide
      -- en el cobro pero no se guardaba: la rentabilidad lo ignoraba.
      v_cf_pct := NULLIF((v_pago->>'costoFinanciero')::DECIMAL, 0);

      INSERT INTO pagos_venta (
        venta_id, monto, metodo_pago, numero_referencia, cuotas, recargo_porcentaje, monto_original,
        costo_financiero_porcentaje, costo_financiero_monto
      )
      VALUES (
        v_venta_id,
        (v_pago->>'monto')::DECIMAL,
        (v_pago->>'metodo')::metodo_pago_venta,
        NULLIF(v_pago->>'referencia', ''),
        (v_pago->>'cuotas')::INTEGER,
        (v_pago->>'recargo')::DECIMAL,
        (v_pago->>'montoOriginal')::DECIMAL,
        v_cf_pct,
        CASE WHEN v_cf_pct > 0 THEN ROUND((v_pago->>'monto')::DECIMAL * v_cf_pct / 100.0, 2) END
      );
    END LOOP;
  ELSIF p_pagos IS NULL THEN
    INSERT INTO pagos_venta (venta_id, monto, metodo_pago, numero_referencia, cuotas, recargo_porcentaje, monto_original)
    VALUES (
      v_venta_id,
      p_total,
      v_metodo,
      NULLIF(p_numero_referencia, ''),
      p_cuotas,
      p_recargo_porcentaje,
      p_monto_original
    );
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_inv_costo := NULL;
    IF (v_item->>'inventarioId') IS NOT NULL AND (v_item->>'inventarioId') != '' THEN
      SELECT precio_compra INTO v_inv_costo
      FROM inventario
      WHERE id = (v_item->>'inventarioId');
    END IF;

    IF v_inv_costo IS NULL AND (v_item ? 'costo') AND (v_item->>'costo') IS NOT NULL THEN
      v_inv_costo := (v_item->>'costo')::DECIMAL;
    END IF;

    INSERT INTO items_venta (
      venta_id, inventario_id, descripcion, cantidad, precio_unitario, subtotal,
      dias_garantia, descuento, tipo_descuento, porcentaje_descuento,
      costo_unitario_snapshot
    ) VALUES (
      v_venta_id,
      NULLIF(v_item->>'inventarioId', ''),
      v_item->>'descripcion',
      (v_item->>'cantidad')::INTEGER,
      (v_item->>'precioUnitario')::DECIMAL,
      (v_item->>'cantidad')::INTEGER * (v_item->>'precioUnitario')::DECIMAL,
      COALESCE((v_item->>'diasGarantia')::INTEGER, 0),
      COALESCE((v_item->>'descuento')::DECIMAL, 0),
      COALESCE(v_item->>'tipoDescuento', 'MONTO'),
      COALESCE((v_item->>'porcentajeDescuento')::DECIMAL, 0),
      v_inv_costo
    ) RETURNING id INTO v_item_id;

    v_items_ids := v_items_ids || to_jsonb(v_item_id);

    IF v_inv_costo IS NOT NULL THEN
      v_total_costo_mercaderia := v_total_costo_mercaderia + (v_inv_costo * (v_item->>'cantidad')::INTEGER);
    END IF;

    IF (v_item->>'inventarioId') IS NOT NULL AND (v_item->>'inventarioId') != '' THEN
      INSERT INTO movimientos_inventario (
        inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id, organization_id,
        deposito_id
      )
      SELECT
        (v_item->>'inventarioId'),
        'VENTA',
        -(v_item->>'cantidad')::INTEGER,
        stock,
        stock - (v_item->>'cantidad')::INTEGER,
        v_venta_id,
        'VENTA',
        p_vendedor_id,
        p_org_id,
        NULL
      FROM inventario WHERE id = (v_item->>'inventarioId');

      UPDATE inventario
      SET stock = stock - (v_item->>'cantidad')::INTEGER
      WHERE id = (v_item->>'inventarioId')
        AND stock >= (v_item->>'cantidad')::INTEGER;

      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN
        RAISE EXCEPTION 'Stock insuficiente al descontar item "%"', v_item->>'descripcion'
          USING ERRCODE = 'P0003';
      END IF;

      -- Fase 5: usar el deposito objetivo resuelto (explicito o principal de sucursal).
      v_deposito_efectivo := descontar_stock_deposito(
        (v_item->>'inventarioId'), p_org_id, v_dep_objetivo,
        (v_item->>'cantidad')::INTEGER,
        p_deposito_id IS NOT NULL);

      UPDATE movimientos_inventario
      SET deposito_id = v_deposito_efectivo
      WHERE referencia_id = v_venta_id
        AND inventario_id = (v_item->>'inventarioId')
        AND tipo = 'VENTA'
        AND deposito_id IS NULL;
    END IF;

    IF (v_item->>'inventarioId') IS NOT NULL AND (v_item->>'inventarioId') != '' THEN
      SELECT trackea_series INTO v_trackea_series
      FROM inventario WHERE id = (v_item->>'inventarioId');

      IF COALESCE(v_trackea_series, false) THEN
        v_dias_garantia := COALESCE((v_item->>'diasGarantia')::INTEGER, 0);
        v_serie_ids_in := v_item->'serieIds';
        v_serie_ids_out := ARRAY[]::TEXT[];

        IF v_serie_ids_in IS NOT NULL AND jsonb_typeof(v_serie_ids_in) = 'array'
           AND jsonb_array_length(v_serie_ids_in) > 0 THEN
          IF jsonb_array_length(v_serie_ids_in) <> (v_item->>'cantidad')::INTEGER THEN
            RAISE EXCEPTION 'Cantidad de series (%) no coincide con cantidad del item "%" (%)',
              jsonb_array_length(v_serie_ids_in), v_item->>'descripcion', v_item->>'cantidad'
              USING ERRCODE = '22023';
          END IF;

          SELECT array_agg(s.id) INTO v_serie_ids_out
          FROM inventario_series s
          WHERE s.id IN (SELECT jsonb_array_elements_text(v_serie_ids_in))
            AND s.inventario_id = (v_item->>'inventarioId')
            AND s.organization_id = p_org_id
            AND s.estado = 'DISPONIBLE'
          FOR UPDATE;

          IF v_serie_ids_out IS NULL
             OR array_length(v_serie_ids_out, 1) <> (v_item->>'cantidad')::INTEGER THEN
            RAISE EXCEPTION 'Series seleccionadas invalidas o no disponibles para "%"',
              v_item->>'descripcion'
              USING ERRCODE = 'P0003';
          END IF;
        ELSE
          SELECT array_agg(s.id) INTO v_serie_ids_out
          FROM (
            SELECT id FROM inventario_series
            WHERE inventario_id = (v_item->>'inventarioId')
              AND organization_id = p_org_id
              AND estado = 'DISPONIBLE'
            ORDER BY created_at ASC
            LIMIT (v_item->>'cantidad')::INTEGER
            FOR UPDATE
          ) s;

          IF v_serie_ids_out IS NULL
             OR array_length(v_serie_ids_out, 1) <> (v_item->>'cantidad')::INTEGER THEN
            RAISE EXCEPTION 'Producto serializado "%" sin series suficientes disponibles (necesita %)',
              v_item->>'descripcion', v_item->>'cantidad'
              USING ERRCODE = 'P0003';
          END IF;
        END IF;

        UPDATE inventario_series
          SET estado = CASE WHEN v_dias_garantia > 0 THEN 'GARANTIA_ACTIVA' ELSE 'VENDIDO' END,
              venta_id = v_venta_id,
              cliente_id = NULLIF(p_cliente_id, ''),
              fecha_venta = NOW(),
              fecha_garantia_vence = CASE
                WHEN v_dias_garantia > 0 THEN CURRENT_DATE + v_dias_garantia
                ELSE fecha_garantia_vence END,
              updated_at = NOW()
          WHERE id = ANY(v_serie_ids_out);

        UPDATE movimientos_inventario
          SET serie_ids = v_serie_ids_out
          WHERE referencia_id = v_venta_id
            AND inventario_id = (v_item->>'inventarioId')
            AND tipo = 'VENTA';
      END IF;
    END IF;

    IF COALESCE((v_item->>'diasGarantia')::INTEGER, 0) > 0 THEN
      SELECT get_next_warranty_sale_number(p_org_id) INTO v_garantia_numero;

      INSERT INTO garantias_venta (
        venta_id, item_venta_id, numero_garantia, dias_validez,
        fecha_inicio, fecha_vencimiento, organization_id
      ) VALUES (
        v_venta_id, v_item_id, v_garantia_numero,
        (v_item->>'diasGarantia')::INTEGER,
        NOW(),
        NOW() + ((v_item->>'diasGarantia')::INTEGER || ' days')::INTERVAL,
        p_org_id
      );

      v_garantias := v_garantias || jsonb_build_object(
        'numero', v_garantia_numero,
        'itemId', v_item_id,
        'diasValidez', (v_item->>'diasGarantia')::INTEGER
      );
    END IF;
  END LOOP;

  -- NOTA: el egreso automático de COGS en movimientos_caja se eliminó en la mig 230.
  -- Era un asiento contable, no efectivo real, y contaminaba el arqueo de caja.
  -- El costo de mercadería sigue disponible vía items_venta.costo_unitario_snapshot,
  -- que es lo que consumen los reportes de rentabilidad.

  -- Saldo pendiente -> deuda en cuenta corriente del cliente
  IF p_cliente_id IS NOT NULL AND p_cliente_id != '' AND (p_total - v_monto_abonado) > 0 THEN
    PERFORM cargar_deuda_cuenta_corriente(
      p_org_id, p_cliente_id, (p_total - v_monto_abonado),
      'VENTA', v_venta_id, p_vendedor_id, p_sucursal_id);
  END IF;

  RETURN jsonb_build_object(
    'ventaId', v_venta_id,
    'numeroVenta', v_numero_venta,
    'garantias', v_garantias,
    'items', v_items_ids
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION editar_venta_atomica(
  p_org_id TEXT,
  p_user_id TEXT,
  p_venta_id TEXT,
  p_cliente_id TEXT,
  p_cliente_nombre TEXT,
  p_cliente_telefono TEXT,
  p_subtotal DECIMAL,
  p_descuento DECIMAL,
  p_tipo_descuento TEXT,
  p_porcentaje_descuento DECIMAL,
  p_total DECIMAL,
  p_metodo_pago TEXT,
  p_observaciones TEXT,
  p_items JSONB,
  p_deposito_id TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_venta ventas%ROWTYPE;
  v_old_item RECORD;
  v_item JSONB;
  v_item_id TEXT;
  v_inv_stock INTEGER;
  v_inv_nombre TEXT;
  v_inv_costo DECIMAL;
  v_garantia_numero TEXT;
  v_metodo metodo_pago_venta;
  v_garantias JSONB := '[]'::JSONB;
  v_deposito_efectivo TEXT;
  v_dep_origen TEXT;
  v_dep_objetivo TEXT;
  v_inv_id TEXT;
  v_req_total INTEGER;
  v_cliente_id TEXT;
  v_abonado DECIMAL;
  v_pend_old DECIMAL;
  v_pend_new DECIMAL;
  v_delta DECIMAL;
  v_estado_pago TEXT;
  v_saldo DECIMAL;
  v_nuevo_saldo DECIMAL;
  v_clave TEXT;
  v_costos JSONB;
  v_numeros JSONB;
  v_lista JSONB;
BEGIN
  v_metodo := p_metodo_pago::metodo_pago_venta;
  v_cliente_id := NULLIF(p_cliente_id, '');

  SELECT * INTO v_venta
  FROM ventas
  WHERE id = p_venta_id AND organization_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venta no encontrada: %', p_venta_id;
  END IF;

  IF v_venta.estado::text = 'ANULADA' THEN
    RAISE EXCEPTION 'No se puede editar una venta anulada';
  END IF;

  -- ------------------------------------------------------------------
  -- 1. Lo que impide editar (mismo orden y textos que lib/ventas/bloqueos.ts)
  -- ------------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM comprobantes_fiscales
             WHERE venta_id = p_venta_id AND estado IN ('pendiente', 'emitido') AND comprobante_asociado_id IS NULL) THEN
    RAISE EXCEPTION 'VENTA_NO_EDITABLE: La venta tiene una factura electrónica emitida.'
      USING ERRCODE = 'P0021';
  END IF;
  IF EXISTS (SELECT 1 FROM facturas
             WHERE venta_id = p_venta_id AND estado_pago::text <> 'ANULADA') THEN
    RAISE EXCEPTION 'VENTA_NO_EDITABLE: La venta tiene un remito generado.'
      USING ERRCODE = 'P0021';
  END IF;
  IF EXISTS (SELECT 1 FROM devoluciones_venta WHERE venta_id = p_venta_id) THEN
    RAISE EXCEPTION 'VENTA_NO_EDITABLE: La venta tiene devoluciones registradas.'
      USING ERRCODE = 'P0021';
  END IF;
  IF EXISTS (SELECT 1 FROM notas_credito WHERE venta_id = p_venta_id AND NOT anulada) THEN
    RAISE EXCEPTION 'VENTA_NO_EDITABLE: La venta tiene una nota de crédito.'
      USING ERRCODE = 'P0021';
  END IF;
  IF COALESCE(v_venta.comision_pagada, false) THEN
    RAISE EXCEPTION 'VENTA_NO_EDITABLE: La comisión de esta venta ya se liquidó al vendedor.'
      USING ERRCODE = 'P0021';
  END IF;
  IF EXISTS (SELECT 1 FROM inventario_series WHERE venta_id = p_venta_id) THEN
    RAISE EXCEPTION 'VENTA_NO_EDITABLE: La venta tiene productos con número de serie.'
      USING ERRCODE = 'P0021';
  END IF;

  -- Los productos con numero de serie se venden desde el POS, que asigna las
  -- series; esta funcion no las maneja.
  SELECT i.nombre INTO v_inv_nombre
  FROM jsonb_array_elements(p_items) AS it
  JOIN inventario i ON i.id = (it->>'inventarioId')
  WHERE i.organization_id = p_org_id AND COALESCE(i.trackea_series, false)
  LIMIT 1;
  IF v_inv_nombre IS NOT NULL THEN
    RAISE EXCEPTION 'VENTA_NO_EDITABLE: "%" tiene número de serie: vendelo desde el POS.', v_inv_nombre
      USING ERRCODE = 'P0021';
  END IF;

  IF v_cliente_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM clientes WHERE id = v_cliente_id AND organization_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'Cliente no encontrado';
  END IF;

  -- ------------------------------------------------------------------
  -- 2. Cobros: lo cobrado no cambia; el saldo pendiente se recalcula
  -- ------------------------------------------------------------------
  v_abonado := COALESCE(v_venta.monto_abonado, 0);
  IF p_total < v_abonado THEN
    RAISE EXCEPTION 'VENTA_NO_EDITABLE: El nuevo total (%) es menor a lo ya cobrado (%). Para devolver dinero registrá una devolución.',
      ROUND(p_total::NUMERIC, 2), ROUND(v_abonado::NUMERIC, 2)
      USING ERRCODE = 'P0021';
  END IF;
  v_pend_old := GREATEST(v_venta.total - v_abonado, 0);
  v_pend_new := GREATEST(p_total - v_abonado, 0);

  IF v_pend_old > 0 AND v_venta.cliente_id IS NOT NULL
     AND v_cliente_id IS DISTINCT FROM v_venta.cliente_id THEN
    RAISE EXCEPTION 'VENTA_NO_EDITABLE: La venta tiene saldo pendiente en la cuenta del cliente: no se puede cambiar el cliente.'
      USING ERRCODE = 'P0021';
  END IF;

  v_estado_pago := CASE
    WHEN v_abonado >= p_total THEN 'PAGADO'
    WHEN v_abonado > 0 THEN 'PAGADO_PARCIAL'
    ELSE 'PENDIENTE'
  END;

  -- ------------------------------------------------------------------
  -- 3. Lo que se conserva de los items viejos: costo y numero de garantia,
  --    por producto (o por descripcion si es un item libre).
  -- ------------------------------------------------------------------
  SELECT COALESCE(jsonb_object_agg(clave, costo), '{}'::JSONB) INTO v_costos
  FROM (
    SELECT DISTINCT ON (1)
      COALESCE(iv.inventario_id, 'desc:' || lower(COALESCE(iv.descripcion, ''))) AS clave,
      iv.costo_unitario_snapshot AS costo
    FROM items_venta iv
    WHERE iv.venta_id = p_venta_id AND iv.costo_unitario_snapshot IS NOT NULL
    ORDER BY 1, iv.id
  ) c;

  SELECT COALESCE(jsonb_object_agg(clave, numeros), '{}'::JSONB) INTO v_numeros
  FROM (
    SELECT COALESCE(iv.inventario_id, 'desc:' || lower(COALESCE(iv.descripcion, ''))) AS clave,
           jsonb_agg(g.numero_garantia ORDER BY g.created_at, g.numero_garantia) AS numeros
    FROM garantias_venta g
    JOIN items_venta iv ON iv.id = g.item_venta_id
    WHERE g.venta_id = p_venta_id
    GROUP BY 1
  ) n;

  -- ------------------------------------------------------------------
  -- 4. Devolver el stock de los items viejos al deposito del que salieron
  -- ------------------------------------------------------------------
  FOR v_old_item IN
    SELECT iv.inventario_id, iv.cantidad, i.stock
    FROM items_venta iv
    LEFT JOIN inventario i ON i.id = iv.inventario_id
    WHERE iv.venta_id = p_venta_id AND iv.inventario_id IS NOT NULL
  LOOP
    SELECT m.deposito_id INTO v_dep_origen
    FROM movimientos_inventario m
    WHERE m.referencia_id = p_venta_id AND m.tipo = 'VENTA'
      AND m.inventario_id = v_old_item.inventario_id
    ORDER BY m.created_at DESC LIMIT 1;

    INSERT INTO movimientos_inventario (
      inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id, organization_id, observaciones,
      deposito_id
    ) VALUES (
      v_old_item.inventario_id, 'ANULACION', v_old_item.cantidad,
      v_old_item.stock, v_old_item.stock + v_old_item.cantidad,
      p_venta_id, 'EDICION_VENTA', p_user_id, p_org_id,
      'Restauración por edición de venta',
      v_dep_origen
    );

    UPDATE inventario SET stock = stock + v_old_item.cantidad
    WHERE id = v_old_item.inventario_id;

    PERFORM incrementar_stock_deposito(
      v_old_item.inventario_id, p_org_id, v_dep_origen, v_old_item.cantidad);
  END LOOP;

  DELETE FROM garantias_venta WHERE venta_id = p_venta_id;
  DELETE FROM items_venta WHERE venta_id = p_venta_id;

  -- ------------------------------------------------------------------
  -- 5. Cabecera
  -- ------------------------------------------------------------------
  UPDATE ventas SET
    cliente_id = v_cliente_id,
    cliente_nombre = p_cliente_nombre,
    cliente_telefono = NULLIF(p_cliente_telefono, ''),
    subtotal = p_subtotal,
    descuento = p_descuento,
    tipo_descuento = COALESCE(p_tipo_descuento, 'MONTO'),
    porcentaje_descuento = COALESCE(p_porcentaje_descuento, 0),
    total = p_total,
    metodo_pago = v_metodo,
    estado_pago = v_estado_pago,
    observaciones = NULLIF(p_observaciones, ''),
    updated_at = NOW()
  WHERE id = p_venta_id AND organization_id = p_org_id;

  -- ------------------------------------------------------------------
  -- 6. Stock de los items nuevos (acumulado por producto)
  -- ------------------------------------------------------------------
  v_dep_objetivo := COALESCE(p_deposito_id, get_deposito_de_sucursal(v_venta.sucursal_id));

  FOR v_inv_id, v_req_total IN
    SELECT (it->>'inventarioId'),
           SUM((it->>'cantidad')::INTEGER)
    FROM jsonb_array_elements(p_items) AS it
    WHERE (it->>'inventarioId') IS NOT NULL AND (it->>'inventarioId') != ''
    GROUP BY (it->>'inventarioId')
  LOOP
    SELECT stock, nombre INTO v_inv_stock, v_inv_nombre
    FROM inventario
    WHERE id = v_inv_id
      AND organization_id = p_org_id
      AND deleted_at IS NULL
    FOR UPDATE;

    IF v_inv_stock IS NULL THEN
      RAISE EXCEPTION 'Producto no encontrado: %', v_inv_id;
    END IF;

    IF v_inv_stock < v_req_total THEN
      RAISE EXCEPTION 'Stock insuficiente para "%". Disponible: %, solicitado: %',
        v_inv_nombre, v_inv_stock, v_req_total
        USING ERRCODE = 'P0003';
    END IF;
  END LOOP;

  -- ------------------------------------------------------------------
  -- 7. Items nuevos, movimientos y garantias
  -- ------------------------------------------------------------------
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_clave := COALESCE(NULLIF(v_item->>'inventarioId', ''), 'desc:' || lower(COALESCE(v_item->>'descripcion', '')));

    v_inv_costo := (v_costos->>v_clave)::DECIMAL;
    IF v_inv_costo IS NULL AND NULLIF(v_item->>'inventarioId', '') IS NOT NULL THEN
      SELECT precio_compra INTO v_inv_costo
      FROM inventario WHERE id = (v_item->>'inventarioId');
    END IF;

    INSERT INTO items_venta (
      venta_id, inventario_id, descripcion, cantidad, precio_unitario, subtotal,
      dias_garantia, descuento, tipo_descuento, porcentaje_descuento,
      costo_unitario_snapshot
    ) VALUES (
      p_venta_id,
      NULLIF(v_item->>'inventarioId', ''),
      v_item->>'descripcion',
      (v_item->>'cantidad')::INTEGER,
      (v_item->>'precioUnitario')::DECIMAL,
      (v_item->>'cantidad')::INTEGER * (v_item->>'precioUnitario')::DECIMAL,
      COALESCE((v_item->>'diasGarantia')::INTEGER, 0),
      COALESCE((v_item->>'descuento')::DECIMAL, 0),
      COALESCE(v_item->>'tipoDescuento', 'MONTO'),
      COALESCE((v_item->>'porcentajeDescuento')::DECIMAL, 0),
      v_inv_costo
    ) RETURNING id INTO v_item_id;

    IF NULLIF(v_item->>'inventarioId', '') IS NOT NULL THEN
      INSERT INTO movimientos_inventario (
        inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id, organization_id,
        deposito_id
      )
      SELECT
        (v_item->>'inventarioId'), 'VENTA', -(v_item->>'cantidad')::INTEGER,
        stock, stock - (v_item->>'cantidad')::INTEGER,
        p_venta_id, 'VENTA', p_user_id, p_org_id,
        NULL
      FROM inventario WHERE id = (v_item->>'inventarioId');

      UPDATE inventario SET stock = stock - (v_item->>'cantidad')::INTEGER
      WHERE id = (v_item->>'inventarioId');

      v_deposito_efectivo := descontar_stock_deposito(
        (v_item->>'inventarioId'), p_org_id, v_dep_objetivo,
        (v_item->>'cantidad')::INTEGER,
        p_deposito_id IS NOT NULL);

      UPDATE movimientos_inventario
      SET deposito_id = v_deposito_efectivo
      WHERE referencia_id = p_venta_id
        AND inventario_id = (v_item->>'inventarioId')
        AND tipo = 'VENTA'
        AND deposito_id IS NULL;
    END IF;

    IF COALESCE((v_item->>'diasGarantia')::INTEGER, 0) > 0 THEN
      v_lista := v_numeros->v_clave;
      IF v_lista IS NOT NULL AND jsonb_array_length(v_lista) > 0 THEN
        v_garantia_numero := v_lista->>0;
        v_numeros := jsonb_set(v_numeros, ARRAY[v_clave], v_lista - 0);
      ELSE
        SELECT get_next_warranty_sale_number(p_org_id) INTO v_garantia_numero;
      END IF;

      INSERT INTO garantias_venta (
        venta_id, item_venta_id, numero_garantia, dias_validez,
        fecha_inicio, fecha_vencimiento, organization_id
      ) VALUES (
        p_venta_id, v_item_id, v_garantia_numero,
        (v_item->>'diasGarantia')::INTEGER,
        v_venta.created_at,
        v_venta.created_at + ((v_item->>'diasGarantia')::INTEGER || ' days')::INTERVAL,
        p_org_id
      );

      v_garantias := v_garantias || jsonb_build_object(
        'numero', v_garantia_numero,
        'itemId', v_item_id,
        'diasValidez', (v_item->>'diasGarantia')::INTEGER
      );
    END IF;
  END LOOP;

  -- ------------------------------------------------------------------
  -- 8. Deuda del cliente. Mismo cliente: la diferencia de saldo pendiente.
  --    Cliente nuevo (la venta no tenia deuda en ninguna cuenta, ver el
  --    control del paso 2): todo el saldo pendiente.
  -- ------------------------------------------------------------------
  v_delta := 0;
  IF v_cliente_id IS NOT NULL THEN
    v_delta := CASE
      WHEN v_venta.cliente_id IS NOT DISTINCT FROM v_cliente_id THEN v_pend_new - v_pend_old
      ELSE v_pend_new
    END;
  END IF;
  IF v_delta <> 0 THEN
    SELECT saldo_cuenta INTO v_saldo
    FROM clientes WHERE id = v_cliente_id AND organization_id = p_org_id
    FOR UPDATE;

    v_nuevo_saldo := COALESCE(v_saldo, 0) - v_delta;

    INSERT INTO cuenta_corriente (
      organization_id, cliente_id, tipo, monto, saldo_posterior,
      referencia_tipo, referencia_id, usuario_id, observaciones,
      sucursal_id
    ) VALUES (
      p_org_id, v_cliente_id, 'CARGO', -v_delta, v_nuevo_saldo,
      'VENTA', p_venta_id, p_user_id,
      'Ajuste por edición de la venta',
      v_venta.sucursal_id
    );

    UPDATE clientes SET saldo_cuenta = v_nuevo_saldo WHERE id = v_cliente_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'garantias', v_garantias,
    'estadoPago', v_estado_pago,
    'montoAbonado', v_abonado,
    'ajusteCuentaCorriente', v_delta
  );
END;
$$ LANGUAGE plpgsql;
-- ROLLBACK:END
INSERT INTO _r SELECT 80, 'rehearsal: ninguna de las dos funciones menciona moneda_origen',
  'crear_venta_atomica:false editar_venta_atomica:false',
  string_agg(p.proname || ':' || (pg_get_functiondef(p.oid) ~ 'moneda_origen')::TEXT, ' ' ORDER BY p.proname)
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('crear_venta_atomica', 'editar_venta_atomica');
INSERT INTO _s SELECT 'vR', pg_temp.vender(jsonb_build_array(
  pg_temp.linea_div(pg_temp.s('U'), 12000, 'USD', 10, 1200, 7250)), 12000);
INSERT INTO _r SELECT 81, 'rehearsal: la 406 ignora la foto y guarda el precio_compra crudo (6) como costo',
  'NULL|NULL|NULL|6 / NULL|NULL|12000|12000',
  pg_temp.foto(pg_temp.s('vR'), pg_temp.s('U')) || ' / ' || pg_temp.cabecera(pg_temp.s('vR'));

INSERT INTO _r SELECT 999, 'probe rows recorded (a missing row means a probe did not run)', '29', count(*)::TEXT FROM _r;

SELECT orden, probe, esperado, obtenido,
       CASE WHEN esperado = obtenido THEN 'OK' ELSE 'FALLA' END AS resultado
  FROM _r ORDER BY orden;

ROLLBACK;
