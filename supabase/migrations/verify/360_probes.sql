-- Probes de la 360 (pendiente de la orden). Abre su propia transaccion y la
-- revierte: db-run.mjs detecta el BEGIN y rechaza --apply. Correr DESPUES de
-- aplicar la 350 y la 360:
--   npm run db:dry -- supabase/migrations/verify/360_probes.sql
-- Contra una base sin la 360 corta con "function nc_aplicado_deuda_orden(text)
-- does not exist".
--
-- 1 a 3 miran datos reales (solo lectura, ninguna escritura). Sin NC que bajen
-- deuda, lo nuevo tiene que dar exactamente lo mismo que lo viejo. Se limitan a
-- las ordenes sin NC aplicada, asi siguen valiendo cuando el motor de ordenes
-- empiece a escribir monto_aplicado_deuda. Si ya hay NC asi, la premisa (1)
-- sale SALTEADO y las otras no cuentan esas ordenes.
-- 4 en adelante arman una org propia (org-probe-360) y llaman a las funciones
-- reales. Los casos se pueden leer como una tabla:
--   o1: 1000, cobro 400                         -> PARCIAL, cobrado 400
--   o2: 1000, sin cobros                        -> PENDIENTE
--   o3: 500, descuento 100, cobro 400           -> COBRADO
--   o4: costo 0                                 -> PENDIENTE, nada que cobrar
--   o5: 1000, cobro 200 + pago de factura 300   -> cobrado 300 (GREATEST de la 345)
--   o6: 1000, cobro 400 + mismo pago en factura -> cobrado 400, no 800 (sena espejada)
--   o7: 700 EN_REPARACION                       -> no es deuda (filtro de la 273)
--   o8: 800 ENTREGADO con CARGO en cuenta corriente (otro cliente)
--                                               -> sale de deuda_ordenes (318)
-- Las columnas NOT NULL sin default de las tablas que se insertan estan todas
-- provistas (ver la 356 para organizations, clientes y ordenes_servicio).
BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

-- 1. Premisa del PR1d: ninguna NC activa baja deuda todavia
INSERT INTO _r SELECT 1, 'ninguna NC activa tiene monto_aplicado_deuda (premisa del PR1d)', '0',
  CASE WHEN n = 0 THEN '0'
       ELSE 'SALTEADO: ' || n || ' NC activa(s) ya bajan deuda; 2 y 3 no las cuentan' END
  FROM (SELECT COUNT(*) AS n FROM notas_credito
         WHERE anulada = false AND monto_aplicado_deuda <> 0) x;

-- 2. pendiente_orden = formula vieja en todas las ordenes reales sin NC aplicada
INSERT INTO _r SELECT 2, 'pendiente_orden = costo - descuento - cobrado en todas las ordenes', '0',
  (SELECT COUNT(*)::TEXT FROM ordenes_servicio o
    WHERE nc_aplicado_deuda_orden(o.id) = 0
      AND pendiente_orden(o.id) IS DISTINCT FROM
          (COALESCE(o.costo_final, 0) - COALESCE(o.descuento_cobro, 0) - COALESCE(o.total_cobrado, 0)));

-- 3. deuda_ordenes = calculo de la 318, en hasta 2000 clientes reales con ordenes impagas
INSERT INTO _r SELECT 3, 'deuda_ordenes igual a la de la 318 (muestra de clientes reales)', '0',
  (SELECT COUNT(*)::TEXT FROM (
     SELECT DISTINCT o.organization_id, o.cliente_id
     FROM ordenes_servicio o
     WHERE o.estado_cobro IN ('PENDIENTE', 'PARCIAL') AND o.estado IN ('REPARADO', 'ENTREGADO')
       AND NOT EXISTS (SELECT 1 FROM ordenes_servicio x
                        WHERE x.organization_id = o.organization_id AND x.cliente_id = o.cliente_id
                          AND nc_aplicado_deuda_orden(x.id) <> 0)
     ORDER BY o.organization_id, o.cliente_id
     LIMIT 2000
   ) c
   WHERE (SELECT d.deuda_ordenes FROM get_deuda_cliente_sucursal(c.organization_id, c.cliente_id, NULL) d)
         IS DISTINCT FROM
         (SELECT COALESCE(SUM(GREATEST(
                   COALESCE(o.costo_final, 0) - COALESCE(o.descuento_cobro, 0) - COALESCE(o.total_cobrado, 0),
                   0)), 0)
            FROM ordenes_servicio o
           WHERE o.organization_id = c.organization_id
             AND o.cliente_id = c.cliente_id
             AND o.estado_cobro IN ('PENDIENTE', 'PARCIAL')
             AND o.estado IN ('REPARADO', 'ENTREGADO')
             AND NOT EXISTS (
               SELECT 1 FROM cuenta_corriente cc2
                WHERE cc2.organization_id = o.organization_id
                  AND cc2.cliente_id      = o.cliente_id
                  AND cc2.tipo            = 'CARGO'
                  AND cc2.referencia_tipo = 'ORDEN'
                  AND cc2.referencia_id   = o.id)));

