-- Probes de la 342. Abre su propia transaccion y la revierte: db-run.mjs
-- detecta el BEGIN y rechaza --apply. Correr DESPUES de aplicar la 342:
--   npm run db:dry -- supabase/migrations/verify/342_probes.sql
-- Contra una base sin la 342 corta con "column ... does not exist".
--
-- Fixture propia (org-probe-342). La sucursal y el deposito principales los
-- crea el trigger de alta de la org (217): no insertar otra sucursal principal,
-- choca con sucursales_org_principal_unique.
-- 1 a 4 y 14 miran datos reales; lo que tocan se revierte con el ROLLBACK.
BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

INSERT INTO organizations (id, nombre, nombre_mostrar, slug)
VALUES ('org-probe-342', 'Probe 342', 'Probe 342', 'probe-342-' || substr(md5(random()::text), 1, 8));

INSERT INTO clientes (id, nombre, telefono, organization_id)
VALUES ('cli-probe-342', 'Cliente probe 342', '342-0001', 'org-probe-342');

INSERT INTO ordenes_servicio (
  id, numero_orden, cliente_id, organization_id, sucursal_id,
  dispositivo, tipo_dispositivo, problema_reportado, estado,
  costo_final, descuento_cobro, total_cobrado, estado_cobro
) VALUES
  ('ord-probe-342-1', 1, 'cli-probe-342', 'org-probe-342',
   (SELECT id FROM sucursales WHERE organization_id = 'org-probe-342' AND principal),
   'Celular', 'CELULAR', 'Pantalla', 'ENTREGADO', 1000, 0, 1000, 'COBRADO'),
  ('ord-probe-342-2', 2, 'cli-probe-342', 'org-probe-342',
   (SELECT id FROM sucursales WHERE organization_id = 'org-probe-342' AND principal),
   'Celular', 'CELULAR', 'Bateria', 'ENTREGADO', 500, 0, 500, 'COBRADO');

INSERT INTO inventario (id, organization_id, codigo, categoria, precio_compra, nombre, stock, stock_reservado, precio_venta)
VALUES ('inv-probe-342', 'org-probe-342', 'PROBE-342', 'PROBE', 0, 'Repuesto probe 342', 0, 0, 0);

INSERT INTO repuestos_orden (id, orden_id, inventario_id, cantidad, precio_unitario)
VALUES ('rep-probe-342', 'ord-probe-342-1', 'inv-probe-342', 1, 100);

INSERT INTO notas_credito (id, organization_id, numero, orden_id, motivo, monto, monto_aplicado_deuda)
VALUES
  ('nc-probe-342-1', 'org-probe-342', 'NC-P342-1', 'ord-probe-342-1', 'TRABAJO_NO_REALIZADO', 100, 30),
  ('nc-probe-342-2', 'org-probe-342', 'NC-P342-2', 'ord-probe-342-2', 'OTRO', 50, 0);

INSERT INTO items_nota_credito (nota_credito_id, repuesto_orden_id, deposito_id, descripcion, cantidad, precio_unitario, restock)
VALUES ('nc-probe-342-1', 'rep-probe-342',
        (SELECT id FROM depositos WHERE organization_id = 'org-probe-342' AND principal LIMIT 1),
        'Repuesto probe 342', 1, 100, false);

-- 0. Setup
INSERT INTO _r SELECT 0, 'setup: 2 ordenes, 2 NC y 1 item con repuesto y deposito', '2 / 2 / 1',
  (SELECT COUNT(*)::TEXT FROM ordenes_servicio WHERE organization_id = 'org-probe-342') || ' / ' ||
  (SELECT COUNT(*)::TEXT FROM notas_credito WHERE organization_id = 'org-probe-342') || ' / ' ||
  (SELECT COUNT(*)::TEXT FROM items_nota_credito
     WHERE nota_credito_id = 'nc-probe-342-1' AND repuesto_orden_id IS NOT NULL AND deposito_id IS NOT NULL);

-- 1. El historial de devoluciones queda igual: ITEMS, activo, sin motivo de catalogo
INSERT INTO _r SELECT 1, 'devoluciones existentes: todas ITEMS, activas y sin motivo_nc', '0',
  (SELECT COUNT(*)::TEXT FROM devoluciones_venta WHERE modo <> 'ITEMS' OR anulada OR motivo_nc IS NOT NULL);

-- 2. Indice parcial de devoluciones activas
INSERT INTO _r SELECT 2, 'indice parcial (venta_id) WHERE anulada = false', 'true',
  COALESCE((SELECT (indexdef LIKE '%(venta_id)%' AND indexdef LIKE '%WHERE (anulada = false)%')::TEXT
              FROM pg_indexes WHERE indexname = 'devoluciones_venta_venta_activa_idx'), 'no existe');

