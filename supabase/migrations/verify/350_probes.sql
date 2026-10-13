-- Probes de la migracion 350: invariante stock = SUM(inventario_depositos.stock)
-- y kardex encadenado.
--
-- Correr con:  node scripts/db-run.mjs supabase/migrations/verify/350_probes.sql
-- (o en el SQL editor de Supabase Studio). El BEGIN / ROLLBACK esta incluido: nada
-- de lo que crea queda; db-run.mjs detecta el BEGIN y rechaza --apply. Requiere la
-- 350 ya aplicada (o concatenada delante, sin su propio BEGIN).
--
-- Verde = `esperado` igual a `obtenido` (columna `resultado` = OK) en cada fila.
--
-- Cobertura: G (alta con stock siembra detalle + movimiento STOCK_INICIAL, sin
-- usuario, kardex que reconcilia), A (conteo por deposito con refresco de
-- stock_sistema y conteo global), B1 (kits sin deposito, reservas, estricto),
-- B2 (consolidar multi-deposito y origen con drift), F (lotes/series y referencias
-- ajenas), H (variantes), y los permisos de la funcion nueva.
-- Notas: cada bloque atrapa sus errores como una fila "bloque", asi una falla no
-- oculta el resto. Las probes 62-64 salen OK sin evaluar si la base no tiene datos
-- de otra organizacion (leer como "salteado").
BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);
CREATE TEMP TABLE _ids (k TEXT PRIMARY KEY, v TEXT);

CREATE FUNCTION pg_temp.id(p_k TEXT) RETURNS TEXT LANGUAGE sql AS
$$ SELECT v FROM _ids WHERE k = p_k $$;

CREATE FUNCTION pg_temp.total(p_inv TEXT) RETURNS INTEGER LANGUAGE sql AS
$$ SELECT COALESCE(stock, 0) FROM inventario WHERE id = p_inv $$;

CREATE FUNCTION pg_temp.dep(p_inv TEXT, p_dep TEXT) RETURNS INTEGER LANGUAGE sql AS
$$ SELECT COALESCE((SELECT stock FROM inventario_depositos
                    WHERE inventario_id = p_inv AND deposito_id = p_dep), 0) $$;

CREATE FUNCTION pg_temp.drift(p_inv TEXT) RETURNS INTEGER LANGUAGE sql AS
$$ SELECT (COALESCE(i.stock, 0)
           - COALESCE((SELECT SUM(d.stock) FROM inventario_depositos d WHERE d.inventario_id = i.id), 0))::INTEGER
   FROM inventario i WHERE i.id = p_inv $$;

-- Kardex: suma de (posterior - anterior) de movimientos no-transferencia = stock actual
CREATE FUNCTION pg_temp.kardex_ok(p_inv TEXT) RETURNS BOOLEAN LANGUAGE sql AS
$$ SELECT COALESCE((SELECT SUM(stock_posterior - stock_anterior) FROM movimientos_inventario
                    WHERE inventario_id = p_inv
                      AND tipo NOT IN ('TRANSFERENCIA_OUT','TRANSFERENCIA_IN')), 0)
          = (SELECT COALESCE(stock, 0) FROM inventario WHERE id = p_inv) $$;

CREATE FUNCTION pg_temp.nuevo_item(p_org TEXT, p_codigo TEXT, p_stock INTEGER) RETURNS TEXT LANGUAGE sql AS
$$ INSERT INTO inventario (organization_id, codigo, categoria, precio_compra, nombre, stock, stock_reservado, precio_venta)
   VALUES (p_org, p_codigo, 'PROBE-350', 0, p_codigo, p_stock, 0, 100)
   RETURNING id $$;