-- Fixture
INSERT INTO organizations (id, nombre, nombre_mostrar, slug)
VALUES ('org-probe-360', 'Probe 360', 'Probe 360', 'probe-360-' || substr(md5(random()::text), 1, 8));

INSERT INTO clientes (id, nombre, telefono, organization_id) VALUES
  ('cli-probe-360',  'Cliente probe 360',  '360-0001', 'org-probe-360'),
  ('cli-probe-360b', 'Cliente probe 360b', '360-0002', 'org-probe-360');

INSERT INTO ordenes_servicio (
  id, numero_orden, cliente_id, organization_id, sucursal_id,
  dispositivo, tipo_dispositivo, problema_reportado, estado,
  costo_final, descuento_cobro, total_cobrado, estado_cobro
)
SELECT v.id, v.numero, v.cliente, 'org-probe-360',
       (SELECT id FROM sucursales WHERE organization_id = 'org-probe-360' AND principal),
       'Celular', 'CELULAR', 'Probe 360', v.estado, v.costo, v.descuento, 0, 'PENDIENTE'
FROM (VALUES
  ('ord-probe-360-1', 1, 'cli-probe-360',  'ENTREGADO',    1000::DECIMAL, 0::DECIMAL),
  ('ord-probe-360-2', 2, 'cli-probe-360',  'ENTREGADO',    1000, 0),
  ('ord-probe-360-3', 3, 'cli-probe-360',  'ENTREGADO',     500, 100),
  ('ord-probe-360-4', 4, 'cli-probe-360',  'ENTREGADO',       0, 0),
  ('ord-probe-360-5', 5, 'cli-probe-360',  'ENTREGADO',    1000, 0),
  ('ord-probe-360-6', 6, 'cli-probe-360',  'ENTREGADO',    1000, 0),
  ('ord-probe-360-7', 7, 'cli-probe-360',  'EN_REPARACION', 700, 0),
  ('ord-probe-360-8', 8, 'cli-probe-360b', 'ENTREGADO',     800, 0)
) AS v(id, numero, cliente, estado, costo, descuento);

INSERT INTO cobros_orden (orden_id, organization_id, monto, metodo_pago) VALUES
  ('ord-probe-360-1', 'org-probe-360', 400, 'EFECTIVO'),
  ('ord-probe-360-3', 'org-probe-360', 400, 'EFECTIVO'),
  ('ord-probe-360-5', 'org-probe-360', 200, 'EFECTIVO'),
  ('ord-probe-360-6', 'org-probe-360', 400, 'EFECTIVO');

-- o5 y o6 tienen factura con pagos. Los pagos disparan el trigger de la 345, que
-- llama a recalcular_estado_cobro (ya la version nueva).
INSERT INTO facturas (id, orden_id, numero_factura, subtotal, iva, total, organization_id) VALUES
  ('fac-probe-360-5', 'ord-probe-360-5', 'FAC-P360-5', 1000, 0, 1000, 'org-probe-360'),
  ('fac-probe-360-6', 'ord-probe-360-6', 'FAC-P360-6', 1000, 0, 1000, 'org-probe-360');

INSERT INTO pagos_parciales (id, factura_id, monto, metodo_pago) VALUES
  ('pag-probe-360-5', 'fac-probe-360-5', 300, 'EFECTIVO'),
  ('pag-probe-360-6', 'fac-probe-360-6', 400, 'EFECTIVO');

-- o8: la deuda ya paso a la cuenta corriente (318)
INSERT INTO cuenta_corriente (
  organization_id, cliente_id, tipo, monto, saldo_posterior,
  referencia_tipo, referencia_id, sucursal_id, observaciones
) VALUES ('org-probe-360', 'cli-probe-360b', 'CARGO', -800, -800, 'ORDEN', 'ord-probe-360-8',
          (SELECT id FROM sucursales WHERE organization_id = 'org-probe-360' AND principal), 'probe 360');