-- 3 y 4. motivo_nc: rechaza fuera del catalogo y acepta TRABAJO_NO_REALIZADO
DO $$
DECLARE
  v_id  TEXT;
  v_msg TEXT := 'sin error';
BEGIN
  SELECT id INTO v_id FROM devoluciones_venta ORDER BY created_at DESC LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO _r VALUES (3, 'motivo_nc rechaza un motivo fuera del catalogo', 'check_violation', 'SALTEADO: no hay devoluciones');
    INSERT INTO _r VALUES (4, 'motivo_nc acepta TRABAJO_NO_REALIZADO', 'TRABAJO_NO_REALIZADO', 'SALTEADO: no hay devoluciones');
    RETURN;
  END IF;

  BEGIN
    UPDATE devoluciones_venta SET motivo_nc = 'INVENTADO' WHERE id = v_id;
  EXCEPTION
    WHEN check_violation THEN v_msg := 'check_violation';
    WHEN OTHERS THEN v_msg := 'otro error: ' || SQLERRM;
  END;
  INSERT INTO _r VALUES (3, 'motivo_nc rechaza un motivo fuera del catalogo', 'check_violation', v_msg);

  UPDATE devoluciones_venta SET motivo_nc = 'TRABAJO_NO_REALIZADO' WHERE id = v_id;
  INSERT INTO _r SELECT 4, 'motivo_nc acepta TRABAJO_NO_REALIZADO', 'TRABAJO_NO_REALIZADO', motivo_nc
    FROM devoluciones_venta WHERE id = v_id;
END $$;

-- 5. notas_credito acepta el motivo nuevo (la NC 1 del fixture se inserto con el)
INSERT INTO _r SELECT 5, 'notas_credito acepta TRABAJO_NO_REALIZADO', 'TRABAJO_NO_REALIZADO', motivo
  FROM notas_credito WHERE id = 'nc-probe-342-1';

-- 6. ... y rechaza uno fuera del catalogo
DO $$
DECLARE v_msg TEXT := 'sin error';
BEGIN
  BEGIN
    UPDATE notas_credito SET motivo = 'INVENTADO' WHERE id = 'nc-probe-342-2';
  EXCEPTION
    WHEN check_violation THEN v_msg := 'check_violation';
    WHEN OTHERS THEN v_msg := 'otro error: ' || SQLERRM;
  END;
  INSERT INTO _r VALUES (6, 'notas_credito rechaza un motivo fuera del catalogo', 'check_violation', v_msg);
END $$;

