-- =============================================================================
-- Verificación de la migración 354 — entregar_lote_recepcion sin pago_idempotency
-- y con fecha_completado.
--
-- CÓMO CORRERLO (ver verify/README.md):
--   - DESPUES de aplicar 354 (con 353 aplicada, el probe 1 falla: es el rojo).
--   - SIN RLS: las rutas usan supabaseAdmin (service_role), igual que este probe.
--   - node scripts/db-run.mjs supabase/migrations/verify/354_probes.sql
--     (el archivo trae su propio BEGIN y cierra con ROLLBACK: no persiste nada).
--
-- Todo corre dentro de BEGIN/ROLLBACK. Crea una organización/sucursal/cliente/
-- recepción de prueba ('probe-354-...') con tres órdenes REPARADO:
--   orden 1: costo 10000, fecha_completado ya seteada (2026-01-01)
--   orden 2: costo 20000, fecha_completado NULL
--   orden 3: costo 30000, fecha_completado NULL
-- Lote con 10% de descuento: total 54000 -> se cobra 9000 / 18000 / 27000 y el
-- descuento_cobro de cada orden queda en 1000 / 2000 / 3000.
--
-- Los resultados se acumulan en _r y salen en UN solo SELECT al final.
-- Verde = `esperado` coincide con `obtenido` en todas las filas.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);
CREATE TEMP TABLE _s (org_id TEXT, rec_id TEXT, o1 TEXT, o2 TEXT, o3 TEXT, usuario TEXT);

INSERT INTO _r SELECT 0, 'pago_idempotency ausente (antes)', 'ausente',
  CASE WHEN to_regclass('public.pago_idempotency') IS NULL THEN 'ausente' ELSE 'presente' END;

DO $$
DECLARE
  v_org TEXT; v_suc TEXT; v_cli TEXT; v_rec TEXT; v_o1 TEXT; v_o2 TEXT; v_o3 TEXT; v_usr TEXT;
BEGIN
  -- cobros_orden.usuario_id tiene FK a users: se reutiliza un usuario existente
  -- (solo se lee su id, no se modifica nada).
  SELECT id INTO v_usr FROM users LIMIT 1;
  INSERT INTO organizations (nombre, slug) VALUES ('Probe 354 Org', 'probe-354-org') RETURNING id INTO v_org;
  INSERT INTO sucursales (organization_id, nombre) VALUES (v_org, 'Probe 354 Sucursal') RETURNING id INTO v_suc;
  INSERT INTO clientes (nombre, telefono, organization_id) VALUES ('Probe 354 Cliente', '3120000353', v_org) RETURNING id INTO v_cli;

  INSERT INTO recepciones (organization_id, cliente_id, codigo, numero, descuento_tipo, descuento_valor)
    VALUES (v_org, v_cli, 'PROBE-354', 1, 'porcentaje', 10) RETURNING id INTO v_rec;

  INSERT INTO ordenes_servicio (organization_id, sucursal_id, cliente_id, numero_orden, dispositivo, problema_reportado, estado, costo_final, recepcion_id, fecha_completado)
    VALUES (v_org, v_suc, v_cli, 1, 'Probe 1', 'p', 'REPARADO', 10000, v_rec, '2026-01-01T00:00:00Z') RETURNING id INTO v_o1;
  INSERT INTO ordenes_servicio (organization_id, sucursal_id, cliente_id, numero_orden, dispositivo, problema_reportado, estado, costo_final, recepcion_id)
    VALUES (v_org, v_suc, v_cli, 2, 'Probe 2', 'p', 'REPARADO', 20000, v_rec) RETURNING id INTO v_o2;
  INSERT INTO ordenes_servicio (organization_id, sucursal_id, cliente_id, numero_orden, dispositivo, problema_reportado, estado, costo_final, recepcion_id)
    VALUES (v_org, v_suc, v_cli, 3, 'Probe 3', 'p', 'REPARADO', 30000, v_rec) RETURNING id INTO v_o3;

  INSERT INTO _s VALUES (v_org, v_rec, v_o1, v_o2, v_o3, v_usr);
END $$;

INSERT INTO _r SELECT 0, 'setup: 3 ordenes REPARADO en el lote', '3',
  COUNT(*)::TEXT FROM ordenes_servicio WHERE recepcion_id = (SELECT rec_id FROM _s) AND estado = 'REPARADO';
