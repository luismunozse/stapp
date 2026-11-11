-- Verificación de reclamos_garantia_unificados (401).
--
-- Correr DESPUÉS de aplicar:  node scripts/db-run.mjs supabase/migrations/verify/401_probes.sql
-- (sin --apply: termina en ROLLBACK). Las filas de prueba se deshacen.
--
-- Resultado: UN select, todo en ok = true.

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

INSERT INTO _r
SELECT 1, 'reclamos_garantia.organization_id NOT NULL', 'NO', is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'reclamos_garantia' AND column_name = 'organization_id';

INSERT INTO _r
SELECT 2, 'garantia_id admite NULL', 'YES', is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'reclamos_garantia' AND column_name = 'garantia_id';

INSERT INTO _r
SELECT 3, 'restricciones validadas', '7', count(*)::text
FROM pg_constraint
WHERE conrelid = 'public.reclamos_garantia'::regclass AND convalidated
  AND conname IN ('reclamos_garantia_garantia_venta_id_fkey', 'reclamos_garantia_orden_reingreso_id_fkey',
                  'reclamos_garantia_registrado_por_fkey', 'reclamos_garantia_decidido_por_fkey',
                  'reclamos_garantia_un_origen', 'reclamos_garantia_rechazo_con_motivo',
                  'reclamos_garantia_organization_id_fkey');

INSERT INTO _r
SELECT 4, 'ningún reclamo con otra org que la de su garantía', '0', count(*)::text
FROM reclamos_garantia r
LEFT JOIN garantias g ON g.id = r.garantia_id
LEFT JOIN garantias_venta gv ON gv.id = r.garantia_venta_id
WHERE r.organization_id IS DISTINCT FROM COALESCE(g.organization_id, gv.organization_id);

INSERT INTO _r
SELECT 5, 'ningún EN_REVISION', '0', count(*)::text FROM reclamos_garantia WHERE estado = 'EN_REVISION';

INSERT INTO _r
SELECT 6, 'ningún ACEPTADO sin orden de re-ingreso', '0', count(*)::text
FROM reclamos_garantia WHERE estado = 'ACEPTADO' AND orden_reingreso_id IS NULL;

INSERT INTO _r
SELECT 7, 'orden_reparacion_id espeja a orden_reingreso_id', '0', count(*)::text
FROM reclamos_garantia
WHERE orden_reingreso_id IS NOT NULL AND orden_reparacion_id IS DISTINCT FROM orden_reingreso_id;

INSERT INTO _r
SELECT 8, 'a lo sumo un reclamo abierto por garantía', '0', count(*)::text
FROM (SELECT COALESCE(garantia_id, garantia_venta_id) FROM reclamos_garantia
       WHERE estado IN ('PENDIENTE', 'EN_REVISION', 'ACEPTADO')
       GROUP BY 1 HAVING count(*) > 1) d;

INSERT INTO _r
SELECT 9, 'toda orden de un reclamo es re-ingreso', '0', count(*)::text
FROM reclamos_garantia r JOIN ordenes_servicio o ON o.id = r.orden_reingreso_id
WHERE NOT o.es_reingreso;

INSERT INTO _r
SELECT 10, 'security_invoker en la vista', 'true',
  COALESCE((SELECT 'true' FROM pg_class WHERE oid = 'public.v_garantias'::regclass
             AND 'security_invoker=true' = ANY (reloptions)), 'false');

INSERT INTO _r VALUES
  (11, 'anon no lee la vista', 'false', has_table_privilege('anon', 'public.v_garantias', 'SELECT')::text),
  (12, 'authenticated no lee la vista', 'false', has_table_privilege('authenticated', 'public.v_garantias', 'SELECT')::text),
  (13, 'service_role lee la vista', 'true', has_table_privilege('service_role', 'public.v_garantias', 'SELECT')::text);

INSERT INTO _r
SELECT 14, 'tiene_reclamo_abierto coincide con la tabla de reclamos', '0', count(*)::text
FROM v_garantias vg
WHERE vg.tiene_reclamo_abierto IS DISTINCT FROM EXISTS (
  SELECT 1 FROM reclamos_garantia r
   WHERE (r.garantia_id = vg.id OR r.garantia_venta_id = vg.id)
     AND r.estado IN ('PENDIENTE', 'EN_REVISION', 'ACEPTADO'));

