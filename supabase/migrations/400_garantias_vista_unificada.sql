-- Garantías: organization_id en garantias y vista unificada v_garantias.
--
-- Fase 1 de docs/garantias-flujo-2026-11-11.md: una sola lectura para las
-- garantías de reparación (garantias, una por orden) y las de venta
-- (garantias_venta, una por línea). Las tablas no se migran; la vista solo
-- unifica la lectura para la página /garantias y la tarjeta del dashboard.
--
-- 1. garantias.organization_id
--    Hasta acá la organización salía siempre por la orden (JOIN). Se agrega la
--    columna, se completa desde la orden y queda NOT NULL con FK. Un trigger la
--    fija desde la orden en cada INSERT/UPDATE: las rutas y RPCs que hoy
--    insertan sin ella (entrega, presupuesto convertido, POST manual, reparación
--    express de la 349) siguen andando sin cambios, y nadie puede apuntarla a
--    otra organización que la de su orden.
--
-- 2. v_garantias
--    UNION ALL de los dos orígenes con columnas normalizadas. NO calcula el
--    estado VIGENTE / POR_VENCER / VENCIDA: eso depende de "hoy" en la zona
--    horaria de la org y de la ventana "por vencer", y lo resuelve la API
--    (lib/garantias). La vista da lo que necesita para eso:
--      - dia_vencimiento: el DÍA calendario del vencimiento en la zona horaria
--        de la organización (organizations.zona_horaria). La garantía cubre
--        ese día entero.
--      - anulada: venta anulada o garantía retirada por devolución (316, 334).
--      - tiene_reclamo_abierto: reparación con un reclamo PENDIENTE,
--        EN_REVISION o ACEPTADO. Las de venta todavía no tienen reclamos
--        (fase 2): cuenta solo el estado RECLAMADA, que hoy nadie escribe.
--    El estado guardado (estado_guardado) va solo como dato: el VENCIDA "lazy"
--    se escribía comparando instantes con la hora del servidor, no por día.
--    Excluye las órdenes de práctica del onboarding.
--
--    Mismo criterio de acceso que la 347 y la 356: security_invoker y solo la
--    lee service_role (las rutas usan supabaseAdmin y acotan por
--    organization_id). anon y authenticated no la leen.
--
-- Idempotente: se puede correr más de una vez.

SET LOCAL lock_timeout = '3s';

-- ── 1. garantias.organization_id ──────────────────────────────────────────

ALTER TABLE garantias ADD COLUMN IF NOT EXISTS organization_id TEXT;

UPDATE garantias g
   SET organization_id = o.organization_id
  FROM ordenes_servicio o
 WHERE o.id = g.orden_id
   AND g.organization_id IS DISTINCT FROM o.organization_id;

CREATE OR REPLACE FUNCTION public.garantias_organization_desde_orden()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- La organización es la de la orden, siempre: lo que mande quien inserta
  -- no cuenta. Sin orden queda NULL y el NOT NULL rechaza la fila.
  SELECT o.organization_id INTO NEW.organization_id
    FROM ordenes_servicio o
   WHERE o.id = NEW.orden_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS garantias_organization_id ON garantias;
CREATE TRIGGER garantias_organization_id
  BEFORE INSERT OR UPDATE OF orden_id, organization_id ON garantias
  FOR EACH ROW EXECUTE FUNCTION public.garantias_organization_desde_orden();

ALTER TABLE garantias ALTER COLUMN organization_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'garantias_organization_id_fkey'
       AND conrelid = 'public.garantias'::regclass
  ) THEN
    ALTER TABLE garantias ADD CONSTRAINT garantias_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

ALTER TABLE garantias VALIDATE CONSTRAINT garantias_organization_id_fkey;

CREATE INDEX IF NOT EXISTS garantias_organization_vencimiento_idx
  ON garantias(organization_id, fecha_vencimiento);

-- ── 2. Vista unificada ─────────────────────────────────────────────────────

DROP VIEW IF EXISTS public.v_garantias;

CREATE VIEW public.v_garantias
WITH (security_invoker = true) AS
SELECT
  g.id,
  'REPARACION'::TEXT                                              AS origen,
  g.organization_id,
  o.sucursal_id,
  o.tecnico_id,
  NULL::TEXT                                                      AS vendedor_id,
  o.cliente_id,
  c.nombre                                                        AS cliente_nombre,
  c.telefono                                                      AS cliente_telefono,
  o.dispositivo                                                   AS descripcion,
  o.id                                                            AS orden_id,
  o.numero_orden,
  o.codigo_orden,
  o.estado::TEXT                                                  AS orden_estado,
  NULL::TEXT                                                      AS venta_id,
  NULL::INTEGER                                                   AS numero_venta,
  NULL::TEXT                                                      AS numero_garantia,
  COALESCE(o.codigo_orden, o.numero_orden::TEXT)                  AS referencia,
  g.dias_validez,
  g.fecha_inicio,
  g.fecha_vencimiento,
  (g.fecha_vencimiento AT TIME ZONE org.zona_horaria)::DATE       AS dia_vencimiento,
  g.estado::TEXT                                                  AS estado_guardado,
  FALSE                                                           AS anulada,
  EXISTS (
    SELECT 1 FROM reclamos_garantia r
     WHERE r.garantia_id = g.id
       AND r.estado IN ('PENDIENTE', 'EN_REVISION', 'ACEPTADO')
  )                                                               AS tiene_reclamo_abierto
FROM garantias g
JOIN ordenes_servicio o ON o.id = g.orden_id
JOIN organizations org  ON org.id = g.organization_id
LEFT JOIN clientes c    ON c.id = o.cliente_id
WHERE NOT o.es_practica
UNION ALL
SELECT
  gv.id,
  'VENTA'::TEXT,
  gv.organization_id,
  v.sucursal_id,
  NULL::TEXT,
  v.vendedor_id,
  v.cliente_id,
  COALESCE(c.nombre, v.cliente_nombre),
  COALESCE(c.telefono, v.cliente_telefono),
  iv.descripcion,
  NULL::TEXT,
  NULL::INTEGER,
  NULL::TEXT,
  NULL::TEXT,
  v.id,
  v.numero_venta,
  gv.numero_garantia,
  v.numero_venta::TEXT,
  gv.dias_validez,
  gv.fecha_inicio,
  gv.fecha_vencimiento,
  (gv.fecha_vencimiento AT TIME ZONE org.zona_horaria)::DATE,
  gv.estado::TEXT,
  (gv.estado = 'ANULADA' OR v.estado = 'ANULADA'),
  (gv.estado = 'RECLAMADA')
FROM garantias_venta gv
JOIN ventas v           ON v.id = gv.venta_id
JOIN items_venta iv     ON iv.id = gv.item_venta_id
JOIN organizations org  ON org.id = gv.organization_id
LEFT JOIN clientes c    ON c.id = v.cliente_id;

-- Permisos: ACL final = postgres + service_role. Mismo criterio que la 347 y la 356.
REVOKE ALL ON public.v_garantias FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_garantias TO service_role;

COMMENT ON VIEW public.v_garantias IS
  'Garantias de reparacion (garantias) y de venta (garantias_venta) con columnas normalizadas. '
  'dia_vencimiento es el dia calendario en la zona horaria de la org; el estado VIGENTE / POR_VENCER / '
  'VENCIDA lo deriva la API (lib/garantias). Hereda RLS (security_invoker); solo service_role la lee. '
  'OJO: CREATE OR REPLACE VIEW pierde security_invoker si no lo repite, y recrearla devuelve los '
  'grants por default (repetir el REVOKE). Migracion 400.';
