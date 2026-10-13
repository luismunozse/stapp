-- Probes de la 356. Abre su propia transaccion y la revierte: db-run.mjs
-- detecta el BEGIN y rechaza --apply. Correr DESPUES de aplicar la 350 y la 356:
--   npm run db:dry -- supabase/migrations/verify/356_probes.sql
-- Contra una base sin la 356 corta en la primera devolucion: la 330 recibe
-- p_numero_devolucion NULL y viola el NOT NULL de numero_devolucion.
--
-- Fixture propia (org-probe-356), sin depender de los datos reales. Su contador
-- de NC arranca en 1, asi que los numeros son exactos. La sucursal y el deposito
-- principales los crea el trigger de alta de la org (217).
-- La venta esta pagada entera y su item no tiene inventario: la devolucion no
-- baja deuda ni toca stock o series; aca solo se mira la numeracion.
BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

INSERT INTO organizations (id, nombre, nombre_mostrar, slug)
VALUES ('org-probe-356', 'Probe 356', 'Probe 356', 'probe-356-' || substr(md5(random()::text), 1, 8));

INSERT INTO users (id, organization_id, sucursal_id, email, nombre, password, rol)
VALUES ('usr-probe-356', 'org-probe-356',
        (SELECT id FROM sucursales WHERE organization_id = 'org-probe-356' AND principal),
        'admin@probe-356.invalid', 'Probe 356', 'x', 'ADMIN');

INSERT INTO clientes (id, nombre, telefono, organization_id)
VALUES ('cli-probe-356', 'Cliente probe 356', '356-0001', 'org-probe-356');

INSERT INTO ventas (id, numero_venta, cliente_id, cliente_nombre, vendedor_id, subtotal, total,
                    metodo_pago, estado, organization_id, sucursal_id, monto_abonado, estado_pago)
VALUES ('vta-probe-356', 1, 'cli-probe-356', 'Cliente probe 356', 'usr-probe-356', 1000, 1000,
        'EFECTIVO', 'COMPLETADA', 'org-probe-356',
        (SELECT id FROM sucursales WHERE organization_id = 'org-probe-356' AND principal), 1000, 'PAGADO');

INSERT INTO items_venta (id, venta_id, descripcion, cantidad, precio_unitario, subtotal)
VALUES ('iv-probe-356', 'vta-probe-356', 'Producto probe 356', 10, 100, 1000);

INSERT INTO ordenes_servicio (
  id, numero_orden, cliente_id, organization_id, sucursal_id,
  dispositivo, tipo_dispositivo, problema_reportado, estado,
  costo_final, descuento_cobro, total_cobrado, estado_cobro
) VALUES ('ord-probe-356', 1, 'cli-probe-356', 'org-probe-356',
          (SELECT id FROM sucursales WHERE organization_id = 'org-probe-356' AND principal),
          'Celular', 'CELULAR', 'Pantalla', 'ENTREGADO', 500, 0, 500, 'COBRADO');

-- Historial previo a la 356, insertado a mano (sin pasar por la funcion): sus
-- numeros no pueden cambiar. La NC de orden no tiene sucursal propia: la vista
-- la toma de la orden.
INSERT INTO devoluciones_venta (id, venta_id, numero_devolucion, motivo, tipo, monto_devolucion, organization_id)
VALUES ('dev-probe-356-legacy', 'vta-probe-356', 'DEV-000001', 'Historial', 'PARCIAL', 50, 'org-probe-356');

INSERT INTO notas_credito (id, organization_id, numero, orden_id, motivo, monto, monto_aplicado_deuda, sucursal_id)
VALUES ('nc-probe-356-legacy', 'org-probe-356', 'NC-P354', 'ord-probe-356', 'AJUSTE_PRECIO', 80, 20, NULL);

-- 1 y 2. Una sola funcion con el nombre que llama la ruta, y el nucleo aparte
INSERT INTO _r SELECT 1, 'registrar_devolucion_atomica: una sola firma (sin sobrecarga)', '1',
  (SELECT COUNT(*)::TEXT FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'registrar_devolucion_atomica');
INSERT INTO _r SELECT 2, 'registrar_devolucion_nucleo existe', '1',
  (SELECT COUNT(*)::TEXT FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'registrar_devolucion_nucleo');