INSERT INTO _r SELECT 0, 'setup: fecha_completado NULL en 2 de 3', '2',
  COUNT(*)::TEXT FROM ordenes_servicio WHERE recepcion_id = (SELECT rec_id FROM _s) AND fecha_completado IS NULL;

-- ---------------------------------------------------------------------------
-- PROBE 1 — La entrega del lote CON clave de idempotencia no nula funciona.
-- (En 353 falla con: relation "pago_idempotency" does not exist.)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  s RECORD;
  v_res JSONB;
BEGIN
  SELECT * INTO s FROM _s;
  BEGIN
    v_res := entregar_lote_recepcion(
      s.org_id, s.rec_id, s.usuario,
      jsonb_build_array(
        jsonb_build_object('id', s.o1, 'costoFinal', 10000, 'montoCobro', 9000),
        jsonb_build_object('id', s.o2, 'costoFinal', 20000, 'montoCobro', 18000),
        jsonb_build_object('id', s.o3, 'costoFinal', 30000, 'montoCobro', 27000)
      ),
      'EFECTIVO', NULL, 'probe 354', 'probe-354-clave');
    INSERT INTO _r VALUES (1, 'entrega con clave no nula: sin error', 'OK',
      'OK');
    INSERT INTO _r VALUES (1, 'respuesta lista 3 ordenes', '3', jsonb_array_length(v_res->'ordenes')::TEXT);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES (1, 'entrega con clave no nula: sin error', 'OK', 'ERROR: ' || SQLERRM);
  END;
END $$;

-- ---------------------------------------------------------------------------
-- PROBES 2 a 5 — Estado final, fecha_completado, cobros y descuentos.
-- ---------------------------------------------------------------------------
INSERT INTO _r SELECT 2, 'las 3 ordenes quedan ENTREGADO', '3',
  COUNT(*)::TEXT FROM ordenes_servicio WHERE recepcion_id = (SELECT rec_id FROM _s) AND estado = 'ENTREGADO';

INSERT INTO _r SELECT 3, 'las 3 ordenes tienen fecha_completado', '3',
  COUNT(*)::TEXT FROM ordenes_servicio WHERE recepcion_id = (SELECT rec_id FROM _s) AND fecha_completado IS NOT NULL;
INSERT INTO _r SELECT 3, 'orden con fecha_completado previa: no se pisa', '2026-01-01',
  COALESCE((SELECT to_char(fecha_completado AT TIME ZONE 'UTC', 'YYYY-MM-DD') FROM ordenes_servicio WHERE id = (SELECT o1 FROM _s)), 'NULL');
INSERT INTO _r SELECT 3, 'orden con fecha_completado NULL: queda seteada (hoy)', 'true',
  COALESCE((SELECT (fecha_completado >= NOW() - INTERVAL '1 hour')::TEXT FROM ordenes_servicio WHERE id = (SELECT o2 FROM _s)), 'NULL');

INSERT INTO _r SELECT 4, 'suma cobrada del lote', '54000.00',
  COALESCE(SUM(monto), 0)::NUMERIC(12,2)::TEXT FROM cobros_orden WHERE orden_id IN (SELECT o1 FROM _s UNION SELECT o2 FROM _s UNION SELECT o3 FROM _s);
INSERT INTO _r SELECT 4, 'un cobro por orden', '3',
  COUNT(*)::TEXT FROM cobros_orden WHERE orden_id IN (SELECT o1 FROM _s UNION SELECT o2 FROM _s UNION SELECT o3 FROM _s);
INSERT INTO _r SELECT 4, 'cobro orden 1', '9000.00',
  COALESCE((SELECT SUM(monto)::NUMERIC(12,2)::TEXT FROM cobros_orden WHERE orden_id = (SELECT o1 FROM _s)), 'NULL');
INSERT INTO _r SELECT 4, 'cobro orden 3', '27000.00',
  COALESCE((SELECT SUM(monto)::NUMERIC(12,2)::TEXT FROM cobros_orden WHERE orden_id = (SELECT o3 FROM _s)), 'NULL');

INSERT INTO _r SELECT 5, 'descuento_cobro orden 1', '1000.00',
  COALESCE((SELECT descuento_cobro::NUMERIC(12,2)::TEXT FROM ordenes_servicio WHERE id = (SELECT o1 FROM _s)), 'NULL');
