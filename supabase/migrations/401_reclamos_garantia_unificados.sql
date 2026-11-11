-- Garantías: reclamos unificados (reparación + venta) y re-ingreso vinculado.
--
-- Fase 2 de docs/garantias-flujo-2026-11-11.md. Decisiones del dueño: las
-- garantías de venta se reclaman con el mismo flujo; registra cualquier rol y
-- decide el ADMIN; el re-ingreso cuenta contra el técnico de la orden original.
--
-- 1. reclamos_garantia cubre los dos orígenes
--    - garantia_id pasa a ser opcional y se suma garantia_venta_id (FK a
--      garantias_venta). Un CHECK exige exactamente uno de los dos.
--    - La FK de venta es NO ACTION (no CASCADE): editar una venta borra y
--      recrea sus garantías (editar_venta_atomica, 253) y con CASCADE se
--      llevaría puestos los reclamos y su vínculo con el re-ingreso sin avisar.
--      La API de ventas rechaza editar o borrar una venta con reclamos.
--    - organization_id propio (NOT NULL, FK), fijado por trigger desde la
--      garantía, igual que la 400 hizo con garantias. Los inserts no lo mandan
--      y nadie lo puede apuntar a otra organización.
--    - motivo_rechazo, registrado_por, decidido_por, fecha_decision,
--      vigencia_forzada_motivo (el ADMIN registra un reclamo sobre una garantía
--      vencida dejando el motivo) y updated_at.
--
-- 2. orden_reingreso_id (FK a ordenes_servicio, ON DELETE SET NULL)
--    Reemplaza a orden_reparacion_id, que era TEXT sin FK. La columna vieja
--    NO se borra: la usan las vistas de comisiones (381) y el código que siga
--    corriendo entre esta migración y el deploy. Se completa la nueva desde la
--    vieja (solo si la orden existe) y un trigger mantiene las dos iguales: la
--    nueva es la fuente, la vieja es un espejo de compatibilidad.
--
-- 3. Ciclo de vida simplificado
--    ABIERTO -> ACEPTADO (crea el re-ingreso) | RECHAZADO (con motivo);
--    ACEPTADO -> RESUELTO solo, cuando se entrega la orden de re-ingreso.
--    El enum estado_reclamo NO cambia: agregar un valor (ALTER TYPE ... ADD
--    VALUE) no se puede usar en la misma transacción y obliga a migrar en dos
--    pasos. PENDIENTE es "abierto" en la app; EN_REVISION queda sin uso y se
--    normaliza a PENDIENTE. Datos viejos:
--      - EN_REVISION                                  -> PENDIENTE
--      - ACEPTADO con re-ingreso ya entregado          -> RESUELTO
--      - ACEPTADO sin orden de re-ingreso (se aceptaba
--        "sin crear orden")                           -> RESUELTO, con nota
--      - reclamos abiertos duplicados de una misma garantía: queda uno (el
--        ACEPTADO, si no el más nuevo); el resto -> RECHAZADO "duplicado".
--    Un índice único parcial impide dos reclamos abiertos por garantía.
--
-- 4. RESUELTO automático: trigger en ordenes_servicio
--    Elegido sobre código en /entregar porque una orden se entrega por varios
--    caminos (entrega, entrega sin cobro, retiro sin reparación, cambios de
--    estado masivos y del kanban, reparación express). El trigger cubre todos y
--    queda en la misma transacción que la entrega.
--
-- 5. Estado guardado de la garantía
--    Un trigger en reclamos_garantia lo mantiene: con un reclamo abierto pasa
--    a RECLAMADA; cuando no queda ninguno vuelve a ACTIVA (o VENCIDA, en las de
--    reparación ya vencidas). Lo leen el reporte de garantías de venta y la
--    anulación de ventas (334 respeta las RECLAMADA). La app usa el estado
--    derivado de v_garantias.
--
-- 6. Re-ingresos viejos nacidos de un reclamo
--    Las órdenes creadas al aceptar un reclamo antes de la fase 0 no tienen
--    es_reingreso, orden_origen_id ni garantia_origen_id. Se completan: así las
--    métricas de técnicos (por técnico ORIGINAL, vía orden_origen_id) y las
--    comisiones (381: es_reingreso OR reclamo) ven el mismo conjunto. Las
--    comisiones no cambian: 381 ya trataba esas órdenes como re-ingreso.
--
-- 7. v_garantias: tiene_reclamo_abierto sale de reclamos_garantia para los dos
--    orígenes, y se suman los datos del reclamo abierto (para la pestaña
--    "Reclamos abiertos"). Se recrea WITH (security_invoker = true) y se repite
--    el REVOKE/GRANT (ver el comentario de la 400).
--
-- Sin grants a anon ni authenticated: todo pasa por service_role.
-- Idempotente: se puede correr más de una vez.
-- Rollback: rollback/401_rollback.sql. Verificación: verify/401_probes.sql.