DO $$
BEGIN
  PERFORM recalcular_estado_cobro(id) FROM ordenes_servicio WHERE organization_id = 'org-probe-360';
END $$;

-- 4. Sin NC: las reglas de la 345 de siempre
INSERT INTO _r SELECT 4, 'sin NC: estado_cobro y total_cobrado como la 345',
  'PARCIAL 400.00 / PENDIENTE 0.00 / COBRADO 400.00 / PENDIENTE 0.00 / PARCIAL 300.00 / PARCIAL 400.00 / PENDIENTE 0.00 / PENDIENTE 0.00',
  (SELECT string_agg(estado_cobro || ' ' || total_cobrado::TEXT, ' / ' ORDER BY numero_orden)
     FROM ordenes_servicio WHERE organization_id = 'org-probe-360');

-- 5. Sin NC: identico al calculo de la 345 hecho inline (sin pasar por las funciones nuevas)
INSERT INTO _r SELECT 5, 'sin NC: estado y total_cobrado = calculo inline de la 345 (ordenes distintas)', '0',
  (SELECT COUNT(*)::TEXT FROM ordenes_servicio o
    WHERE o.organization_id = 'org-probe-360'
      AND (COALESCE(o.total_cobrado, 0) IS DISTINCT FROM GREATEST(
             COALESCE((SELECT SUM(c.monto) FROM cobros_orden c
                        WHERE c.orden_id = o.id AND c.anulado = FALSE), 0),
             COALESCE((SELECT SUM(p.monto) FROM pagos_parciales p
                         JOIN facturas f ON f.id = p.factura_id
                        WHERE f.orden_id = o.id AND f.estado_pago::text <> 'ANULADA'), 0))
           OR o.estado_cobro IS DISTINCT FROM CASE
                WHEN COALESCE(o.costo_final, 0) - COALESCE(o.descuento_cobro, 0) <= 0 THEN 'PENDIENTE'
                WHEN o.total_cobrado >= COALESCE(o.costo_final, 0) - COALESCE(o.descuento_cobro, 0) THEN 'COBRADO'
                WHEN o.total_cobrado > 0 THEN 'PARCIAL'
                ELSE 'PENDIENTE' END));

-- 6. La regla GREATEST sigue: pago de factura mayor que el cobro, y sena en los dos libros
INSERT INTO _r SELECT 6, 'GREATEST: factura 300 > cobro 200 y sena espejada 400 + 400 (no se suma)', '300.00 / 400.00',
  (SELECT total_cobrado::TEXT FROM ordenes_servicio WHERE id = 'ord-probe-360-5') || ' / ' ||
  (SELECT total_cobrado::TEXT FROM ordenes_servicio WHERE id = 'ord-probe-360-6');

-- 7. pendiente_orden sin NC
INSERT INTO _r SELECT 7, 'pendiente_orden sin NC', '600.00 / 1000.00 / 0.00 / 0.00 / 700.00 / 600.00 / 700.00 / 800.00',
  (SELECT string_agg(ROUND(pendiente_orden(id), 2)::TEXT, ' / ' ORDER BY numero_orden)
     FROM ordenes_servicio WHERE organization_id = 'org-probe-360');

-- 8. Deuda del cliente sin NC: o1 600 + o2 1000 + o5 700 + o6 600; o3 COBRADO,
--    o4 sin costo y o7 en reparacion no suman
INSERT INTO _r SELECT 8, 'deuda sin NC (fiado / ordenes / total)', '0.00 / 2900.00 / 2900.00',
  ROUND(d.deuda_fiado, 2)::TEXT || ' / ' || ROUND(d.deuda_ordenes, 2)::TEXT || ' / ' || ROUND(d.deuda_total, 2)::TEXT
  FROM get_deuda_cliente_sucursal('org-probe-360', 'cli-probe-360', NULL) d;

-- 9. No-doble-conteo de la 318: o8 vive en la cuenta corriente y no en deuda_ordenes
INSERT INTO _r SELECT 9, 'orden con CARGO: cuenta solo en fiado (fiado / ordenes / total)', '800.00 / 0.00 / 800.00',
  ROUND(d.deuda_fiado, 2)::TEXT || ' / ' || ROUND(d.deuda_ordenes, 2)::TEXT || ' / ' || ROUND(d.deuda_total, 2)::TEXT
  FROM get_deuda_cliente_sucursal('org-probe-360', 'cli-probe-360b', NULL) d;