-- ── Setup: org con principal + depósito B en la misma sucursal ──
DO $$
DECLARE v_org TEXT; v_p TEXT; v_suc TEXT; v_b TEXT; v_user TEXT;
BEGIN
  SELECT o.id INTO v_org FROM organizations o
  WHERE o.deleted_at IS NULL AND get_deposito_principal(o.id) IS NOT NULL
  ORDER BY o.created_at LIMIT 1;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'SETUP: ninguna org con depósito principal';
  END IF;
  v_p := get_deposito_principal(v_org);
  SELECT sucursal_id INTO v_suc FROM depositos WHERE id = v_p;
  INSERT INTO depositos (organization_id, nombre, principal, activo, sucursal_id)
  VALUES (v_org, 'PROBE-350 B', false, true, v_suc) RETURNING id INTO v_b;
  SELECT id INTO v_user FROM users WHERE organization_id = v_org ORDER BY id LIMIT 1;
  INSERT INTO _ids VALUES ('org', v_org), ('p', v_p), ('b', v_b), ('user', v_user);
END $$;

-- ── G: alta con stock ──
DO $$
DECLARE
  v_org TEXT := pg_temp.id('org'); v_p TEXT := pg_temp.id('p'); v_b TEXT := pg_temp.id('b');
  v_inv TEXT; v_inv0 TEXT; r RECORD; n INTEGER;