SET LOCAL lock_timeout = '3s';

-- ── 1. Columnas nuevas ─────────────────────────────────────────────────────

ALTER TABLE reclamos_garantia ALTER COLUMN garantia_id DROP NOT NULL;

ALTER TABLE reclamos_garantia ADD COLUMN IF NOT EXISTS garantia_venta_id TEXT;
ALTER TABLE reclamos_garantia ADD COLUMN IF NOT EXISTS organization_id TEXT;
ALTER TABLE reclamos_garantia ADD COLUMN IF NOT EXISTS orden_reingreso_id TEXT;
ALTER TABLE reclamos_garantia ADD COLUMN IF NOT EXISTS motivo_rechazo TEXT;
ALTER TABLE reclamos_garantia ADD COLUMN IF NOT EXISTS vigencia_forzada_motivo TEXT;
ALTER TABLE reclamos_garantia ADD COLUMN IF NOT EXISTS registrado_por TEXT;
ALTER TABLE reclamos_garantia ADD COLUMN IF NOT EXISTS decidido_por TEXT;
ALTER TABLE reclamos_garantia ADD COLUMN IF NOT EXISTS fecha_decision TIMESTAMPTZ;
ALTER TABLE reclamos_garantia ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reclamos_garantia_garantia_venta_id_fkey'
                  AND conrelid = 'public.reclamos_garantia'::regclass) THEN
    ALTER TABLE reclamos_garantia ADD CONSTRAINT reclamos_garantia_garantia_venta_id_fkey
      FOREIGN KEY (garantia_venta_id) REFERENCES garantias_venta(id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reclamos_garantia_orden_reingreso_id_fkey'
                  AND conrelid = 'public.reclamos_garantia'::regclass) THEN
    ALTER TABLE reclamos_garantia ADD CONSTRAINT reclamos_garantia_orden_reingreso_id_fkey
      FOREIGN KEY (orden_reingreso_id) REFERENCES ordenes_servicio(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reclamos_garantia_registrado_por_fkey'
                  AND conrelid = 'public.reclamos_garantia'::regclass) THEN
    ALTER TABLE reclamos_garantia ADD CONSTRAINT reclamos_garantia_registrado_por_fkey
      FOREIGN KEY (registrado_por) REFERENCES users(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reclamos_garantia_decidido_por_fkey'
                  AND conrelid = 'public.reclamos_garantia'::regclass) THEN
    ALTER TABLE reclamos_garantia ADD CONSTRAINT reclamos_garantia_decidido_por_fkey
      FOREIGN KEY (decidido_por) REFERENCES users(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reclamos_garantia_un_origen'
                  AND conrelid = 'public.reclamos_garantia'::regclass) THEN
    ALTER TABLE reclamos_garantia ADD CONSTRAINT reclamos_garantia_un_origen
      CHECK (num_nonnulls(garantia_id, garantia_venta_id) = 1) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reclamos_garantia_rechazo_con_motivo'
                  AND conrelid = 'public.reclamos_garantia'::regclass) THEN
    -- Solo para los rechazos nuevos: los viejos guardaban el motivo en resolucion.
    ALTER TABLE reclamos_garantia ADD CONSTRAINT reclamos_garantia_rechazo_con_motivo
      CHECK (estado <> 'RECHAZADO' OR decidido_por IS NULL OR NULLIF(btrim(motivo_rechazo), '') IS NOT NULL) NOT VALID;
  END IF;