-- 10. Sin NC: deuda_ordenes igual al calculo de la 318 inline para los dos clientes
INSERT INTO _r SELECT 10, 'sin NC: deuda_ordenes = calculo inline de la 318 (clientes distintos)', '0',
  (SELECT COUNT(*)::TEXT FROM (VALUES ('cli-probe-360'), ('cli-probe-360b')) c(id)
    WHERE (SELECT d.deuda_ordenes FROM get_deuda_cliente_sucursal('org-probe-360', c.id, NULL) d)
          IS DISTINCT FROM
          (SELECT COALESCE(SUM(GREATEST(
                    COALESCE(o.costo_final, 0) - COALESCE(o.descuento_cobro, 0) - COALESCE(o.total_cobrado, 0),
                    0)), 0)
             FROM ordenes_servicio o
            WHERE o.organization_id = 'org-probe-360'
              AND o.cliente_id = c.id
              AND o.estado_cobro IN ('PENDIENTE', 'PARCIAL')
              AND o.estado IN ('REPARADO', 'ENTREGADO')
              AND NOT EXISTS (
                SELECT 1 FROM cuenta_corriente cc2
                 WHERE cc2.organization_id = o.organization_id
                   AND cc2.cliente_id      = o.cliente_id
                   AND cc2.tipo            = 'CARGO'
                   AND cc2.referencia_tipo = 'ORDEN'
                   AND cc2.referencia_id   = o.id)));

-- Una NC sobre o1 que baja los 600 que se deben
INSERT INTO notas_credito (id, organization_id, numero, orden_id, motivo, monto, monto_aplicado_deuda)
VALUES ('nc-probe-360-1', 'org-probe-360', 'NC-P360-1', 'ord-probe-360-1', 'TRABAJO_NO_REALIZADO', 600, 600);
DO $$ BEGIN PERFORM recalcular_estado_cobro('ord-probe-360-1'); END $$;

-- 11. Con la NC: pendiente 0, COBRADO, y total_cobrado sigue en 400 (plata recibida)
INSERT INTO _r SELECT 11, 'NC que cubre el saldo: pendiente / estado / cobrado', '0.00 / COBRADO / 400.00',
  ROUND(pendiente_orden(id), 2)::TEXT || ' / ' || estado_cobro || ' / ' || total_cobrado::TEXT
  FROM ordenes_servicio WHERE id = 'ord-probe-360-1';

-- 12. La deuda del cliente baja en 600
INSERT INTO _r SELECT 12, 'deuda con la NC (fiado / ordenes / total)', '0.00 / 2300.00 / 2300.00',
  ROUND(d.deuda_fiado, 2)::TEXT || ' / ' || ROUND(d.deuda_ordenes, 2)::TEXT || ' / ' || ROUND(d.deuda_total, 2)::TEXT
  FROM get_deuda_cliente_sucursal('org-probe-360', 'cli-probe-360', NULL) d;

-- 13. NC anulada: no cuenta y todo vuelve
UPDATE notas_credito SET anulada = true, anulada_at = now(), anulada_motivo = 'probe 360'
WHERE id = 'nc-probe-360-1';
DO $$ BEGIN PERFORM recalcular_estado_cobro('ord-probe-360-1'); END $$;
INSERT INTO _r SELECT 13, 'NC anulada no cuenta: pendiente / estado', '600.00 / PARCIAL',
  ROUND(pendiente_orden(id), 2)::TEXT || ' / ' || estado_cobro
  FROM ordenes_servicio WHERE id = 'ord-probe-360-1';

-- 14. NC con reintegro: solo la parte aplicada a deuda cuenta (250 de 600)
INSERT INTO notas_credito (id, organization_id, numero, orden_id, motivo, monto, monto_aplicado_deuda)
VALUES ('nc-probe-360-2', 'org-probe-360', 'NC-P360-2', 'ord-probe-360-1', 'AJUSTE_PRECIO', 600, 250);
DO $$ BEGIN PERFORM recalcular_estado_cobro('ord-probe-360-1'); END $$;
INSERT INTO _r SELECT 14, 'NC con reintegro: solo lo aplicado a deuda cuenta', '350.00 / PARCIAL / 400.00',
  ROUND(pendiente_orden(id), 2)::TEXT || ' / ' || estado_cobro || ' / ' || total_cobrado::TEXT
  FROM ordenes_servicio WHERE id = 'ord-probe-360-1';