-- 3. El nucleo no se llama directo con la anon key ni con un JWT de usuario
INSERT INTO _r SELECT 3, 'nucleo: sin EXECUTE para anon ni authenticated, con service_role',
  'false / false / true',
  has_function_privilege('anon',
    'public.registrar_devolucion_nucleo(text,text,text,text,text,text,text,text,jsonb,text)', 'EXECUTE')::TEXT || ' / ' ||
  has_function_privilege('authenticated',
    'public.registrar_devolucion_nucleo(text,text,text,text,text,text,text,text,jsonb,text)', 'EXECUTE')::TEXT || ' / ' ||
  has_function_privilege('service_role',
    'public.registrar_devolucion_nucleo(text,text,text,text,text,text,text,text,jsonb,text)', 'EXECUTE')::TEXT;

-- 27. El envoltorio tampoco (lo llama solo la ruta, con service_role)
INSERT INTO _r SELECT 27, 'atomica: sin EXECUTE para anon ni authenticated, con service_role',
  'false / false / true',
  has_function_privilege('anon',
    'public.registrar_devolucion_atomica(text,text,text,text,text,text,text,text,jsonb,text)', 'EXECUTE')::TEXT || ' / ' ||
  has_function_privilege('authenticated',
    'public.registrar_devolucion_atomica(text,text,text,text,text,text,text,text,jsonb,text)', 'EXECUTE')::TEXT || ' / ' ||
  has_function_privilege('service_role',
    'public.registrar_devolucion_atomica(text,text,text,text,text,text,text,text,jsonb,text)', 'EXECUTE')::TEXT;

-- 4. El contador compartido se incrementa con un upsert (toma el lock de la fila)
INSERT INTO _r SELECT 4, 'get_next_nota_credito_number: INSERT ... ON CONFLICT DO UPDATE', 'true',
  (pg_get_functiondef('public.get_next_nota_credito_number(text)'::regprocedure) ~* 'ON CONFLICT.*DO UPDATE')::TEXT;

DO $$
DECLARE
  v_items  JSONB := '[{"itemVentaId":"iv-probe-356","cantidad":1,"restaurarStock":false}]';
  v_excede JSONB := '[{"itemVentaId":"iv-probe-356","cantidad":99,"restaurarStock":false}]';
  v_res    JSONB;
  v_otra   JSONB;
  v_nc_num TEXT;
  v_msg    TEXT := 'sin error';
BEGIN
  -- 5. Sin numero: NC-000001, en la fila y en la respuesta
  v_res := registrar_devolucion_atomica('org-probe-356', 'vta-probe-356', 'usr-probe-356', NULL,
    'Probe 356', NULL, 'EFECTIVO', NULL, v_items, 'k-356-a');
  INSERT INTO _r SELECT 5, 'primera devolucion numera NC-000001 (fila / respuesta)', 'NC-000001 / NC-000001',
    (SELECT numero_devolucion FROM devoluciones_venta WHERE id = v_res->>'id') || ' / ' || (v_res->>'numero');

  -- 6. El motor de ordenes toma el siguiente del MISMO contador y lo usa
  v_nc_num := get_next_nota_credito_number('org-probe-356');
  INSERT INTO notas_credito (id, organization_id, numero, orden_id, motivo, monto, sucursal_id)
  VALUES ('nc-probe-356-orden', 'org-probe-356', v_nc_num, 'ord-probe-356', 'OTRO', 10,
          (SELECT id FROM sucursales WHERE organization_id = 'org-probe-356' AND principal));
  INSERT INTO _r VALUES (6, 'NC de orden sigue a la devolucion en el mismo contador', 'NC-000002', v_nc_num);

  -- 7. Segunda devolucion: no repite el de la orden
  v_otra := registrar_devolucion_atomica('org-probe-356', 'vta-probe-356', 'usr-probe-356', NULL,
    'Probe 356', NULL, 'EFECTIVO', NULL, v_items, 'k-356-b');
  INSERT INTO _r VALUES (7, 'segunda devolucion: NC-000003', 'NC-000003', v_otra->>'numero');

  -- 8 y 9. Reintento con la clave de la primera: misma devolucion, mismo numero, sin consumir
  v_otra := registrar_devolucion_atomica('org-probe-356', 'vta-probe-356', 'usr-probe-356', NULL,
    'Probe 356', NULL, 'EFECTIVO', NULL, v_items, 'k-356-a');
  INSERT INTO _r VALUES (8, 'reintento: misma devolucion, mismo numero, replayed', 'true / NC-000001 / true',
    ((v_otra->>'id') = (v_res->>'id'))::TEXT || ' / ' || (v_otra->>'numero') || ' / ' || (v_otra->>'replayed'));
  INSERT INTO _r SELECT 9, 'el reintento no consumio numero (ultimo emitido = 3)', '3', next_number::TEXT
    FROM notas_credito_counter WHERE organization_id = 'org-probe-356';

  -- 10. Una devolucion rechazada no quema numero (el contador vuelve con el rollback)
  BEGIN
    PERFORM registrar_devolucion_atomica('org-probe-356', 'vta-probe-356', 'usr-probe-356', NULL,
      'Probe 356', NULL, 'EFECTIVO', NULL, v_excede, 'k-356-c');
  EXCEPTION WHEN OTHERS THEN
    v_msg := CASE WHEN SQLERRM LIKE '%excede lo permitido%' THEN 'excede' ELSE 'otro error: ' || SQLERRM END;
  END;
  v_otra := registrar_devolucion_atomica('org-probe-356', 'vta-probe-356', 'usr-probe-356', NULL,
    'Probe 356', NULL, 'EFECTIVO', NULL, v_items, 'k-356-d');
  INSERT INTO _r VALUES (10, 'una devolucion rechazada no quema numero', 'excede / NC-000004',
    v_msg || ' / ' || (v_otra->>'numero'));

  -- 11 y 12. Ventana de deploy: el codigo anterior manda su DEV- y se respeta
  v_otra := registrar_devolucion_atomica('org-probe-356', 'vta-probe-356', 'usr-probe-356', 'DEV-354999',
    'Probe 356', NULL, 'EFECTIVO', NULL, v_items, 'k-356-e');
  INSERT INTO _r SELECT 11, 'con numero explicito (codigo viejo) se guarda ese numero', 'DEV-354999 / DEV-354999',
    (SELECT numero_devolucion FROM devoluciones_venta WHERE id = v_otra->>'id') || ' / ' || (v_otra->>'numero');
  INSERT INTO _r SELECT 12, 'el numero explicito no consume el contador (ultimo emitido = 4)', '4', next_number::TEXT
    FROM notas_credito_counter WHERE organization_id = 'org-probe-356';

  -- 13. Un numero vacio se trata como ausente
  v_otra := registrar_devolucion_atomica('org-probe-356', 'vta-probe-356', 'usr-probe-356', '',
    'Probe 356', NULL, 'EFECTIVO', NULL, v_items, 'k-356-f');
  INSERT INTO _r VALUES (13, 'numero vacio: se asigna el NC- siguiente', 'NC-000005', v_otra->>'numero');
