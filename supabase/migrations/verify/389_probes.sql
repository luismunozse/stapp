-- Verificación de 389_factura_arca_en_vuelo.
--
-- Correr DESPUÉS de aplicar la 389:  node scripts/db-run.mjs supabase/migrations/verify/389_probes.sql
-- (sin --apply: el archivo abre su propia transacción y termina en ROLLBACK).
--
-- Sin RLS, como dice verify/README.md. Crea una organización de prueba (org-probe-389) con
-- algunas ventas y facturas, todo revertido al final. El CUIT es inventado (20000000001).
--
-- Qué prueba:
--   1-2  los dos índices existen, por nombre;
--   3-5  una sola factura numerada pendiente por CUIT + punto de venta + tipo
--        (otro punto de venta u otro tipo no chocan);
--   6    una pendiente legada (sin cbte_nro_solicitado) no cuenta;
--   7-8  un número de factura emitido no se puede registrar dos veces, ni como anulado;
--   9    la factura pendiente pasa a emitido con su número;
--   10   liberada esa pendiente, entra otra en el mismo CUIT/PV/tipo;
--   11-12 el CHECK: una factura con número pedido necesita CUIT emisor y el código
--        de su letra; una NC sigue igual que en la 371.
--
-- Resultado: UN select. Verde = esperado igual a obtenido.

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

CREATE PROCEDURE pg_temp.probe(p_orden INT, p_probe TEXT, p_esperado TEXT, p_sql TEXT)
LANGUAGE plpgsql AS $$
DECLARE v_got TEXT := 'ok'; v_cn TEXT; v_msg TEXT;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_cn = CONSTRAINT_NAME, v_msg = MESSAGE_TEXT;
    v_got := SQLSTATE || ' ' || COALESCE(NULLIF(v_cn, ''), v_msg);
  END;
  INSERT INTO _r VALUES (p_orden, p_probe, p_esperado, v_got);
END $$;

INSERT INTO organizations (id, nombre, nombre_mostrar, slug)
VALUES ('org-probe-389', 'Probe 389', 'Probe 389', 'probe-389-' || substr(md5(random()::text), 1, 8));

INSERT INTO users (id, organization_id, sucursal_id, email, nombre, password, rol)
VALUES ('usr-probe-389', 'org-probe-389',
        (SELECT id FROM sucursales WHERE organization_id = 'org-probe-389' AND principal),
        'admin@probe-389.invalid', 'Probe 389', 'x', 'ADMIN');

INSERT INTO ventas (id, numero_venta, cliente_nombre, vendedor_id, subtotal, total,
                    metodo_pago, estado, organization_id, sucursal_id, monto_abonado, estado_pago)
SELECT 'vta-probe-389-' || v.n, v.n, 'Probe 389', 'usr-probe-389', 1000, 1000,
       'EFECTIVO'::metodo_pago_venta, 'COMPLETADA'::estado_venta, 'org-probe-389',
       (SELECT id FROM sucursales WHERE organization_id = 'org-probe-389' AND principal), 1000, 'PAGADO'
FROM generate_series(1, 10) AS v(n);

-- Factura de prueba: (id, venta, punto de venta, tipo, estado, número, número pedido).
CREATE PROCEDURE pg_temp.factura(p_id TEXT, p_venta INT, p_pv INT, p_cbte INT, p_estado TEXT, p_numero TEXT, p_solicitado INT)
LANGUAGE sql AS $$
  INSERT INTO comprobantes_fiscales (id, organization_id, venta_id, tipo, punto_venta, numero, cae, cae_vencimiento,
                                     estado, total, provider, cbte_tipo, cuit_emisor, cbte_nro_solicitado, anulado_at)
  VALUES (p_id, 'org-probe-389', 'vta-probe-389-' || p_venta, CASE p_cbte WHEN 11 THEN 'C' ELSE 'B' END, p_pv, p_numero,
          CASE WHEN p_estado IN ('emitido', 'anulado') THEN 'CAE-' || p_id END,
          CASE WHEN p_estado IN ('emitido', 'anulado') THEN '20261130' END,
          p_estado, 1000, 'arca', p_cbte, '20000000001', p_solicitado,
          CASE WHEN p_estado = 'anulado' THEN now() END);