-- 15. NC parcial sobre una orden sin cobros: PARCIAL aunque no entro plata
INSERT INTO notas_credito (id, organization_id, numero, orden_id, motivo, monto, monto_aplicado_deuda)
VALUES ('nc-probe-360-3', 'org-probe-360', 'NC-P360-3', 'ord-probe-360-2', 'AJUSTE_PRECIO', 200, 200);
DO $$ BEGIN PERFORM recalcular_estado_cobro('ord-probe-360-2'); END $$;
INSERT INTO _r SELECT 15, 'NC parcial sin cobros: pendiente / estado / cobrado', '800.00 / PARCIAL / 0.00',
  ROUND(pendiente_orden(id), 2)::TEXT || ' / ' || estado_cobro || ' / ' || total_cobrado::TEXT
  FROM ordenes_servicio WHERE id = 'ord-probe-360-2';

-- 16. El trigger de la 277 (cambio de costo_final) tambien cuenta la NC
UPDATE ordenes_servicio SET costo_final = 200 WHERE id = 'ord-probe-360-2';
INSERT INTO _r SELECT 16, 'bajar costo_final a lo que cubre la NC: el trigger deja COBRADO', '0.00 / COBRADO',
  ROUND(pendiente_orden(id), 2)::TEXT || ' / ' || estado_cobro
  FROM ordenes_servicio WHERE id = 'ord-probe-360-2';

-- 17. GREATEST + NC: o5 (cobrado 300) con una NC de 700 queda COBRADO y cobrado sigue en 300
INSERT INTO notas_credito (id, organization_id, numero, orden_id, motivo, monto, monto_aplicado_deuda)
VALUES ('nc-probe-360-4', 'org-probe-360', 'NC-P360-4', 'ord-probe-360-5', 'TRABAJO_NO_REALIZADO', 700, 700);
DO $$ BEGIN PERFORM recalcular_estado_cobro('ord-probe-360-5'); END $$;
INSERT INTO _r SELECT 17, 'GREATEST + NC: pendiente / estado / cobrado', '0.00 / COBRADO / 300.00',
  ROUND(pendiente_orden(id), 2)::TEXT || ' / ' || estado_cobro || ' / ' || total_cobrado::TEXT
  FROM ordenes_servicio WHERE id = 'ord-probe-360-5';

-- 18. Sena espejada + NC: o6 cobrado 400 (no 800) y con 600 de NC queda COBRADO
INSERT INTO notas_credito (id, organization_id, numero, orden_id, motivo, monto, monto_aplicado_deuda)
VALUES ('nc-probe-360-5', 'org-probe-360', 'NC-P360-5', 'ord-probe-360-6', 'TRABAJO_NO_REALIZADO', 600, 600);
DO $$ BEGIN PERFORM recalcular_estado_cobro('ord-probe-360-6'); END $$;
INSERT INTO _r SELECT 18, 'sena espejada + NC: pendiente / estado / cobrado', '0.00 / COBRADO / 400.00',
  ROUND(pendiente_orden(id), 2)::TEXT || ' / ' || estado_cobro || ' / ' || total_cobrado::TEXT
  FROM ordenes_servicio WHERE id = 'ord-probe-360-6';

-- 19. El trigger de la 345 (nuevo pago de factura) tambien cuenta la NC. El pago
--     sube GREATEST a 400 y el pendiente crudo queda en -100 (sin recortar).
INSERT INTO pagos_parciales (id, factura_id, monto, metodo_pago)
VALUES ('pag-probe-360-5b', 'fac-probe-360-5', 100, 'EFECTIVO');
INSERT INTO _r SELECT 19, 'pago de factura con NC: pendiente crudo / estado / cobrado', '-100.00 / COBRADO / 400.00',
  ROUND(pendiente_orden(id), 2)::TEXT || ' / ' || estado_cobro || ' / ' || total_cobrado::TEXT
  FROM ordenes_servicio WHERE id = 'ord-probe-360-5';

-- 20. Deuda final: solo queda o1 con 350 (el pendiente negativo de o5 no resta)
INSERT INTO _r SELECT 20, 'deuda final (fiado / ordenes / total)', '0.00 / 350.00 / 350.00',
  ROUND(d.deuda_fiado, 2)::TEXT || ' / ' || ROUND(d.deuda_ordenes, 2)::TEXT || ' / ' || ROUND(d.deuda_total, 2)::TEXT
  FROM get_deuda_cliente_sucursal('org-probe-360', 'cli-probe-360', NULL) d;