INSERT INTO _r SELECT 5, 'descuento_cobro orden 2', '2000.00',
  COALESCE((SELECT descuento_cobro::NUMERIC(12,2)::TEXT FROM ordenes_servicio WHERE id = (SELECT o2 FROM _s)), 'NULL');
INSERT INTO _r SELECT 5, 'descuento_cobro orden 3', '3000.00',
  COALESCE((SELECT descuento_cobro::NUMERIC(12,2)::TEXT FROM ordenes_servicio WHERE id = (SELECT o3 FROM _s)), 'NULL');
INSERT INTO _r SELECT 5, 'sin saldo pendiente: estado_cobro', 'COBRADO,COBRADO,COBRADO',
  COALESCE((SELECT string_agg(estado_cobro::TEXT, ',' ORDER BY numero_orden) FROM ordenes_servicio WHERE recepcion_id = (SELECT rec_id FROM _s)), 'NULL');

-- ---------------------------------------------------------------------------
-- PROBE 6 — Un segundo llamado identico falla y no escribe nada.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _antes AS
  SELECT (SELECT COUNT(*) FROM cobros_orden WHERE orden_id IN (SELECT o1 FROM _s UNION SELECT o2 FROM _s UNION SELECT o3 FROM _s)) AS cobros,
         (SELECT COUNT(*) FROM orden_eventos WHERE orden_id IN (SELECT o1 FROM _s UNION SELECT o2 FROM _s UNION SELECT o3 FROM _s)) AS eventos;

DO $$
DECLARE
  s RECORD;
BEGIN
  SELECT * INTO s FROM _s;
  BEGIN
    PERFORM entregar_lote_recepcion(
      s.org_id, s.rec_id, s.usuario,
      jsonb_build_array(
        jsonb_build_object('id', s.o1, 'costoFinal', 10000, 'montoCobro', 9000),
        jsonb_build_object('id', s.o2, 'costoFinal', 20000, 'montoCobro', 18000),
        jsonb_build_object('id', s.o3, 'costoFinal', 30000, 'montoCobro', 27000)
      ),
      'EFECTIVO', NULL, 'probe 354', 'probe-354-clave');
    INSERT INTO _r VALUES (6, 'segundo llamado falla', 'ERROR', 'sin error');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES (6, 'segundo llamado falla', 'ERROR', 'ERROR');
    INSERT INTO _r VALUES (6, 'segundo llamado: codigo de error', 'true', (SQLERRM LIKE 'LOTE_ERROR:ORDEN_NO_REPARADA%')::TEXT);
  END;
END $$;

INSERT INTO _r SELECT 6, 'segundo llamado: no agrega cobros', '0',
  ((SELECT COUNT(*) FROM cobros_orden WHERE orden_id IN (SELECT o1 FROM _s UNION SELECT o2 FROM _s UNION SELECT o3 FROM _s)) - (SELECT cobros FROM _antes))::TEXT;
INSERT INTO _r SELECT 6, 'segundo llamado: no agrega eventos', '0',
  ((SELECT COUNT(*) FROM orden_eventos WHERE orden_id IN (SELECT o1 FROM _s UNION SELECT o2 FROM _s UNION SELECT o3 FROM _s)) - (SELECT eventos FROM _antes))::TEXT;
INSERT INTO _r SELECT 6, 'segundo llamado: suma cobrada intacta', '54000.00',
  COALESCE(SUM(monto), 0)::NUMERIC(12,2)::TEXT FROM cobros_orden WHERE orden_id IN (SELECT o1 FROM _s UNION SELECT o2 FROM _s UNION SELECT o3 FROM _s);

-- ---------------------------------------------------------------------------
-- PROBE 7 — pago_idempotency sigue ausente (esta migracion no la crea).
-- ---------------------------------------------------------------------------
INSERT INTO _r SELECT 7, 'pago_idempotency ausente (despues)', 'ausente',
  CASE WHEN to_regclass('public.pago_idempotency') IS NULL THEN 'ausente' ELSE 'presente' END;

SELECT orden, probe, esperado, obtenido,
       CASE WHEN esperado = obtenido THEN 'OK' ELSE 'FALLA' END AS resultado
FROM _r ORDER BY orden, probe;

ROLLBACK;