END $$;

-- 14. El historial no se reescribio
INSERT INTO _r SELECT 14, 'historial intacto: DEV-000001 y NC-P354 conservan su numero', 'DEV-000001 / NC-P354',
  (SELECT numero_devolucion FROM devoluciones_venta WHERE id = 'dev-probe-356-legacy') || ' / ' ||
  (SELECT numero FROM notas_credito WHERE id = 'nc-probe-356-legacy');

-- 15. Unicidad en la org: ningun numero se repite entre los dos motores
INSERT INTO _r SELECT 15, 'numeros unicos en la org (sin choques entre motores)', 'true',
  (COUNT(*) = COUNT(DISTINCT numero))::TEXT
  FROM v_notas_credito WHERE organization_id = 'org-probe-356';

-- 16. Y las tablas no comparten ningun numero
INSERT INTO _r SELECT 16, 'devoluciones_venta y notas_credito no comparten numeros', '0',
  (SELECT COUNT(*)::TEXT FROM devoluciones_venta dv
    JOIN notas_credito nc ON nc.organization_id = dv.organization_id AND nc.numero = dv.numero_devolucion
   WHERE dv.organization_id = 'org-probe-356');

-- 17. La vista junta los dos motores de la org: 6 devoluciones y 2 NC de orden
INSERT INTO _r SELECT 17, 'v_notas_credito: filas de la org por origen', 'VENTA 6 / ORDEN 2',
  'VENTA ' || COUNT(*) FILTER (WHERE origen = 'VENTA') || ' / ORDEN ' || COUNT(*) FILTER (WHERE origen = 'ORDEN')
  FROM v_notas_credito WHERE organization_id = 'org-probe-356';

-- 18. Fila de venta normalizada: cliente y sucursal de la venta, reintegro = monto - aplicado
INSERT INTO _r SELECT 18, 'fila VENTA normalizada',
  'vta-probe-356 / 1 / cli-probe-356 / true / 100.00 / 0.00 / 100.00 / EFECTIVO / ITEMS / false',
  v.origen_id || ' / ' || v.origen_numero || ' / ' || v.cliente_id || ' / ' ||
  (v.sucursal_id = (SELECT sucursal_id FROM ventas WHERE id = 'vta-probe-356'))::TEXT || ' / ' ||
  v.monto::TEXT || ' / ' || v.monto_aplicado_deuda::TEXT || ' / ' || v.monto_reembolso::TEXT || ' / ' ||
  v.metodo || ' / ' || v.modo || ' / ' || v.anulada::TEXT
  FROM v_notas_credito v
  WHERE v.organization_id = 'org-probe-356' AND v.numero = 'NC-000001';

