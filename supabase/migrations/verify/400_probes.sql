-- Verificación de garantias_vista_unificada (400).
--
-- Correr DESPUÉS de aplicar:  node scripts/db-run.mjs supabase/migrations/verify/400_probes.sql
-- (sin --apply: termina en ROLLBACK). Las filas de prueba se deshacen.
--
-- Resultado: UN select, todo en ok = true.

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

INSERT INTO _r
SELECT 1, 'garantias.organization_id NOT NULL', 'NO', is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'garantias' AND column_name = 'organization_id';

INSERT INTO _r
SELECT 2, 'ninguna garantía con otra org que la de su orden', '0', count(*)::text
FROM garantias g JOIN ordenes_servicio o ON o.id = g.orden_id
WHERE g.organization_id IS DISTINCT FROM o.organization_id;

INSERT INTO _r
SELECT 3, 'FK a organizations validada', '1', count(*)::text
FROM pg_constraint
WHERE conname = 'garantias_organization_id_fkey' AND conrelid = 'public.garantias'::regclass
  AND confrelid = 'public.organizations'::regclass AND convalidated;

-- La vista trae una fila por garantía de cada origen (menos las órdenes de práctica).
INSERT INTO _r
SELECT 4, 'v_garantias cubre todas las de reparación (sin práctica)',
  (SELECT count(*) FROM garantias g JOIN ordenes_servicio o ON o.id = g.orden_id WHERE NOT o.es_practica)::text,
  (SELECT count(*) FROM v_garantias WHERE origen = 'REPARACION')::text;

INSERT INTO _r
SELECT 5, 'v_garantias cubre todas las de venta',
  (SELECT count(*) FROM garantias_venta)::text,
  (SELECT count(*) FROM v_garantias WHERE origen = 'VENTA')::text;

INSERT INTO _r
SELECT 6, 'security_invoker en la vista', 'true',
  COALESCE((SELECT 'true' FROM pg_class WHERE oid = 'public.v_garantias'::regclass
             AND 'security_invoker=true' = ANY (reloptions)), 'false');

INSERT INTO _r VALUES
  (7, 'anon no lee la vista', 'false', has_table_privilege('anon', 'public.v_garantias', 'SELECT')::text),
  (8, 'authenticated no lee la vista', 'false', has_table_privilege('authenticated', 'public.v_garantias', 'SELECT')::text),
  (9, 'service_role lee la vista', 'true', has_table_privilege('service_role', 'public.v_garantias', 'SELECT')::text);

-- dia_vencimiento es el día en la zona de la org, no el día UTC.
INSERT INTO _r
SELECT 10, 'dia_vencimiento = día en la zona horaria de la org', '0', count(*)::text
FROM v_garantias vg JOIN organizations org ON org.id = vg.organization_id
WHERE vg.dia_vencimiento <> (vg.fecha_vencimiento AT TIME ZONE org.zona_horaria)::DATE;

-- El trigger fija la org desde la orden aunque el INSERT mande otra (o ninguna).
DO $$
DECLARE v_orden RECORD; v_otra TEXT; v_org TEXT;
BEGIN
  SELECT o.id, o.organization_id INTO v_orden
    FROM ordenes_servicio o
   WHERE NOT EXISTS (SELECT 1 FROM garantias g WHERE g.orden_id = o.id)
   LIMIT 1;
  IF v_orden.id IS NULL THEN
    INSERT INTO _r VALUES (11, 'el trigger toma la org de la orden', 'org de la orden', 'sin candidato');
    RETURN;
  END IF;
  SELECT id INTO v_otra FROM organizations WHERE id <> v_orden.organization_id LIMIT 1;
  INSERT INTO garantias (orden_id, fecha_vencimiento, organization_id)
  VALUES (v_orden.id, now() + interval '30 days', v_otra)
  RETURNING organization_id INTO v_org;
  INSERT INTO _r VALUES (11, 'el trigger toma la org de la orden', 'org de la orden',
    CASE WHEN v_org = v_orden.organization_id THEN 'org de la orden' ELSE 'otra: ' || COALESCE(v_org, 'NULL') END);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES (11, 'el trigger toma la org de la orden', 'org de la orden', SQLERRM);
END $$;

SELECT orden, probe, esperado, obtenido, esperado = obtenido AS ok FROM _r ORDER BY orden;

ROLLBACK;