END $$;

-- ── 2. Datos: organización y re-ingreso ───────────────────────────────────

UPDATE reclamos_garantia r
   SET organization_id = g.organization_id
  FROM garantias g
 WHERE g.id = r.garantia_id
   AND r.organization_id IS DISTINCT FROM g.organization_id;

UPDATE reclamos_garantia r
   SET organization_id = gv.organization_id
  FROM garantias_venta gv
 WHERE gv.id = r.garantia_venta_id
   AND r.organization_id IS DISTINCT FROM gv.organization_id;

-- La columna nueva, desde la vieja, solo si la orden existe (la vieja no tenía FK).
UPDATE reclamos_garantia r
   SET orden_reingreso_id = r.orden_reparacion_id
 WHERE r.orden_reingreso_id IS NULL
   AND r.orden_reparacion_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM ordenes_servicio o WHERE o.id = r.orden_reparacion_id);

-- ── 3. Datos: estados al ciclo simplificado ────────────────────────────────

UPDATE reclamos_garantia SET estado = 'PENDIENTE' WHERE estado = 'EN_REVISION';

UPDATE reclamos_garantia r
   SET estado = 'RESUELTO',
       fecha_resolucion = COALESCE(r.fecha_resolucion, o.fecha_entrega, NOW()),
       resolucion = COALESCE(NULLIF(btrim(r.resolucion), ''), 'Re-ingreso entregado.')
  FROM ordenes_servicio o
 WHERE o.id = r.orden_reingreso_id
   AND r.estado = 'ACEPTADO'
   AND o.estado::TEXT IN ('ENTREGADO', 'ENTREGADO_SIN_REPARACION', 'ENTREGADO_SIN_COBRO');

UPDATE reclamos_garantia r
   SET estado = 'RESUELTO',
       fecha_resolucion = COALESCE(r.fecha_resolucion, NOW()),
       resolucion = COALESCE(NULLIF(btrim(r.resolucion), ''),
                             'Aceptado sin orden de re-ingreso: cerrado por la migración 401.')
 WHERE r.estado = 'ACEPTADO'
   AND r.orden_reingreso_id IS NULL;

-- Duplicados abiertos de una misma garantía: queda el ACEPTADO o, si no hay, el más nuevo.
WITH ranking AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY COALESCE(garantia_id, garantia_venta_id)
           ORDER BY (estado = 'ACEPTADO') DESC, fecha_reclamo DESC NULLS LAST, id DESC
         ) AS n
    FROM reclamos_garantia
   WHERE estado IN ('PENDIENTE', 'EN_REVISION', 'ACEPTADO')
)
UPDATE reclamos_garantia r
   SET estado = 'RECHAZADO',
       motivo_rechazo = 'Reclamo duplicado: quedó abierto otro reclamo de la misma garantía (migración 401).',
       fecha_resolucion = COALESCE(r.fecha_resolucion, NOW())
  FROM ranking k
 WHERE k.id = r.id AND k.n > 1;

-- ── 4. Re-ingresos viejos nacidos de un reclamo ────────────────────────────

UPDATE ordenes_servicio o
   SET es_reingreso = TRUE,
       orden_origen_id = COALESCE(o.orden_origen_id, g.orden_id),
       garantia_origen_id = COALESCE(o.garantia_origen_id, g.id)
  FROM reclamos_garantia r
  JOIN garantias g ON g.id = r.garantia_id
 WHERE r.orden_reingreso_id = o.id
   AND o.id <> g.orden_id
   AND (NOT o.es_reingreso OR o.orden_origen_id IS NULL OR o.garantia_origen_id IS NULL);

-- ── 5. Restricciones ───────────────────────────────────────────────────────

