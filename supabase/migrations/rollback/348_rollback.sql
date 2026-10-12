-- Rollback de 348_orden_practica_onboarding.sql
--
-- PIERDE DATOS. Borra las prácticas que existan (orden + cliente sin uso real;
-- lo que ya se usó para trabajo real queda como real) y las columnas onboarding_progress.camino / practica_completada_at, que son la
-- única traza del camino que tomó cada taller en el wizard. Exportar antes:
--
--   SELECT organization_id, camino, practica_completada_at
--     FROM onboarding_progress
--    WHERE camino IS NOT NULL OR practica_completada_at IS NOT NULL;
--
-- Hacer rollback solo si el código del PR 1 se revierte también: el código
-- filtra y selecciona es_practica, y sin la columna esas queries fallan.
-- La vista vuelve a la definición de 294:55-85, con la misma opción
-- security_invoker que fija 347 y los mismos permisos que tenga al momento del
-- rollback.

-- 1. Borrar las prácticas ANTES de soltar la columna: sin el flag, una
--    práctica pasaría a contar como orden y cliente reales.
SELECT o.id AS organization_id, borrar_datos_practica(o.id) AS resultado
  FROM organizations o
 WHERE EXISTS (SELECT 1 FROM ordenes_servicio s WHERE s.organization_id = o.id AND s.es_practica)
    OR EXISTS (SELECT 1 FROM clientes c WHERE c.organization_id = o.id AND c.es_practica);

DROP TRIGGER IF EXISTS trigger_clientes_es_practica_guard ON clientes;
DROP TRIGGER IF EXISTS trigger_ordenes_es_practica_guard ON ordenes_servicio;
DROP FUNCTION IF EXISTS es_practica_solo_servidor();
DROP FUNCTION IF EXISTS borrar_datos_practica(TEXT);
DROP FUNCTION IF EXISTS registrar_camino_onboarding(TEXT, TEXT);

-- 2. Triggers de cupo: cuerpos de 167:67-131, sin el salto de práctica.
CREATE OR REPLACE FUNCTION update_ordenes_count()
RETURNS TRIGGER AS $$
DECLARE
  v_new_count INTEGER;
  v_limit INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO organization_usage (organization_id, ordenes_count, ordenes_mes_actual, periodo_inicio)
    VALUES (NEW.organization_id, 1, 1, DATE_TRUNC('month', NOW()))
    ON CONFLICT (organization_id)
    DO UPDATE SET
      ordenes_count = organization_usage.ordenes_count + 1,
      ordenes_mes_actual = CASE
        WHEN organization_usage.periodo_inicio < DATE_TRUNC('month', NOW())
        THEN 1
        ELSE organization_usage.ordenes_mes_actual + 1
      END,
      periodo_inicio = CASE
        WHEN organization_usage.periodo_inicio < DATE_TRUNC('month', NOW())
        THEN DATE_TRUNC('month', NOW())
        ELSE organization_usage.periodo_inicio
      END
    RETURNING ordenes_mes_actual INTO v_new_count;

    v_limit := get_plan_limit(NEW.organization_id, 'ordenes');

    IF v_limit IS NOT NULL AND v_new_count > v_limit THEN
      RAISE EXCEPTION 'PLAN_LIMIT_EXCEEDED:ordenes:%:%', v_new_count, v_limit
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_clientes_count()
RETURNS TRIGGER AS $$
DECLARE
  v_new_count INTEGER;
  v_limit INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO organization_usage (organization_id, clientes_count)
    VALUES (NEW.organization_id, 1)
    ON CONFLICT (organization_id)
    DO UPDATE SET clientes_count = organization_usage.clientes_count + 1
    RETURNING clientes_count INTO v_new_count;

    v_limit := get_plan_limit(NEW.organization_id, 'clientes');
    IF v_limit IS NOT NULL AND v_new_count > v_limit THEN
      RAISE EXCEPTION 'PLAN_LIMIT_EXCEEDED:clientes:%:%', v_new_count, v_limit
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE organization_usage
    SET clientes_count = GREATEST(0, clientes_count - 1)
    WHERE organization_id = OLD.organization_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_clientes_count ON clientes;
