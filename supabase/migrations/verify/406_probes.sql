-- Probes de la migracion 406: el POS no vende stock reservado.
--
-- Correr DESPUES de aplicar la 406:
--   node scripts/db-run.mjs supabase/migrations/verify/406_probes.sql
-- (el BEGIN / ROLLBACK esta incluido: no queda nada; db-run rechaza --apply).
--
-- Usa la primera organizacion (por created_at), su sucursal principal, un
-- usuario y un cliente. Crea productos PROBE-406 dentro de la transaccion.
--
-- Verde = `esperado` igual a `obtenido` en cada fila.

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

DO $$
DECLARE
  v_org TEXT; v_dep TEXT; v_user TEXT; v_suc TEXT; v_cli TEXT;
  v_inv_a TEXT; v_inv_b TEXT; v_inv_d TEXT; v_inv_e TEXT;
  v_cot TEXT; v_cot2 TEXT; v_res JSONB; v_msg TEXT;
BEGIN
  SELECT id INTO v_org FROM organizations ORDER BY created_at LIMIT 1;
  SELECT get_deposito_principal(v_org) INTO v_dep;
  SELECT id INTO v_user FROM users WHERE organization_id = v_org LIMIT 1;
  SELECT id INTO v_suc FROM sucursales WHERE organization_id = v_org AND principal LIMIT 1;
  SELECT id INTO v_cli FROM clientes WHERE organization_id = v_org LIMIT 1;

  IF v_user IS NULL OR v_suc IS NULL OR v_dep IS NULL OR v_cli IS NULL THEN
    INSERT INTO _r VALUES (0, 'setup', 'ok', 'SALTEADO: la org no tiene usuario, sucursal, deposito o cliente');
    RETURN;
  END IF;

  -- A: stock 5, 3 reservados (por ejemplo, repuestos de una orden).
  INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, stock, stock_reservado, precio_venta)
  VALUES (v_org, 'PROBE-406-A', 'PROBE-406 A', 'PROBE', 50, 5, 3, 100) RETURNING id INTO v_inv_a;
  INSERT INTO inventario_depositos (inventario_id, deposito_id, stock, stock_reservado, organization_id)
  VALUES (v_inv_a, v_dep, 5, 3, v_org)
  ON CONFLICT (inventario_id, deposito_id) DO UPDATE SET stock = 5, stock_reservado = 3;

  -- 1: vender 3 cuando solo hay 2 libres se rechaza.
  v_msg := 'sin error';
  BEGIN
    PERFORM crear_venta_atomica(
      v_org, v_user, NULL, 'PROBE', NULL, 300, 0, 'MONTO', 0, 300, 'EFECTIVO', NULL, NULL, 1, 0, 300,
      jsonb_build_array(jsonb_build_object('inventarioId', v_inv_a, 'descripcion', 'PROBE-406 A',
        'cantidad', 3, 'precioUnitario', 100, 'diasGarantia', 0)),
      p_sucursal_id => v_suc);
  EXCEPTION WHEN SQLSTATE 'P0003' THEN
    v_msg := 'P0003 ' || (regexp_match(SQLERRM, 'Disponible: (\d+)'))[1];
  END;
  INSERT INTO _r VALUES (1, 'venta de 3 con 5 en stock y 3 reservados: P0003, disponible 2', 'P0003 2', v_msg);

  -- 2: vender 2 (lo libre) pasa y no toca la reserva.
  PERFORM crear_venta_atomica(
    v_org, v_user, NULL, 'PROBE', NULL, 200, 0, 'MONTO', 0, 200, 'EFECTIVO', NULL, NULL, 1, 0, 200,
    jsonb_build_array(jsonb_build_object('inventarioId', v_inv_a, 'descripcion', 'PROBE-406 A',
      'cantidad', 2, 'precioUnitario', 100, 'diasGarantia', 0)),
    p_sucursal_id => v_suc);
  INSERT INTO _r SELECT 2, 'venta de 2 libres: stock 5 -> 3, reservado sigue 3', '3/3',
    stock || '/' || stock_reservado FROM inventario WHERE id = v_inv_a;

  -- 3: dos lineas del mismo producto suman (1 + 1 > 0 libres).
  v_msg := 'sin error';
  BEGIN
    PERFORM crear_venta_atomica(
      v_org, v_user, NULL, 'PROBE', NULL, 100, 0, 'MONTO', 0, 100, 'EFECTIVO', NULL, NULL, 1, 0, 100,
      jsonb_build_array(jsonb_build_object('inventarioId', v_inv_a, 'descripcion', 'PROBE-406 A',
        'cantidad', 1, 'precioUnitario', 100, 'diasGarantia', 0)),
      p_sucursal_id => v_suc);
  EXCEPTION WHEN SQLSTATE 'P0003' THEN v_msg := 'P0003';
  END;
  INSERT INTO _r VALUES (3, 'con todo el stock reservado no se vende ni 1', 'P0003', v_msg);

  -- B: cotizacion interna que reserva TODO el stock (4 de 4) y se convierte.
  INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, stock, stock_reservado, precio_venta)
  VALUES (v_org, 'PROBE-406-B', 'PROBE-406 B', 'PROBE', 50, 4, 0, 100) RETURNING id INTO v_inv_b;
  INSERT INTO inventario_depositos (inventario_id, deposito_id, stock, stock_reservado, organization_id)
  VALUES (v_inv_b, v_dep, 4, 0, v_org)
  ON CONFLICT (inventario_id, deposito_id) DO UPDATE SET stock = 4, stock_reservado = 0;

  INSERT INTO cotizaciones (organization_id, cliente_id, numero_cotizacion,
                            tipo, estado, origen, subtotal, iva, total)
  VALUES (v_org, v_cli, 'PROBE-406-B', 'ORDEN', 'ACEPTADA', NULL, 400, 0, 400)
  RETURNING id INTO v_cot;
  INSERT INTO items_cotizacion (cotizacion_id, descripcion, cantidad, precio_unitario,
                                subtotal, unidad, inventario_id, tipo_repuesto)
  VALUES (v_cot, 'PROBE-406 B', 4, 100, 400, 'Unidad', v_inv_b, 'NO_APLICA');
  PERFORM reservar_items_cotizacion(v_cot, v_user);
  INSERT INTO _r SELECT 4, 'la cotizacion reservo los 4', '4', stock_reservado::TEXT
    FROM inventario WHERE id = v_inv_b;

  v_res := convertir_cotizacion_venta_atomica(
    v_org, v_user, v_cli, 'PROBE', NULL, 400, 0, 'MONTO', 0, 400, 'EFECTIVO', NULL, NULL, 1, 0, 400,
    jsonb_build_array(jsonb_build_object('inventarioId', v_inv_b, 'descripcion', 'PROBE-406 B',
      'cantidad', 4, 'precioUnitario', 100, 'diasGarantia', 0)),
    p_sucursal_id => v_suc, p_cotizacion_id => v_cot);
  INSERT INTO _r SELECT 5, 'convertir vende su propia reserva: stock 0, reservado 0', '0/0',
    stock || '/' || stock_reservado FROM inventario WHERE id = v_inv_b;
  INSERT INTO _r SELECT 6, 'la cotizacion queda ligada a la venta', 'true',
    (venta_id = v_res->>'ventaId')::TEXT FROM cotizaciones WHERE id = v_cot;

  -- D/E: la conversion falla por OTRO producto: la reserva propia no se pierde.
  INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, stock, stock_reservado, precio_venta)
  VALUES (v_org, 'PROBE-406-D', 'PROBE-406 D', 'PROBE', 50, 2, 0, 100) RETURNING id INTO v_inv_d;
  INSERT INTO inventario_depositos (inventario_id, deposito_id, stock, stock_reservado, organization_id)
  VALUES (v_inv_d, v_dep, 2, 0, v_org)
  ON CONFLICT (inventario_id, deposito_id) DO UPDATE SET stock = 2, stock_reservado = 0;
  INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, stock, stock_reservado, precio_venta)
  VALUES (v_org, 'PROBE-406-E', 'PROBE-406 E', 'PROBE', 50, 1, 0, 100) RETURNING id INTO v_inv_e;
  INSERT INTO inventario_depositos (inventario_id, deposito_id, stock, stock_reservado, organization_id)
  VALUES (v_inv_e, v_dep, 1, 0, v_org)
  ON CONFLICT (inventario_id, deposito_id) DO UPDATE SET stock = 1, stock_reservado = 0;

  INSERT INTO cotizaciones (organization_id, cliente_id, numero_cotizacion,
                            tipo, estado, origen, subtotal, iva, total)
  VALUES (v_org, v_cli, 'PROBE-406-D', 'ORDEN', 'ACEPTADA', NULL, 200, 0, 200)
  RETURNING id INTO v_cot2;
  INSERT INTO items_cotizacion (cotizacion_id, descripcion, cantidad, precio_unitario,
                                subtotal, unidad, inventario_id, tipo_repuesto)
  VALUES (v_cot2, 'PROBE-406 D', 2, 100, 200, 'Unidad', v_inv_d, 'NO_APLICA');
  PERFORM reservar_items_cotizacion(v_cot2, v_user);

  v_msg := 'sin error';
  BEGIN
    PERFORM convertir_cotizacion_venta_atomica(
      v_org, v_user, v_cli, 'PROBE', NULL, 700, 0, 'MONTO', 0, 700, 'EFECTIVO', NULL, NULL, 1, 0, 700,
      jsonb_build_array(
        jsonb_build_object('inventarioId', v_inv_d, 'descripcion', 'PROBE-406 D',
          'cantidad', 2, 'precioUnitario', 100, 'diasGarantia', 0),
        jsonb_build_object('inventarioId', v_inv_e, 'descripcion', 'PROBE-406 E',
          'cantidad', 5, 'precioUnitario', 100, 'diasGarantia', 0)),
      p_sucursal_id => v_suc, p_cotizacion_id => v_cot2);
  EXCEPTION WHEN SQLSTATE 'P0003' THEN v_msg := 'P0003';
  END;
  INSERT INTO _r VALUES (7, 'conversion sin stock de otro producto falla', 'P0003', v_msg);
  INSERT INTO _r SELECT 8, 'y la reserva de la cotizacion sigue intacta (2/2)', '2/2',
    stock || '/' || stock_reservado FROM inventario WHERE id = v_inv_d;
  INSERT INTO _r SELECT 9, 'y la cotizacion sigue sin venta', 'true',
    (venta_id IS NULL)::TEXT FROM cotizaciones WHERE id = v_cot2;
END $$;

SELECT orden, probe, esperado, obtenido,
       CASE WHEN esperado = obtenido THEN 'OK' ELSE 'FALLA' END AS resultado
  FROM _r ORDER BY orden;

ROLLBACK;