-- 19. Fila de orden normalizada: motivo, reparto y sucursal heredada de la orden
INSERT INTO _r SELECT 19, 'fila ORDEN normalizada',
  'ord-probe-356 / AJUSTE_PRECIO / 80.00 / 20.00 / 60.00 / true / MONTO',
  v.origen_id || ' / ' || v.motivo_nc || ' / ' || v.monto::TEXT || ' / ' ||
  v.monto_aplicado_deuda::TEXT || ' / ' || v.monto_reembolso::TEXT || ' / ' ||
  (v.sucursal_id = (SELECT sucursal_id FROM ordenes_servicio WHERE id = 'ord-probe-356'))::TEXT || ' / ' ||
  v.modo
  FROM v_notas_credito v WHERE v.id = 'nc-probe-356-legacy';

-- 20. La vista no pierde filas: todo el historial de los dos motores
INSERT INTO _r SELECT 20, 'v_notas_credito tiene todas las filas de las dos tablas', 'true',
  ((SELECT COUNT(*) FROM v_notas_credito)
   = (SELECT COUNT(*) FROM devoluciones_venta) + (SELECT COUNT(*) FROM notas_credito))::TEXT;

-- 21. La vista corre con los permisos de quien la consulta (RLS de las tablas base)
INSERT INTO _r SELECT 21, 'v_notas_credito con security_invoker', 'true',
  COALESCE((SELECT ('security_invoker=true' = ANY (c.reloptions))::TEXT
              FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relname = 'v_notas_credito'), 'no existe');

-- 22 a 24. Con la anon key (publica) la vista no se lee; la app la lee con service_role
INSERT INTO _r SELECT 22, 'v_notas_credito: SELECT para anon / authenticated / service_role',
  'false / false / true',
  has_table_privilege('anon', 'public.v_notas_credito', 'SELECT')::TEXT || ' / ' ||
  has_table_privilege('authenticated', 'public.v_notas_credito', 'SELECT')::TEXT || ' / ' ||
  has_table_privilege('service_role', 'public.v_notas_credito', 'SELECT')::TEXT;

-- 23. Ningun otro privilegio (INSERT, UPDATE, ...) para los roles de la API
INSERT INTO _r SELECT 23, 'v_notas_credito: sin ningun privilegio para anon ni authenticated', '0',
  (SELECT COUNT(*)::TEXT
     FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'v_notas_credito'
      AND grantee IN ('anon', 'authenticated', 'PUBLIC'));

-- 24. ACL exacta: solo el duenio y service_role
INSERT INTO _r SELECT 24, 'v_notas_credito: grantees = postgres + service_role', 'postgres,service_role',
  (SELECT string_agg(DISTINCT pg_get_userbyid(a.grantee), ',' ORDER BY pg_get_userbyid(a.grantee))
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE n.nspname = 'public' AND c.relname = 'v_notas_credito');

-- 25 y 26. Sin FKs nuevas: borrar el taller entero (purga de cuenta / superadmin) no se traba
DO $$
DECLARE v_msg TEXT := 'OK';
BEGIN
  BEGIN
    DELETE FROM organizations WHERE id = 'org-probe-356';
  EXCEPTION WHEN OTHERS THEN
    v_msg := 'FALLO: ' || SQLERRM;
  END;
  INSERT INTO _r VALUES (25, 'borrar la org con devoluciones, NC y contador no se traba', 'OK', v_msg);
END $$;

INSERT INTO _r SELECT 26, 'la cascada se llevo devoluciones, NC y contador del taller', '0 / 0 / 0',
  (SELECT COUNT(*)::TEXT FROM devoluciones_venta WHERE organization_id = 'org-probe-356') || ' / ' ||
  (SELECT COUNT(*)::TEXT FROM notas_credito WHERE organization_id = 'org-probe-356') || ' / ' ||
  (SELECT COUNT(*)::TEXT FROM notas_credito_counter WHERE organization_id = 'org-probe-356');

SELECT orden, probe, esperado, obtenido,
       CASE WHEN obtenido LIKE 'SALTEADO%' THEN 'SALTEADO'
            WHEN esperado = obtenido THEN 'OK'
            ELSE 'FALLA' END AS resultado
  FROM _r ORDER BY orden;

ROLLBACK;