-- 21. nc_aplicado_deuda_orden suma solo las NC activas
INSERT INTO _r SELECT 21, 'nc_aplicado_deuda_orden: o1 (NC anulada 600 + activa 250) / o4 (sin NC)', '250.00 / 0',
  ROUND(nc_aplicado_deuda_orden('ord-probe-360-1'), 2)::TEXT || ' / ' || nc_aplicado_deuda_orden('ord-probe-360-4')::TEXT;

-- 22. pendiente_orden de una orden que no existe es NULL, no un error ni 0
INSERT INTO _r SELECT 22, 'pendiente_orden de un id inexistente', 'NULL',
  COALESCE(pendiente_orden('ord-probe-360-nada')::TEXT, 'NULL');

-- 23. Permisos de la deuda (318): solo service_role, igual que antes
INSERT INTO _r SELECT 23, 'get_deuda_cliente_sucursal: EXECUTE anon / authenticated / service_role',
  'false / false / true',
  has_function_privilege('anon', 'public.get_deuda_cliente_sucursal(text,text,text)', 'EXECUTE')::TEXT || ' / ' ||
  has_function_privilege('authenticated', 'public.get_deuda_cliente_sucursal(text,text,text)', 'EXECUTE')::TEXT || ' / ' ||
  has_function_privilege('service_role', 'public.get_deuda_cliente_sucursal(text,text,text)', 'EXECUTE')::TEXT;

-- 24. SECURITY: la deuda sigue DEFINER con search_path fijo; las otras tres siguen INVOKER (RLS aplica)
INSERT INTO _r SELECT 24, 'SECURITY DEFINER: deuda / recalcular / pendiente / nc_aplicado',
  'true {search_path=public} / false / false / false',
  (SELECT p.prosecdef::TEXT || ' ' || COALESCE(p.proconfig::TEXT, 'sin config')
     FROM pg_proc p WHERE p.oid = 'public.get_deuda_cliente_sucursal(text,text,text)'::regprocedure) || ' / ' ||
  (SELECT prosecdef::TEXT FROM pg_proc WHERE oid = 'public.recalcular_estado_cobro(text)'::regprocedure) || ' / ' ||
  (SELECT prosecdef::TEXT FROM pg_proc WHERE oid = 'public.pendiente_orden(text)'::regprocedure) || ' / ' ||
  (SELECT prosecdef::TEXT FROM pg_proc WHERE oid = 'public.nc_aplicado_deuda_orden(text)'::regprocedure);

-- 25. La firma de la deuda no cambio: mismas tres columnas
INSERT INTO _r SELECT 25, 'get_deuda_cliente_sucursal: columnas de salida', 'deuda_fiado,deuda_ordenes,deuda_total',
  (SELECT string_agg(a.name, ',' ORDER BY a.ord)
     FROM pg_proc p
     CROSS JOIN LATERAL unnest(p.proargnames, p.proargmodes) WITH ORDINALITY AS a(name, mode, ord)
    WHERE p.oid = 'public.get_deuda_cliente_sucursal(text,text,text)'::regprocedure AND a.mode = 't');

-- 26 y 27. Sin FKs nuevas: borrar el taller entero (purga de cuenta / superadmin) no se traba
DO $$
DECLARE v_msg TEXT := 'OK';
BEGIN
  BEGIN
    DELETE FROM organizations WHERE id = 'org-probe-360';
  EXCEPTION WHEN OTHERS THEN
    v_msg := 'FALLO: ' || SQLERRM;
  END;
  INSERT INTO _r VALUES (26, 'borrar la org con NC, facturas, pagos y cuenta corriente no se traba', 'OK', v_msg);
END $$;

INSERT INTO _r SELECT 27, 'la cascada se llevo ordenes, NC, facturas y CARGO del taller', '0 / 0 / 0 / 0',
  (SELECT COUNT(*)::TEXT FROM ordenes_servicio WHERE organization_id = 'org-probe-360') || ' / ' ||
  (SELECT COUNT(*)::TEXT FROM notas_credito WHERE organization_id = 'org-probe-360') || ' / ' ||
  (SELECT COUNT(*)::TEXT FROM facturas WHERE organization_id = 'org-probe-360') || ' / ' ||
  (SELECT COUNT(*)::TEXT FROM cuenta_corriente WHERE organization_id = 'org-probe-360');

SELECT orden, probe, esperado, obtenido,
       CASE WHEN obtenido LIKE 'SALTEADO%' THEN 'SALTEADO'
            WHEN esperado = obtenido THEN 'OK'
            ELSE 'FALLA' END AS resultado
  FROM _r ORDER BY orden;

ROLLBACK;