ALTER TABLE reclamos_garantia VALIDATE CONSTRAINT reclamos_garantia_garantia_venta_id_fkey;
ALTER TABLE reclamos_garantia VALIDATE CONSTRAINT reclamos_garantia_orden_reingreso_id_fkey;
ALTER TABLE reclamos_garantia VALIDATE CONSTRAINT reclamos_garantia_registrado_por_fkey;
ALTER TABLE reclamos_garantia VALIDATE CONSTRAINT reclamos_garantia_decidido_por_fkey;
ALTER TABLE reclamos_garantia VALIDATE CONSTRAINT reclamos_garantia_un_origen;
ALTER TABLE reclamos_garantia VALIDATE CONSTRAINT reclamos_garantia_rechazo_con_motivo;

ALTER TABLE reclamos_garantia ALTER COLUMN organization_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reclamos_garantia_organization_id_fkey'
                  AND conrelid = 'public.reclamos_garantia'::regclass) THEN
    ALTER TABLE reclamos_garantia ADD CONSTRAINT reclamos_garantia_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

ALTER TABLE reclamos_garantia VALIDATE CONSTRAINT reclamos_garantia_organization_id_fkey;

-- Un solo reclamo abierto por garantía (ACEPTADO cuenta: el re-ingreso está en curso).
CREATE UNIQUE INDEX IF NOT EXISTS reclamos_garantia_abierto_reparacion_uidx
  ON reclamos_garantia (garantia_id)
  WHERE garantia_id IS NOT NULL AND estado IN ('PENDIENTE', 'EN_REVISION', 'ACEPTADO');

CREATE UNIQUE INDEX IF NOT EXISTS reclamos_garantia_abierto_venta_uidx
  ON reclamos_garantia (garantia_venta_id)
  WHERE garantia_venta_id IS NOT NULL AND estado IN ('PENDIENTE', 'EN_REVISION', 'ACEPTADO');

CREATE INDEX IF NOT EXISTS reclamos_garantia_venta_idx
  ON reclamos_garantia (garantia_venta_id) WHERE garantia_venta_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS reclamos_garantia_orden_reingreso_idx
  ON reclamos_garantia (orden_reingreso_id) WHERE orden_reingreso_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS reclamos_garantia_organization_estado_idx
  ON reclamos_garantia (organization_id, estado);

-- ── 6. Triggers en reclamos_garantia ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reclamos_garantia_normalizar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- La organización es la de la garantía, siempre: lo que mande quien inserta
  -- no cuenta. Sin garantía queda NULL y el NOT NULL rechaza la fila.
  IF NEW.garantia_id IS NOT NULL THEN
    SELECT g.organization_id INTO NEW.organization_id FROM garantias g WHERE g.id = NEW.garantia_id;
  ELSE
    SELECT gv.organization_id INTO NEW.organization_id FROM garantias_venta gv WHERE gv.id = NEW.garantia_venta_id;
  END IF;

  -- orden_reingreso_id es la fuente; orden_reparacion_id, su espejo (381 y el
  -- código viejo leen o escriben la vieja).
  IF TG_OP = 'INSERT' THEN
    IF NEW.orden_reingreso_id IS NULL AND NEW.orden_reparacion_id IS NOT NULL THEN
      SELECT o.id INTO NEW.orden_reingreso_id FROM ordenes_servicio o WHERE o.id = NEW.orden_reparacion_id;
    END IF;
    NEW.orden_reparacion_id := COALESCE(NEW.orden_reingreso_id, NEW.orden_reparacion_id);
  ELSE
    IF NEW.orden_reingreso_id IS DISTINCT FROM OLD.orden_reingreso_id THEN
      NEW.orden_reparacion_id := NEW.orden_reingreso_id;
    ELSIF NEW.orden_reparacion_id IS DISTINCT FROM OLD.orden_reparacion_id THEN
      SELECT o.id INTO NEW.orden_reingreso_id FROM ordenes_servicio o WHERE o.id = NEW.orden_reparacion_id;
    END IF;
    NEW.updated_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reclamos_garantia_normalizar ON reclamos_garantia;
CREATE TRIGGER reclamos_garantia_normalizar
  BEFORE INSERT OR UPDATE ON reclamos_garantia
  FOR EACH ROW EXECUTE FUNCTION public.reclamos_garantia_normalizar();

