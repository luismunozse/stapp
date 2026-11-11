-- Rollback de reclamos_garantia_unificados (401): saca los triggers, los
-- índices, las restricciones y las columnas nuevas de reclamos_garantia, y
-- vuelve v_garantias a la definición de la 400.
--
-- Revertir el deploy ANTES de correr este rollback: la app de la fase 2 lee las
-- columnas nuevas y la vista con los datos del reclamo.
--
-- OJO, pierde datos:
--   - BORRA los reclamos de garantías de VENTA (garantia_id NULL): la tabla
--     vieja no los puede guardar. Las órdenes de re-ingreso que crearon quedan.
--   - motivo_rechazo, registrado_por, decidido_por, fecha_decision y
--     vigencia_forzada_motivo se pierden (el motivo se copia a resolucion).
--   - No deshace la normalización de estados (EN_REVISION -> PENDIENTE,
--     ACEPTADO -> RESUELTO, duplicados -> RECHAZADO) ni el marcado de
--     es_reingreso / orden_origen_id / garantia_origen_id en órdenes viejas.

SET LOCAL lock_timeout = '3s';

DROP TRIGGER IF EXISTS reclamos_garantia_resolver_por_entrega ON ordenes_servicio;
DROP FUNCTION IF EXISTS public.reclamos_garantia_resolver_por_entrega();
DROP TRIGGER IF EXISTS reclamos_garantia_sincronizar_garantia ON reclamos_garantia;
DROP FUNCTION IF EXISTS public.reclamos_garantia_sincronizar_garantia();
DROP TRIGGER IF EXISTS reclamos_garantia_normalizar ON reclamos_garantia;
DROP FUNCTION IF EXISTS public.reclamos_garantia_normalizar();

-- La vista de la 400 (la nueva lee columnas que se borran abajo).
DROP VIEW IF EXISTS public.v_garantias;

UPDATE reclamos_garantia
   SET resolucion = COALESCE(NULLIF(btrim(resolucion), ''), motivo_rechazo)
 WHERE motivo_rechazo IS NOT NULL;

UPDATE reclamos_garantia
   SET orden_reparacion_id = orden_reingreso_id
 WHERE orden_reingreso_id IS NOT NULL
   AND orden_reparacion_id IS DISTINCT FROM orden_reingreso_id;

DELETE FROM reclamos_garantia WHERE garantia_id IS NULL;

-- Sin sus reclamos, una garantía de venta RECLAMADA (la 401 la marcaba) vuelve a ACTIVA.
UPDATE garantias_venta SET estado = 'ACTIVA' WHERE estado::TEXT = 'RECLAMADA';

DROP INDEX IF EXISTS reclamos_garantia_abierto_reparacion_uidx;
DROP INDEX IF EXISTS reclamos_garantia_abierto_venta_uidx;
DROP INDEX IF EXISTS reclamos_garantia_venta_idx;
DROP INDEX IF EXISTS reclamos_garantia_orden_reingreso_idx;
DROP INDEX IF EXISTS reclamos_garantia_organization_estado_idx;

ALTER TABLE reclamos_garantia DROP CONSTRAINT IF EXISTS reclamos_garantia_un_origen;
ALTER TABLE reclamos_garantia DROP CONSTRAINT IF EXISTS reclamos_garantia_rechazo_con_motivo;
ALTER TABLE reclamos_garantia DROP CONSTRAINT IF EXISTS reclamos_garantia_garantia_venta_id_fkey;
ALTER TABLE reclamos_garantia DROP CONSTRAINT IF EXISTS reclamos_garantia_orden_reingreso_id_fkey;
ALTER TABLE reclamos_garantia DROP CONSTRAINT IF EXISTS reclamos_garantia_registrado_por_fkey;
ALTER TABLE reclamos_garantia DROP CONSTRAINT IF EXISTS reclamos_garantia_decidido_por_fkey;
ALTER TABLE reclamos_garantia DROP CONSTRAINT IF EXISTS reclamos_garantia_organization_id_fkey;

ALTER TABLE reclamos_garantia DROP COLUMN IF EXISTS garantia_venta_id;
ALTER TABLE reclamos_garantia DROP COLUMN IF EXISTS organization_id;
ALTER TABLE reclamos_garantia DROP COLUMN IF EXISTS orden_reingreso_id;
ALTER TABLE reclamos_garantia DROP COLUMN IF EXISTS motivo_rechazo;
ALTER TABLE reclamos_garantia DROP COLUMN IF EXISTS vigencia_forzada_motivo;
ALTER TABLE reclamos_garantia DROP COLUMN IF EXISTS registrado_por;
ALTER TABLE reclamos_garantia DROP COLUMN IF EXISTS decidido_por;
ALTER TABLE reclamos_garantia DROP COLUMN IF EXISTS fecha_decision;
ALTER TABLE reclamos_garantia DROP COLUMN IF EXISTS updated_at;

ALTER TABLE reclamos_garantia ALTER COLUMN garantia_id SET NOT NULL;

COMMENT ON COLUMN reclamos_garantia.orden_reparacion_id IS NULL;
COMMENT ON COLUMN reclamos_garantia.estado IS NULL;

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

REVOKE ALL ON public.v_garantias FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_garantias TO service_role;