-- 7. Un solo CHECK sobre motivo: el de la 186 no quedo vivo al lado del nuevo
INSERT INTO _r SELECT 7, 'un solo CHECK sobre notas_credito.motivo', '1',
  (SELECT COUNT(*)::TEXT FROM pg_constraint
    WHERE conrelid = 'public.notas_credito'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%motivo%');

-- 8. Solo ordenes: una NC con venta_id se rechaza
DO $$
DECLARE v_msg TEXT := 'sin error';
BEGIN
  BEGIN
    UPDATE notas_credito SET venta_id = 'venta-probe-342' WHERE id = 'nc-probe-342-2';
  EXCEPTION
    WHEN check_violation THEN v_msg := 'check_violation';
    WHEN OTHERS THEN v_msg := 'otro error: ' || SQLERRM;
  END;
  INSERT INTO _r VALUES (8, 'una NC con venta_id viola notas_credito_solo_ordenes', 'check_violation', v_msg);
END $$;

-- 9. ... y una sin orden tambien
DO $$
DECLARE v_msg TEXT := 'sin error';
BEGIN
  BEGIN
    UPDATE notas_credito SET orden_id = NULL WHERE id = 'nc-probe-342-2';
  EXCEPTION
    WHEN check_violation THEN v_msg := 'check_violation';
    WHEN OTHERS THEN v_msg := 'otro error: ' || SQLERRM;
  END;
  INSERT INTO _r VALUES (9, 'una NC sin orden viola notas_credito_solo_ordenes', 'check_violation', v_msg);
END $$;

-- 10. modo fuera de ITEMS/MONTO se rechaza
DO $$
DECLARE v_msg TEXT := 'sin error';
BEGIN
  BEGIN
    UPDATE notas_credito SET modo = 'OTRA_COSA' WHERE id = 'nc-probe-342-2';
  EXCEPTION
    WHEN check_violation THEN v_msg := 'check_violation';
    WHEN OTHERS THEN v_msg := 'otro error: ' || SQLERRM;
  END;
  INSERT INTO _r VALUES (10, 'modo fuera de ITEMS/MONTO se rechaza', 'check_violation', v_msg);
END $$;

-- 11. Lo aplicado a deuda no puede superar el monto
DO $$
DECLARE v_msg TEXT := 'sin error';
BEGIN
  BEGIN
    UPDATE notas_credito SET monto_aplicado_deuda = 51 WHERE id = 'nc-probe-342-2';
  EXCEPTION
    WHEN check_violation THEN v_msg := 'check_violation';
    WHEN OTHERS THEN v_msg := 'otro error: ' || SQLERRM;
  END;
  INSERT INTO _r VALUES (11, 'monto_aplicado_deuda > monto se rechaza', 'check_violation', v_msg);
END $$;

-- 12. Reintegro generado = monto - aplicado
INSERT INTO _r SELECT 12, 'monto_reembolso = monto - monto_aplicado_deuda', '70.00', monto_reembolso::TEXT
  FROM notas_credito WHERE id = 'nc-probe-342-1';

-- 13. idempotency_key unica por organizacion
DO $$
DECLARE v_msg TEXT := 'sin error';
BEGIN
  UPDATE notas_credito SET idempotency_key = 'k-probe-342' WHERE id = 'nc-probe-342-1';
  BEGIN
    UPDATE notas_credito SET idempotency_key = 'k-probe-342' WHERE id = 'nc-probe-342-2';
  EXCEPTION
    WHEN unique_violation THEN v_msg := 'unique_violation';
    WHEN OTHERS THEN v_msg := 'otro error: ' || SQLERRM;
  END;
  INSERT INTO _r VALUES (13, 'idempotency_key repetida en la misma org se rechaza', 'unique_violation', v_msg);
END $$;

-- 14. Backfill de modo en el historial: ITEMS si tiene items, MONTO si no
INSERT INTO _r SELECT 14, 'NC historicas: ITEMS con items, MONTO sin items', '0',
  (SELECT COUNT(*)::TEXT FROM notas_credito nc
    WHERE nc.organization_id <> 'org-probe-342'
      AND nc.modo <> CASE WHEN EXISTS (SELECT 1 FROM items_nota_credito i WHERE i.nota_credito_id = nc.id)
                          THEN 'ITEMS' ELSE 'MONTO' END);

-- 15. FK de la orden: ON DELETE RESTRICT
INSERT INTO _r SELECT 15, 'notas_credito_orden_id_fkey es ON DELETE RESTRICT', 'r',
  (SELECT confdeltype::TEXT FROM pg_constraint
    WHERE conname = 'notas_credito_orden_id_fkey' AND conrelid = 'public.notas_credito'::regclass);

-- 16. Borrar una orden con NC falla, y por la FK de la NC
DO $$
DECLARE v_msg TEXT := 'sin error';
BEGIN
  BEGIN
    DELETE FROM ordenes_servicio WHERE id = 'ord-probe-342-2';
  EXCEPTION
    WHEN foreign_key_violation THEN
      v_msg := CASE WHEN SQLERRM LIKE '%notas_credito_orden_id_fkey%' THEN 'foreign_key_violation'
                    ELSE 'otra FK: ' || SQLERRM END;
    WHEN OTHERS THEN v_msg := 'otro error: ' || SQLERRM;
  END;
  INSERT INTO _r VALUES (16, 'borrar una orden con NC falla por notas_credito_orden_id_fkey', 'foreign_key_violation', v_msg);
END $$;

-- 17 y 18. Borrar el taller entero (purga de cuenta / superadmin) no se traba
DO $$
DECLARE v_msg TEXT := 'OK';
BEGIN
  BEGIN
    DELETE FROM organizations WHERE id = 'org-probe-342';
  EXCEPTION WHEN OTHERS THEN
    v_msg := 'FALLO: ' || SQLERRM;
  END;
  INSERT INTO _r VALUES (17, 'borrar la org con ordenes, NC e items de NC no se traba', 'OK', v_msg);
END $$;

INSERT INTO _r SELECT 18, 'la cascada se llevo las NC del taller', '0',
  (SELECT COUNT(*)::TEXT FROM notas_credito WHERE organization_id = 'org-probe-342');

SELECT orden, probe, esperado, obtenido,
       CASE WHEN obtenido LIKE 'SALTEADO%' THEN 'SALTEADO'
            WHEN esperado = obtenido THEN 'OK'
            ELSE 'FALLA' END AS resultado
  FROM _r ORDER BY orden;

ROLLBACK;