CREATE OR REPLACE FUNCTION public.reclamos_garantia_sincronizar_garantia()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_garantia_id TEXT;
  v_garantia_venta_id TEXT;
  v_abierto BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_garantia_id := OLD.garantia_id;
    v_garantia_venta_id := OLD.garantia_venta_id;
  ELSE
    v_garantia_id := NEW.garantia_id;
    v_garantia_venta_id := NEW.garantia_venta_id;
  END IF;

  IF v_garantia_id IS NOT NULL THEN
    v_abierto := EXISTS (SELECT 1 FROM reclamos_garantia r
                          WHERE r.garantia_id = v_garantia_id
                            AND r.estado IN ('PENDIENTE', 'EN_REVISION', 'ACEPTADO'));
    IF v_abierto THEN
      UPDATE garantias SET estado = 'RECLAMADA'
       WHERE id = v_garantia_id AND estado IN ('ACTIVA', 'VENCIDA');
    ELSE
      UPDATE garantias
         SET estado = CASE WHEN fecha_vencimiento < NOW() THEN 'VENCIDA'::estado_garantia
                           ELSE 'ACTIVA'::estado_garantia END
       WHERE id = v_garantia_id AND estado = 'RECLAMADA';
    END IF;
  ELSIF v_garantia_venta_id IS NOT NULL THEN
    v_abierto := EXISTS (SELECT 1 FROM reclamos_garantia r
                          WHERE r.garantia_venta_id = v_garantia_venta_id
                            AND r.estado IN ('PENDIENTE', 'EN_REVISION', 'ACEPTADO'));
    IF v_abierto THEN
      UPDATE garantias_venta SET estado = 'RECLAMADA'
       WHERE id = v_garantia_venta_id AND estado::TEXT IN ('ACTIVA', 'VENCIDA');
    ELSE
      UPDATE garantias_venta SET estado = 'ACTIVA'
       WHERE id = v_garantia_venta_id AND estado::TEXT = 'RECLAMADA';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.reclamos_garantia_sincronizar_garantia() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS reclamos_garantia_sincronizar_garantia ON reclamos_garantia;
CREATE TRIGGER reclamos_garantia_sincronizar_garantia
  AFTER INSERT OR DELETE OR UPDATE OF estado ON reclamos_garantia
  FOR EACH ROW EXECUTE FUNCTION public.reclamos_garantia_sincronizar_garantia();

-- Las garantías de reparación que quedaron RECLAMADA sin reclamo abierto (los
-- cierres de arriba no dispararon el trigger: todavía no existía).
UPDATE garantias g
   SET estado = CASE WHEN g.fecha_vencimiento < NOW() THEN 'VENCIDA'::estado_garantia
                     ELSE 'ACTIVA'::estado_garantia END
 WHERE g.estado = 'RECLAMADA'
   AND NOT EXISTS (SELECT 1 FROM reclamos_garantia r
                    WHERE r.garantia_id = g.id
                      AND r.estado IN ('PENDIENTE', 'EN_REVISION', 'ACEPTADO'));

-- ── 7. RESUELTO al entregar el re-ingreso ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.reclamos_garantia_resolver_por_entrega()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE reclamos_garantia
     SET estado = 'RESUELTO',
         fecha_resolucion = NOW(),
         resolucion = COALESCE(NULLIF(btrim(resolucion), ''), 'Re-ingreso entregado.')
   WHERE orden_reingreso_id = NEW.id
     AND estado = 'ACEPTADO';
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.reclamos_garantia_resolver_por_entrega() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS reclamos_garantia_resolver_por_entrega ON ordenes_servicio;
CREATE TRIGGER reclamos_garantia_resolver_por_entrega
  AFTER UPDATE OF estado ON ordenes_servicio
  FOR EACH ROW
  WHEN (NEW.es_reingreso
        AND NEW.estado::TEXT IN ('ENTREGADO', 'ENTREGADO_SIN_REPARACION', 'ENTREGADO_SIN_COBRO')
        AND OLD.estado IS DISTINCT FROM NEW.estado)
  EXECUTE FUNCTION public.reclamos_garantia_resolver_por_entrega();