-- Un reclamo de venta: el trigger fija la org, el índice impide el duplicado y
-- la garantía queda RECLAMADA.
DO $$
DECLARE v_gv RECORD; v_otra TEXT; v_org TEXT; v_estado TEXT;
BEGIN
  SELECT gv.id, gv.organization_id INTO v_gv
    FROM garantias_venta gv
   WHERE gv.estado::TEXT = 'ACTIVA'
     AND NOT EXISTS (SELECT 1 FROM reclamos_garantia r WHERE r.garantia_venta_id = gv.id)
   LIMIT 1;
  IF v_gv.id IS NULL THEN
    INSERT INTO _r VALUES (15, 'reclamo de venta: org de la garantía', 'ok', 'sin candidato');
    INSERT INTO _r VALUES (16, 'reclamo de venta: duplicado rechazado', 'ok', 'sin candidato');
    INSERT INTO _r VALUES (17, 'reclamo de venta: garantía RECLAMADA', 'RECLAMADA', 'sin candidato');
    RETURN;
  END IF;
  SELECT id INTO v_otra FROM organizations WHERE id <> v_gv.organization_id LIMIT 1;
  INSERT INTO reclamos_garantia (garantia_venta_id, descripcion, organization_id)
  VALUES (v_gv.id, 'probe 401', v_otra)
  RETURNING organization_id INTO v_org;
  INSERT INTO _r VALUES (15, 'reclamo de venta: org de la garantía', 'ok',
    CASE WHEN v_org = v_gv.organization_id THEN 'ok' ELSE 'otra: ' || COALESCE(v_org, 'NULL') END);
  SELECT estado::TEXT INTO v_estado FROM garantias_venta WHERE id = v_gv.id;
  INSERT INTO _r VALUES (17, 'reclamo de venta: garantía RECLAMADA', 'RECLAMADA', v_estado);
  BEGIN
    INSERT INTO reclamos_garantia (garantia_venta_id, descripcion) VALUES (v_gv.id, 'probe 401 bis');
    INSERT INTO _r VALUES (16, 'reclamo de venta: duplicado rechazado', 'ok', 'se insertó');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO _r VALUES (16, 'reclamo de venta: duplicado rechazado', 'ok', 'ok');
  END;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES (15, 'reclamo de venta: org de la garantía', 'ok', SQLERRM);
END $$;

-- Un reclamo con las dos garantías (o ninguna) lo rechaza el CHECK.
DO $$
BEGIN
  INSERT INTO reclamos_garantia (descripcion) VALUES ('probe 401 sin origen');
  INSERT INTO _r VALUES (18, 'reclamo sin garantía rechazado', 'ok', 'se insertó');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES (18, 'reclamo sin garantía rechazado', 'ok', 'ok');
END $$;

-- Entregar el re-ingreso resuelve el reclamo ACEPTADO.
DO $$
DECLARE v_g RECORD; v_reingreso TEXT; v_reclamo TEXT; v_estado TEXT;
BEGIN
  SELECT g.id, o.id AS orden_id INTO v_g
    FROM garantias g JOIN ordenes_servicio o ON o.id = g.orden_id
   WHERE NOT EXISTS (SELECT 1 FROM reclamos_garantia r
                      WHERE r.garantia_id = g.id AND r.estado IN ('PENDIENTE', 'EN_REVISION', 'ACEPTADO'))
   LIMIT 1;
  IF v_g.id IS NULL THEN
    INSERT INTO _r VALUES (19, 'entregar el re-ingreso resuelve el reclamo', 'RESUELTO', 'sin candidato');
    RETURN;
  END IF;
  SELECT o.id INTO v_reingreso FROM ordenes_servicio o
   WHERE o.organization_id = (SELECT organization_id FROM garantias WHERE id = v_g.id)
     AND o.id <> v_g.orden_id
     AND o.estado::TEXT NOT IN ('ENTREGADO', 'ENTREGADO_SIN_REPARACION', 'ENTREGADO_SIN_COBRO')
   LIMIT 1;
  IF v_reingreso IS NULL THEN
    INSERT INTO _r VALUES (19, 'entregar el re-ingreso resuelve el reclamo', 'RESUELTO', 'sin candidato');
    RETURN;
  END IF;
  UPDATE ordenes_servicio SET es_reingreso = TRUE WHERE id = v_reingreso;
  INSERT INTO reclamos_garantia (garantia_id, descripcion, estado, orden_reingreso_id)
  VALUES (v_g.id, 'probe 401 entrega', 'ACEPTADO', v_reingreso)
  RETURNING id INTO v_reclamo;
  UPDATE ordenes_servicio SET estado = 'ENTREGADO' WHERE id = v_reingreso;
  SELECT estado::TEXT INTO v_estado FROM reclamos_garantia WHERE id = v_reclamo;
  INSERT INTO _r VALUES (19, 'entregar el re-ingreso resuelve el reclamo', 'RESUELTO', v_estado);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES (19, 'entregar el re-ingreso resuelve el reclamo', 'RESUELTO', SQLERRM);
END $$;

SELECT orden, probe, esperado, obtenido, esperado = obtenido AS ok FROM _r ORDER BY orden;

ROLLBACK;