CREATE TRIGGER trigger_clientes_count
  AFTER INSERT OR DELETE ON clientes
  FOR EACH ROW EXECUTE FUNCTION update_clientes_count();

-- 3. La vista depende de c.*: se suelta antes de las columnas y se recrea al
--    final con la definición vieja (294:55-85) y los mismos permisos.
CREATE TEMP TABLE _acl_v_clientes_resumen_348r ON COMMIT DROP AS
  SELECT relacl FROM pg_class WHERE oid = 'public.v_clientes_resumen'::regclass;

DROP VIEW IF EXISTS v_clientes_resumen;

DROP INDEX IF EXISTS ordenes_servicio_practica_idx;
DROP INDEX IF EXISTS clientes_practica_idx;
ALTER TABLE ordenes_servicio DROP COLUMN IF EXISTS es_practica;
ALTER TABLE clientes DROP COLUMN IF EXISTS es_practica;
ALTER TABLE onboarding_progress DROP CONSTRAINT IF EXISTS onboarding_progress_camino_check;
ALTER TABLE onboarding_progress DROP COLUMN IF EXISTS camino;
ALTER TABLE onboarding_progress DROP COLUMN IF EXISTS practica_completada_at;

CREATE VIEW v_clientes_resumen WITH (security_invoker = true) AS
SELECT
  c.*,
  COALESCE(agg.ordenes_count, 0)   AS ordenes_count,
  agg.ultima_visita                AS ultima_visita,
  COALESCE(agg.deuda_pendiente, 0) AS deuda_pendiente,
  sec.sectores_texto               AS sectores_texto
FROM clientes c
LEFT JOIN (
  SELECT
    cliente_id,
    COUNT(*)            AS ordenes_count,
    MAX(fecha_ingreso)  AS ultima_visita,
    SUM(
      CASE WHEN estado_cobro IN ('PENDIENTE','PARCIAL')
                AND estado IN ('REPARADO','ENTREGADO')
        THEN GREATEST(
          COALESCE(costo_final, 0)
          - COALESCE(descuento_cobro, 0)
          - COALESCE(total_cobrado, 0), 0)
        ELSE 0 END
    ) AS deuda_pendiente
  FROM ordenes_servicio
  GROUP BY cliente_id
) agg ON agg.cliente_id = c.id
LEFT JOIN (
  SELECT cliente_id, string_agg(nombre, ' ') AS sectores_texto
  FROM sectores_cliente
  WHERE activo = true
  GROUP BY cliente_id
) sec ON sec.cliente_id = c.id;

-- Mismo procedimiento que la 348: sacar los default privileges y volver a dar
-- exactamente lo que la vista tenía antes del DROP.
DO $$
DECLARE
  r RECORD;
  v_owner OID;
BEGIN
  SELECT relowner INTO v_owner FROM pg_class WHERE oid = 'public.v_clientes_resumen'::regclass;

  FOR r IN
    SELECT DISTINCT a.grantee
      FROM pg_class c, aclexplode(c.relacl) a
     WHERE c.oid = 'public.v_clientes_resumen'::regclass AND a.grantee <> v_owner
  LOOP
    EXECUTE format('REVOKE ALL ON public.v_clientes_resumen FROM %s',
      CASE WHEN r.grantee = 0 THEN 'PUBLIC'
           ELSE (SELECT quote_ident(rolname) FROM pg_roles WHERE oid = r.grantee) END);
  END LOOP;

  FOR r IN
    SELECT a.grantee, a.privilege_type, a.is_grantable
      FROM _acl_v_clientes_resumen_348r t, aclexplode(t.relacl) a
     WHERE a.grantee <> v_owner
  LOOP
    EXECUTE format('GRANT %s ON public.v_clientes_resumen TO %s%s',
      r.privilege_type,
      CASE WHEN r.grantee = 0 THEN 'PUBLIC'
           ELSE (SELECT quote_ident(rolname) FROM pg_roles WHERE oid = r.grantee) END,
      CASE WHEN r.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;
END $$;

SELECT relacl::text AS acl_v_clientes_resumen,
       reloptions::text AS opciones_v_clientes_resumen
  FROM pg_class WHERE oid = 'public.v_clientes_resumen'::regclass;