BEGIN
  v_inv  := pg_temp.nuevo_item(v_org, 'PROBE-350-G1', 7);
  v_inv0 := pg_temp.nuevo_item(v_org, 'PROBE-350-G0', 0);

  INSERT INTO _r VALUES (10, 'G: alta siembra el principal, sin drift', '7/0',
    pg_temp.dep(v_inv, v_p) || '/' || pg_temp.drift(v_inv));

  SELECT tipo, cantidad, stock_anterior, stock_posterior, deposito_id INTO r
  FROM movimientos_inventario
  WHERE inventario_id = v_inv AND referencia_tipo = 'STOCK_INICIAL';
  INSERT INTO _r VALUES (11, 'G: movimiento STOCK_INICIAL', 'ENTRADA 7 0->7 principal',
    format('%s %s %s->%s %s', r.tipo, r.cantidad, r.stock_anterior, r.stock_posterior,
           CASE WHEN r.deposito_id = v_p THEN 'principal' ELSE COALESCE(r.deposito_id, 'NULL') END));

  SELECT COUNT(*) INTO n FROM movimientos_inventario WHERE inventario_id = v_inv0;
  INSERT INTO _r VALUES (12, 'G: alta con stock 0 no genera movimiento', '0', n::TEXT);

  -- Lo que hace la API al elegir otro depósito (#433 + re-apunte del kardex)
  UPDATE inventario_depositos SET deposito_id = v_b
   WHERE inventario_id = v_inv AND deposito_id = v_p;
  UPDATE movimientos_inventario SET deposito_id = v_b
   WHERE inventario_id = v_inv AND organization_id = v_org AND referencia_tipo = 'STOCK_INICIAL';
  INSERT INTO _r VALUES (13, 'G: tras mover, detalle y kardex en B', '7/B',
    pg_temp.dep(v_inv, v_b) || '/' ||
    (SELECT CASE WHEN deposito_id = v_b THEN 'B' ELSE COALESCE(deposito_id, 'NULL') END
       FROM movimientos_inventario
      WHERE inventario_id = v_inv AND referencia_tipo = 'STOCK_INICIAL'));
  -- El alta es UN movimiento, hecho por el trigger (sin usuario), y el kardex cierra.
  INSERT INTO _r VALUES (14, 'G: un solo movimiento de alta, sin usuario, kardex reconcilia', '1/NULL/true',
    (SELECT COUNT(*)::TEXT FROM movimientos_inventario WHERE inventario_id = v_inv)
    || '/' || COALESCE((SELECT usuario_id FROM movimientos_inventario
                         WHERE inventario_id = v_inv AND referencia_tipo = 'STOCK_INICIAL'), 'NULL')
    || '/' || pg_temp.kardex_ok(v_inv)::TEXT);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES (19, 'G: bloque', 'sin error', SQLSTATE || ' ' || SQLERRM);
END $$;

-- ── A: conteo por depósito (refresh + delta sobre stock actual) ──
DO $$
DECLARE
  v_org TEXT := pg_temp.id('org'); v_p TEXT := pg_temp.id('p');
  v_b TEXT := pg_temp.id('b'); v_user TEXT := pg_temp.id('user');
  v_inv TEXT; v_conteo TEXT; v_res JSONB; r RECORD;
BEGIN
  v_inv := pg_temp.nuevo_item(v_org, 'PROBE-350-A1', 15);
  UPDATE inventario_depositos SET stock = 10 WHERE inventario_id = v_inv AND deposito_id = v_p;
  INSERT INTO inventario_depositos (inventario_id, deposito_id, stock, stock_reservado, organization_id)
  VALUES (v_inv, v_b, 5, 0, v_org);                              -- P10 + B5 = 15

  v_res := iniciar_conteo(v_org, v_user, 'PROBE-350 conteo B', v_b, 'PARCIAL',
                          jsonb_build_object('categoria', 'PROBE-350'), NULL, true, NULL);
  v_conteo := v_res->>'conteoId';

  -- Entra 1 a B entre el snapshot y el conteo físico (B 6, total 16)
  PERFORM adjust_stock_atomic(v_inv, v_org, v_user, 'delta', 1, 'probe', 'AJUSTE', 'AJUSTE_MANUAL', v_b);

  UPDATE conteos_items SET stock_contado = 3 WHERE conteo_id = v_conteo AND inventario_id = v_inv;
  INSERT INTO _r VALUES (20, 'A: stock_sistema se refresca al cargar el conteo', '6',
    (SELECT stock_sistema::TEXT FROM conteos_items WHERE conteo_id = v_conteo AND inventario_id = v_inv));

  -- Sale 1 de B después del conteo físico (B 5, total 15)
  PERFORM adjust_stock_atomic(v_inv, v_org, v_user, 'delta', -1, 'probe', 'AJUSTE', 'AJUSTE_MANUAL', v_b);

  v_res := finalizar_conteo(v_conteo, v_user, true);

  INSERT INTO _r VALUES (21, 'A: B = contado - salidas posteriores; P intacto; total = suma',
    'B=2 P=10 T=12 drift=0',
    format('B=%s P=%s T=%s drift=%s', pg_temp.dep(v_inv, v_b), pg_temp.dep(v_inv, v_p),
           pg_temp.total(v_inv), pg_temp.drift(v_inv)));

  SELECT cantidad, stock_anterior, stock_posterior, deposito_id INTO r
  FROM movimientos_inventario WHERE inventario_id = v_inv AND referencia_tipo = 'CONTEO';
  INSERT INTO _r VALUES (22, 'A: movimiento con totales del item y depósito B', '-3 15->12 B',
    format('%s %s->%s %s', r.cantidad, r.stock_anterior, r.stock_posterior,
           CASE WHEN r.deposito_id = v_b THEN 'B' ELSE COALESCE(r.deposito_id, 'NULL') END));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES (29, 'A depósito: bloque', 'sin error', SQLSTATE || ' ' || SQLERRM);
END $$;

-- ── A: conteo global (sobrante al principal, faltante drena principal-primero) ──
DO $$
DECLARE
  v_org TEXT := pg_temp.id('org'); v_p TEXT := pg_temp.id('p');
  v_b TEXT := pg_temp.id('b'); v_user TEXT := pg_temp.id('user');
  v_i2 TEXT; v_i3 TEXT; v_conteo TEXT; v_res JSONB;
BEGIN
  v_i2 := pg_temp.nuevo_item(v_org, 'PROBE-350-A2', 10);
  UPDATE inventario_depositos SET stock = 6 WHERE inventario_id = v_i2 AND deposito_id = v_p;
  INSERT INTO inventario_depositos (inventario_id, deposito_id, stock, stock_reservado, organization_id)
  VALUES (v_i2, v_b, 4, 0, v_org);                               -- P6 + B4
  v_i3 := pg_temp.nuevo_item(v_org, 'PROBE-350-A3', 7);
  UPDATE inventario_depositos SET stock = 2 WHERE inventario_id = v_i3 AND deposito_id = v_p;
  INSERT INTO inventario_depositos (inventario_id, deposito_id, stock, stock_reservado, organization_id)
  VALUES (v_i3, v_b, 5, 0, v_org);                               -- P2 + B5

  v_res := iniciar_conteo(v_org, v_user, 'PROBE-350 conteo global', NULL, 'PARCIAL',
                          jsonb_build_object('categoria', 'PROBE-350'), NULL, true, NULL);
  v_conteo := v_res->>'conteoId';
  UPDATE conteos_items SET stock_contado = 13 WHERE conteo_id = v_conteo AND inventario_id = v_i2;
  UPDATE conteos_items SET stock_contado = 1  WHERE conteo_id = v_conteo AND inventario_id = v_i3;
  v_res := finalizar_conteo(v_conteo, v_user, true);

  INSERT INTO _r VALUES (30, 'A global: sobrante +3 al principal', 'P=9 B=4 T=13 drift=0',
    format('P=%s B=%s T=%s drift=%s', pg_temp.dep(v_i2, v_p), pg_temp.dep(v_i2, v_b),
           pg_temp.total(v_i2), pg_temp.drift(v_i2)));
  INSERT INTO _r VALUES (31, 'A global: faltante -6 drena principal primero', 'P=0 B=1 T=1 drift=0',
    format('P=%s B=%s T=%s drift=%s', pg_temp.dep(v_i3, v_p), pg_temp.dep(v_i3, v_b),
           pg_temp.total(v_i3), pg_temp.drift(v_i3)));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES (39, 'A global: bloque', 'sin error', SQLSTATE || ' ' || SQLERRM);
END $$;

-- ── B1: kits sin depósito, reservas y estricto ──
DO $$
DECLARE
  v_org TEXT := pg_temp.id('org'); v_p TEXT := pg_temp.id('p');
  v_b TEXT := pg_temp.id('b'); v_user TEXT := pg_temp.id('user');
  v_comp TEXT; v_kit TEXT; v_res JSONB; v_err TEXT; n INTEGER;
BEGIN
  v_comp := pg_temp.nuevo_item(v_org, 'PROBE-350-K-COMP', 10);
  v_kit  := pg_temp.nuevo_item(v_org, 'PROBE-350-K-KIT', 0);
  UPDATE inventario SET es_kit = true, tipo_kit = 'ENSAMBLADO' WHERE id = v_kit;
  INSERT INTO inventario_kit_items (kit_id, componente_id, cantidad, organization_id)
  VALUES (v_kit, v_comp, 2, v_org);

  v_res := ensamblar_kit_atomic(v_kit, 3, v_org, v_user, NULL, NULL);      -- comp 4, kit 3
  INSERT INTO _r VALUES (40, 'B1: ensamblar sin depósito mantiene la invariante',
    'comp T=4 drift=0 | kit P=3 drift=0',
    format('comp T=%s drift=%s | kit P=%s drift=%s', pg_temp.total(v_comp), pg_temp.drift(v_comp),
           pg_temp.dep(v_kit, v_p), pg_temp.drift(v_kit)));

  SELECT COUNT(*) INTO n FROM movimientos_inventario
  WHERE inventario_id IN (v_comp, v_kit) AND referencia_tipo = 'ENSAMBLAJE_KIT' AND deposito_id IS NULL;
  INSERT INTO _r VALUES (41, 'B1: movimientos con depósito efectivo', '0', n::TEXT);

  v_res := desensamblar_kit_atomic(v_kit, 1, v_org, v_user, NULL, NULL);   -- kit 2, comp 6
  INSERT INTO _r VALUES (42, 'B1: desensamblar sin depósito', 'kit T=2 drift=0 | comp T=6 drift=0',
    format('kit T=%s drift=%s | comp T=%s drift=%s', pg_temp.total(v_kit), pg_temp.drift(v_kit),
           pg_temp.total(v_comp), pg_temp.drift(v_comp)));

  UPDATE inventario SET stock_reservado = 2 WHERE id = v_kit;
  UPDATE inventario_depositos SET stock_reservado = 2 WHERE inventario_id = v_kit AND deposito_id = v_p;
  BEGIN
    PERFORM desensamblar_kit_atomic(v_kit, 1, v_org, v_user, NULL, NULL);
    v_err := 'sin error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE;
  END;
  INSERT INTO _r VALUES (43, 'B1: desensamblar unidades reservadas -> P0003', 'P0003', v_err);

  BEGIN
    PERFORM ensamblar_kit_atomic(v_kit, 1, v_org, v_user, v_b, NULL);
    v_err := 'sin error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE;
  END;
  INSERT INTO _r VALUES (44, 'B1: ensamblar en depósito sin componentes -> P0003', 'P0003', v_err);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES (49, 'B1: bloque', 'sin error', SQLSTATE || ' ' || SQLERRM);
END $$;

-- ── B2: consolidar (multi-depósito + origen con drift) ──
DO $$
DECLARE
  v_org TEXT := pg_temp.id('org'); v_p TEXT := pg_temp.id('p');
  v_b TEXT := pg_temp.id('b'); v_user TEXT := pg_temp.id('user');
  v_s TEXT; v_t TEXT; v_s2 TEXT; v_t2 TEXT; v_res JSONB; n INTEGER;
BEGIN
  v_s := pg_temp.nuevo_item(v_org, 'PROBE-350-C-SRC', 5);
  UPDATE inventario_depositos SET stock = 3 WHERE inventario_id = v_s AND deposito_id = v_p;
  INSERT INTO inventario_depositos (inventario_id, deposito_id, stock, stock_reservado, organization_id)
  VALUES (v_s, v_b, 2, 0, v_org);                                -- P3 + B2
  v_t := pg_temp.nuevo_item(v_org, 'PROBE-350-C-TGT', 4);        -- P4

  v_res := consolidate_inventario_items(v_s, v_t, v_user);
  INSERT INTO _r VALUES (50, 'B2: destino recibe por depósito', 'T=9 P=7 B=2 drift=0',
    format('T=%s P=%s B=%s drift=%s', pg_temp.total(v_t), pg_temp.dep(v_t, v_p),
           pg_temp.dep(v_t, v_b), pg_temp.drift(v_t)));
  SELECT COUNT(*) INTO n FROM inventario_depositos WHERE inventario_id = v_s;
  INSERT INTO _r VALUES (51, 'B2: origen archivado sin detalle', 'T=0 filas=0 archivado=true',
    format('T=%s filas=%s archivado=%s', pg_temp.total(v_s), n,
           (SELECT deleted_at IS NOT NULL FROM inventario WHERE id = v_s)));
  SELECT COUNT(*) INTO n FROM movimientos_inventario
  WHERE inventario_id IN (v_s, v_t) AND referencia_tipo = 'CONSOLIDACION' AND deposito_id IS NOT NULL;
  INSERT INTO _r VALUES (52, 'B2: un par de movimientos por depósito', '4', n::TEXT);

  -- Origen con drift (total 6, detalle 4): se normaliza antes de mover
  v_s2 := pg_temp.nuevo_item(v_org, 'PROBE-350-C-SRC2', 4);
  UPDATE inventario SET stock = 6 WHERE id = v_s2;
  v_t2 := pg_temp.nuevo_item(v_org, 'PROBE-350-C-TGT2', 1);
  v_res := consolidate_inventario_items(v_s2, v_t2, v_user);
  INSERT INTO _r VALUES (53, 'B2: drift del origen normalizado', 'T=7 P=7 drift=0',
    format('T=%s P=%s drift=%s', pg_temp.total(v_t2), pg_temp.dep(v_t2, v_p), pg_temp.drift(v_t2)));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES (59, 'B2: bloque', 'sin error', SQLSTATE || ' ' || SQLERRM);
END $$;

-- ── F: lotes / series ──
DO $$
DECLARE
  v_org TEXT := pg_temp.id('org'); v_p TEXT := pg_temp.id('p'); v_user TEXT := pg_temp.id('user');
  v_l TEXT; v_res JSONB; v_ajeno TEXT; v_err TEXT;
BEGIN
  v_l := pg_temp.nuevo_item(v_org, 'PROBE-350-L', 0);
  UPDATE inventario SET trackea_lotes = true, trackea_series = true WHERE id = v_l;

  v_res := registrar_entrada_lote(p_organization_id => v_org, p_user_id => v_user,
                                  p_inventario_id => v_l, p_numero_lote => 'PROBE-L1', p_cantidad => 4);
  INSERT INTO _r VALUES (60, 'F: lote sin depósito va al principal determinista', 'P=4 drift=0 mov=principal',
    format('P=%s drift=%s mov=%s', pg_temp.dep(v_l, v_p), pg_temp.drift(v_l),
      (SELECT CASE WHEN deposito_id = v_p THEN 'principal' ELSE COALESCE(deposito_id, 'NULL') END
         FROM movimientos_inventario WHERE id = v_res->>'movimientoId')));

  v_res := registrar_entrada_series(p_organization_id => v_org, p_user_id => v_user,
                                    p_inventario_id => v_l, p_numeros_serie => ARRAY['PROBE-S1','PROBE-S2']);
  INSERT INTO _r VALUES (61, 'F: series sin depósito al principal', 'P=6 drift=0',
    format('P=%s drift=%s', pg_temp.dep(v_l, v_p), pg_temp.drift(v_l)));

  SELECT id INTO v_ajeno FROM proveedores WHERE organization_id <> v_org LIMIT 1;
  IF v_ajeno IS NULL THEN
    INSERT INTO _r VALUES (62, 'F: proveedor de otra org rechazado', 'P0002', 'P0002');  -- SALTEADO: sin datos
  ELSE
    BEGIN
      PERFORM registrar_entrada_lote(p_organization_id => v_org, p_user_id => v_user,
        p_inventario_id => v_l, p_numero_lote => 'PROBE-L2', p_cantidad => 1, p_proveedor_id => v_ajeno);
      v_err := 'sin error';
    EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE;
    END;
    INSERT INTO _r VALUES (62, 'F: proveedor de otra org rechazado', 'P0002', v_err);
  END IF;

  SELECT id INTO v_ajeno FROM ordenes_compra WHERE organization_id <> v_org LIMIT 1;
  IF v_ajeno IS NULL THEN
    INSERT INTO _r VALUES (63, 'F: OC de otra org rechazada', 'P0002', 'P0002');          -- SALTEADO: sin datos
  ELSE
    BEGIN
      PERFORM registrar_entrada_lote(p_organization_id => v_org, p_user_id => v_user,
        p_inventario_id => v_l, p_numero_lote => 'PROBE-L3', p_cantidad => 1, p_orden_compra_id => v_ajeno);
      v_err := 'sin error';
    EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE;
    END;
    INSERT INTO _r VALUES (63, 'F: OC de otra org rechazada', 'P0002', v_err);
  END IF;

  SELECT id INTO v_ajeno FROM depositos WHERE organization_id <> v_org AND deleted_at IS NULL LIMIT 1;
  IF v_ajeno IS NULL THEN
    INSERT INTO _r VALUES (64, 'F: depósito de otra org rechazado (series)', 'P0002', 'P0002');
  ELSE
    BEGIN
      PERFORM registrar_entrada_series(p_organization_id => v_org, p_user_id => v_user,
        p_inventario_id => v_l, p_numeros_serie => ARRAY['PROBE-S3'], p_deposito_id => v_ajeno);
      v_err := 'sin error';
    EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE;
    END;
    INSERT INTO _r VALUES (64, 'F: depósito de otra org rechazado (series)', 'P0002', v_err);
  END IF;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES (69, 'F: bloque', 'sin error', SQLSTATE || ' ' || SQLERRM);
END $$;

-- ── H: variantes ──
DO $$
DECLARE
  v_org TEXT := pg_temp.id('org'); v_user TEXT := pg_temp.id('user');
  v_v TEXT; v_res JSONB;
BEGIN
  v_v := pg_temp.nuevo_item(v_org, 'PROBE-350-V', 10);
  v_res := crear_variantes_bulk(v_v, v_org, v_user,
    '[{"nombre":"Rojo","codigo_variante":"PROBE-R","stock":4},
      {"nombre":"Azul","codigo_variante":"PROBE-A","stock":3}]'::jsonb);
  INSERT INTO _r VALUES (70, 'H: alta de variantes (10 legacy -> 4+3)', 'T=7 drift=0 kardex=true',
    format('T=%s drift=%s kardex=%s', pg_temp.total(v_v), pg_temp.drift(v_v), pg_temp.kardex_ok(v_v)));

  PERFORM ajustar_stock_variante_atomic(v_res->'ids'->>0, v_org, v_user, 'delta', 2, 'probe');
  INSERT INTO _r VALUES (71, 'H: ajuste de variante +2', 'T=9 drift=0 kardex=true',
    format('T=%s drift=%s kardex=%s', pg_temp.total(v_v), pg_temp.drift(v_v), pg_temp.kardex_ok(v_v)));

  -- Soft-delete directo (como la ruta DELETE): el trigger mueve el detalle.
  UPDATE inventario_variantes SET deleted_at = NOW(), activo = false WHERE id = v_res->'ids'->>1;
  INSERT INTO _r VALUES (72, 'H: soft-delete de variante (sin movimiento: gap conocido)', 'T=6 drift=0 kardex=false',
    format('T=%s drift=%s kardex=%s', pg_temp.total(v_v), pg_temp.drift(v_v), pg_temp.kardex_ok(v_v)));

  PERFORM eliminar_variantes_y_consolidar(v_v, v_org, v_user);
  INSERT INTO _r VALUES (73, 'H: consolidar variantes', 'T=6 drift=0 variantes=false',
    format('T=%s drift=%s variantes=%s', pg_temp.total(v_v), pg_temp.drift(v_v),
           (SELECT tiene_variantes FROM inventario WHERE id = v_v)));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES (79, 'H: bloque', 'sin error', SQLSTATE || ' ' || SQLERRM);
END $$;

-- ── Global: ningún item de la probe con drift; kardex encadenado salvo los conocidos ──
INSERT INTO _r
SELECT 90, 'Global: items PROBE con drift', 'ninguno',
       COALESCE(string_agg(codigo, ',' ORDER BY codigo), 'ninguno')
FROM inventario
WHERE organization_id = pg_temp.id('org') AND categoria = 'PROBE-350'
  AND pg_temp.drift(id) <> 0;

INSERT INTO _r
SELECT 91, 'Global: kardex no reconcilia (esperados: SRC2 drift artificial, V soft-delete)',
       'PROBE-350-C-SRC2,PROBE-350-V',
       COALESCE(string_agg(codigo, ',' ORDER BY codigo), 'ninguno')
FROM inventario
WHERE organization_id = pg_temp.id('org') AND categoria = 'PROBE-350'
  AND NOT pg_temp.kardex_ok(id);

-- ── Permisos de la funcion nueva (solo service_role) ──
INSERT INTO _r VALUES (95, 'Permisos: conteo_item_refrescar_sistema solo service_role',
  'anon=false auth=false service_role=true',
  format('anon=%s auth=%s service_role=%s',
    has_function_privilege('anon', 'conteo_item_refrescar_sistema()', 'EXECUTE'),
    has_function_privilege('authenticated', 'conteo_item_refrescar_sistema()', 'EXECUTE'),
    has_function_privilege('service_role', 'conteo_item_refrescar_sistema()', 'EXECUTE')));

SELECT orden, probe, esperado, obtenido,
       CASE WHEN esperado = obtenido THEN 'OK' ELSE 'FALLA' END AS resultado
FROM _r ORDER BY orden;

ROLLBACK;