$$;

INSERT INTO _r SELECT 1, 'índice uq_comprobante_factura_en_vuelo', 'existe',
  CASE WHEN to_regclass('uq_comprobante_factura_en_vuelo') IS NOT NULL THEN 'existe' ELSE 'FALTA' END;
INSERT INTO _r SELECT 2, 'índice uq_comprobante_factura_numero', 'existe',
  CASE WHEN to_regclass('uq_comprobante_factura_numero') IS NOT NULL THEN 'existe' ELSE 'FALTA' END;

CALL pg_temp.probe(3, 'primera factura numerada pendiente (PV 1, tipo 6)', 'ok',
  $q$CALL pg_temp.factura('cf-389-a', 1, 1, 6, 'pendiente', NULL, 10)$q$);
CALL pg_temp.probe(4, 'segunda pendiente en el mismo CUIT/PV/tipo', '23505 uq_comprobante_factura_en_vuelo',
  $q$CALL pg_temp.factura('cf-389-b', 2, 1, 6, 'pendiente', NULL, 10)$q$);
CALL pg_temp.probe(5, 'pendiente en otro punto de venta', 'ok',
  $q$CALL pg_temp.factura('cf-389-c', 3, 2, 6, 'pendiente', NULL, 4)$q$);
CALL pg_temp.probe(5, 'pendiente en otro tipo (C)', 'ok',
  $q$CALL pg_temp.factura('cf-389-d', 4, 1, 11, 'pendiente', NULL, 4)$q$);
CALL pg_temp.probe(6, 'pendiente legada sin número pedido no cuenta', 'ok',
  $q$CALL pg_temp.factura('cf-389-e', 5, 1, 6, 'pendiente', NULL, NULL)$q$);

CALL pg_temp.factura('cf-389-f', 6, 3, 6, 'emitido', '00003-00000007', 7);
CALL pg_temp.probe(7, 'mismo número emitido dos veces', '23505 uq_comprobante_factura_numero',
  $q$CALL pg_temp.factura('cf-389-g', 7, 3, 6, 'emitido', '00003-00000007', 7)$q$);
CALL pg_temp.probe(8, 'número emitido repetido como anulado', '23505 uq_comprobante_factura_numero',
  $q$CALL pg_temp.factura('cf-389-i', 9, 3, 6, 'anulado', '00003-00000007', 7)$q$);

CALL pg_temp.probe(9, 'la pendiente pasa a emitido con su número', 'ok',
  $q$UPDATE comprobantes_fiscales SET estado = 'emitido', numero = '00001-00000010', cae = 'CAE-x', cae_vencimiento = '20261130'
     WHERE id = 'cf-389-a'$q$);
CALL pg_temp.probe(10, 'liberada la pendiente, entra otra en el mismo CUIT/PV/tipo', 'ok',
  $q$CALL pg_temp.factura('cf-389-j', 10, 1, 6, 'pendiente', NULL, 11)$q$);

CALL pg_temp.probe(11, 'factura con número pedido y sin CUIT emisor', '23514 comprobantes_fiscales_nc_check',
  $q$INSERT INTO comprobantes_fiscales (id, organization_id, venta_id, tipo, punto_venta, estado, total, provider, cbte_tipo, cbte_nro_solicitado)
     VALUES ('cf-389-k', 'org-probe-389', 'vta-probe-389-2', 'B', 5, 'pendiente', 1000, 'arca', 6, 1)$q$);
CALL pg_temp.probe(12, 'factura B con número pedido y código de C', '23514 comprobantes_fiscales_nc_check',
  $q$INSERT INTO comprobantes_fiscales (id, organization_id, venta_id, tipo, punto_venta, estado, total, provider, cbte_tipo, cuit_emisor, cbte_nro_solicitado)
     VALUES ('cf-389-l', 'org-probe-389', 'vta-probe-389-2', 'B', 5, 'pendiente', 1000, 'arca', 11, '20000000001', 1)$q$);

SELECT orden, probe, esperado, obtenido FROM _r ORDER BY orden, probe;

ROLLBACK;