-- ── 8. Vista unificada ─────────────────────────────────────────────────────

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
  (ra.id IS NOT NULL)                                             AS tiene_reclamo_abierto,
  ra.id                                                           AS reclamo_id,
  ra.estado::TEXT                                                 AS reclamo_estado,
  ra.descripcion                                                  AS reclamo_descripcion,
  ra.fecha_reclamo                                                AS reclamo_fecha,
  ra.orden_reingreso_id                                           AS reclamo_orden_reingreso_id,
  COALESCE(ro.codigo_orden, '#' || ro.numero_orden::TEXT)         AS reclamo_orden_reingreso_numero
FROM garantias g
JOIN ordenes_servicio o ON o.id = g.orden_id
JOIN organizations org  ON org.id = g.organization_id
LEFT JOIN clientes c    ON c.id = o.cliente_id
LEFT JOIN LATERAL (
  SELECT r.id, r.estado, r.descripcion, r.fecha_reclamo, r.orden_reingreso_id
    FROM reclamos_garantia r
   WHERE r.garantia_id = g.id
     AND r.estado IN ('PENDIENTE', 'EN_REVISION', 'ACEPTADO')
   ORDER BY r.fecha_reclamo DESC
   LIMIT 1
) ra ON TRUE
LEFT JOIN ordenes_servicio ro ON ro.id = ra.orden_reingreso_id
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
  (ra.id IS NOT NULL),
  ra.id,
  ra.estado::TEXT,
  ra.descripcion,
  ra.fecha_reclamo,
  ra.orden_reingreso_id,
  COALESCE(ro.codigo_orden, '#' || ro.numero_orden::TEXT)
FROM garantias_venta gv
JOIN ventas v           ON v.id = gv.venta_id
JOIN items_venta iv     ON iv.id = gv.item_venta_id
JOIN organizations org  ON org.id = gv.organization_id
LEFT JOIN clientes c    ON c.id = v.cliente_id
LEFT JOIN LATERAL (
  SELECT r.id, r.estado, r.descripcion, r.fecha_reclamo, r.orden_reingreso_id
    FROM reclamos_garantia r
   WHERE r.garantia_venta_id = gv.id
     AND r.estado IN ('PENDIENTE', 'EN_REVISION', 'ACEPTADO')
   ORDER BY r.fecha_reclamo DESC
   LIMIT 1
) ra ON TRUE
LEFT JOIN ordenes_servicio ro ON ro.id = ra.orden_reingreso_id;

-- Permisos: ACL final = postgres + service_role. Mismo criterio que la 347, la 356 y la 400.
REVOKE ALL ON public.v_garantias FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_garantias TO service_role;

COMMENT ON VIEW public.v_garantias IS
  'Garantias de reparacion (garantias) y de venta (garantias_venta) con columnas normalizadas y el reclamo '
  'abierto de cada una (reclamos_garantia, los dos origenes). dia_vencimiento es el dia calendario en la zona '
  'horaria de la org; el estado VIGENTE / POR_VENCER / VENCIDA lo deriva la API (lib/garantias). Hereda RLS '
  '(security_invoker); solo service_role la lee. OJO: CREATE OR REPLACE VIEW pierde security_invoker si no lo '
  'repite, y recrearla devuelve los grants por default (repetir el REVOKE). Migraciones 400 y 401.';

COMMENT ON COLUMN reclamos_garantia.orden_reparacion_id IS
  'Espejo de orden_reingreso_id (lo mantiene el trigger reclamos_garantia_normalizar). Lo leen las vistas de comisiones (381). Migracion 401.';
COMMENT ON COLUMN reclamos_garantia.estado IS
  'PENDIENTE = abierto (por decidir). EN_REVISION ya no se usa (401 lo normaliza a PENDIENTE). ACEPTADO = re-ingreso en curso; '
  'pasa a RESUELTO solo al entregar el re-ingreso (trigger reclamos_garantia_resolver_por_entrega).';
