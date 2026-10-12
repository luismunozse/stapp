-- ============================================================================
-- 348: orden de práctica del onboarding (es_practica) y camino del wizard
-- ============================================================================
-- NUMERO: provisorio, se asigna al mergear. En main, 346 es android_beta_testers
-- y 347 es otra migración sobre v_clientes_resumen (opción security_invoker).
-- 341 la reserva
-- feat/orden-ingreso-trabajo-garantia y 342-344 el plan de notas de crédito.
-- Antes del merge: máximo global entre main y las branches abiertas.
--
-- ORDEN DE DESPLIEGUE: aplicar ANTES de mergear el PR 1 (y antes de pushear la
-- branch: los previews usan esta base). El código filtra por es_practica; sin la
-- columna esas queries fallan con 42703.
-- Un archivo por vez: node scripts/db-run.mjs supabase/migrations/348_...sql
-- (dry-run por defecto, --apply para confirmar). Sin transacción propia a
-- propósito: el runner abre y cierra la suya.
--
-- Los locks de las ALTER TABLE se sostienen hasta el COMMIT: si hay una
-- transacción larga abierta, se corta en 5 s en vez de encolar las consultas.
--
-- QUÉ HACE
--   1. es_practica en ordenes_servicio y clientes (+ índices parciales), y
--      camino / practica_completada_at en onboarding_progress.
--   2. Los triggers de cupo (167) no cuentan filas de práctica. El cupo nunca
--      se devuelve al borrar una orden, así que saltear en el alta es la única
--      corrección posible. Un cliente de práctica que pasa a real suma 1.
--   3. v_clientes_resumen se recrea para que exponga es_practica (c.* quedó
--      congelado en 294). Misma definición que tenía, con la misma opción
--      security_invoker que fija 347, y los mismos permisos.
--   3b. es_practica lo escribe solo el servidor: un trigger BEFORE en clientes y
--      ordenes_servicio rechaza (42501) que anon/authenticated lo fijen o lo
--      cambien. Los RPC SECURITY DEFINER y service_role pasan.
--   4. borrar_datos_practica(org) borra la práctica de la org. La orden se
--      borra solo si ninguna FK hacia ordenes_servicio la referencia (salvo las
--      tablas que escribe la práctica misma); si no, se conserva y pasa a real.
--      El cliente se borra solo si ninguna FK hacia clientes lo referencia
--      (salvo los logs de notificaciones); si no, se conserva y pasa a real.
--   4b. registrar_camino_onboarding(org, camino): upsert atómico de
--      onboarding_progress.camino. Crea la fila si falta (el wizard nuevo ya no
--      llama a GET /api/onboarding/progress, que era quien la creaba), nunca
--      pisa un camino con 'omitido' y nada pisa 'practica'.
--   5. Autocheck sobre una org sintética, dentro de un sub-bloque que siempre se
--      revierte. Si algo falla, aborta la migración entera.
--   6. Tres SELECT de solo lectura para comparar con el plan.
--
-- POR QUÉ EL CHEQUEO DE REFERENCIAS ES DINÁMICO
--   ordenes_servicio.cliente_id, cuenta_corriente, recepciones,
--   sectores_cliente y notification_logs apuntan a clientes con ON DELETE
--   CASCADE: borrar un cliente referenciado borraría trabajo real. Lo mismo
--   con la orden: cobros, facturas, cotizaciones, garantías, repuestos y
--   servicios cascadean desde ordenes_servicio. La función lee las FKs de
--   pg_constraint en cada llamada (una FK nueva queda cubierta sin tocarla) y
--   toma FOR UPDATE sobre la fila antes de mirar, así un INSERT concurrente
--   que la referencie (FOR KEY SHARE) espera.
--
-- VERIFICACIÓN POSTERIOR (después de --apply):
--   SELECT es_practica FROM v_clientes_resumen LIMIT 1;  -- corre sin error
--   SELECT pg_get_triggerdef(oid) FROM pg_trigger
--    WHERE tgname = 'trigger_clientes_count';             -- incluye UPDATE OF es_practica
--   SELECT reloptions::text FROM pg_class
--    WHERE oid = 'public.v_clientes_resumen'::regclass;   -- {security_invoker=true}
-- ============================================================================

SET LOCAL lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1. Columnas e índices
-- ----------------------------------------------------------------------------
ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS es_practica BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE clientes         ADD COLUMN IF NOT EXISTS es_practica BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS ordenes_servicio_practica_idx
  ON ordenes_servicio (organization_id) WHERE es_practica;
CREATE INDEX IF NOT EXISTS clientes_practica_idx
  ON clientes (organization_id) WHERE es_practica;

ALTER TABLE onboarding_progress ADD COLUMN IF NOT EXISTS camino TEXT;
ALTER TABLE onboarding_progress DROP CONSTRAINT IF EXISTS onboarding_progress_camino_check;
ALTER TABLE onboarding_progress ADD CONSTRAINT onboarding_progress_camino_check
  CHECK (camino IN ('real', 'practica', 'omitido'));
ALTER TABLE onboarding_progress ADD COLUMN IF NOT EXISTS practica_completada_at TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- 2. Triggers de cupo: cuerpos de 167:67-100 y 167:106-131 con el salto
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_ordenes_count()
RETURNS TRIGGER AS $$
DECLARE
  v_new_count INTEGER;
  v_limit INTEGER;
BEGIN
  -- La orden de práctica no usa cupo del plan.
  IF TG_OP = 'INSERT' AND NOT NEW.es_practica THEN
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
    -- El cliente de práctica no usa cupo del plan.
    IF NOT NEW.es_practica THEN
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
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    -- Si nunca se contó, no se descuenta.
    IF NOT OLD.es_practica THEN
      UPDATE organization_usage
      SET clientes_count = GREATEST(0, clientes_count - 1)
      WHERE organization_id = OLD.organization_id;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.es_practica AND NOT NEW.es_practica THEN
      -- La práctica se usó para trabajo real y pasa a contar. Sin chequeo de
      -- límite: el cliente ya existe, y fallar acá haría fallar para siempre el
      -- borrado de la práctica.
      INSERT INTO organization_usage (organization_id, clientes_count)
      VALUES (NEW.organization_id, 1)
      ON CONFLICT (organization_id)
      DO UPDATE SET clientes_count = organization_usage.clientes_count + 1;
    ELSIF NOT OLD.es_practica AND NEW.es_practica THEN
      UPDATE organization_usage
      SET clientes_count = GREATEST(0, clientes_count - 1)
      WHERE organization_id = NEW.organization_id;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- 006:367 lo creó AFTER INSERT OR DELETE; se agrega UPDATE OF es_practica.
DROP TRIGGER IF EXISTS trigger_clientes_count ON clientes;
CREATE TRIGGER trigger_clientes_count
  AFTER INSERT OR DELETE OR UPDATE OF es_practica ON clientes
  FOR EACH ROW EXECUTE FUNCTION update_clientes_count();

-- ----------------------------------------------------------------------------
-- 3b. es_practica lo escribe solo el servidor
-- ----------------------------------------------------------------------------
-- Sin SECURITY DEFINER a propósito: necesita ver el current_user de quien
-- escribe. Las filas que crea un RPC SECURITY DEFINER corren con el dueño de la
-- función y pasan; las que quedan con el default FALSE también.
CREATE OR REPLACE FUNCTION es_practica_solo_servidor()
RETURNS TRIGGER AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF (TG_OP = 'INSERT' AND NEW.es_practica)
       OR (TG_OP = 'UPDATE' AND NEW.es_practica IS DISTINCT FROM OLD.es_practica) THEN
      RAISE EXCEPTION 'es_practica lo escribe solo el servidor'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trigger_clientes_es_practica_guard ON clientes;
CREATE TRIGGER trigger_clientes_es_practica_guard
  BEFORE INSERT OR UPDATE OF es_practica ON clientes
  FOR EACH ROW EXECUTE FUNCTION es_practica_solo_servidor();

DROP TRIGGER IF EXISTS trigger_ordenes_es_practica_guard ON ordenes_servicio;
CREATE TRIGGER trigger_ordenes_es_practica_guard
  BEFORE INSERT OR UPDATE OF es_practica ON ordenes_servicio
  FOR EACH ROW EXECUTE FUNCTION es_practica_solo_servidor();

-- ----------------------------------------------------------------------------
-- 3. v_clientes_resumen
-- ----------------------------------------------------------------------------
-- c.* se expandió al crear la vista (294:42-53): la columna nueva solo aparece
-- recreándola, y CREATE OR REPLACE falla porque es_practica cae antes de
-- ordenes_count. Recreación textual de 294:55-85, sin cambiar nada más, con la
-- misma opción security_invoker que fija 347. La lista de clientes lee esta
-- vista (app/api/clientes/route.ts:71,83).
-- Sin CASCADE a propósito: un dependiente inesperado tiene que fallar
-- ruidosamente.
--
-- PERMISOS: DROP VIEW se lleva los GRANT y CREATE VIEW aplica los default
-- privileges del esquema, que pueden no coincidir con los que tenía. Se guarda
-- el ACL antes del DROP y se restaura exacto después del CREATE. El autocheck
-- (f) compara los dos y verifica también la opción security_invoker.
CREATE TEMP TABLE _acl_v_clientes_resumen_348 ON COMMIT DROP AS
  SELECT relacl FROM pg_class WHERE oid = 'public.v_clientes_resumen'::regclass;

DROP VIEW IF EXISTS v_clientes_resumen;
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

DO $$
DECLARE
  r RECORD;
  v_owner OID;
BEGIN
  SELECT relowner INTO v_owner FROM pg_class WHERE oid = 'public.v_clientes_resumen'::regclass;

  -- 1. Sacar lo que pusieron los default privileges al crear la vista.
  FOR r IN
    SELECT DISTINCT a.grantee
      FROM pg_class c, aclexplode(c.relacl) a
     WHERE c.oid = 'public.v_clientes_resumen'::regclass AND a.grantee <> v_owner
  LOOP
    EXECUTE format('REVOKE ALL ON public.v_clientes_resumen FROM %s',
      CASE WHEN r.grantee = 0 THEN 'PUBLIC'
           ELSE (SELECT quote_ident(rolname) FROM pg_roles WHERE oid = r.grantee) END);
  END LOOP;

  -- 2. Volver a dar exactamente lo que tenía (un ACL NULL no devuelve filas:
  --    queda solo el dueño, igual que antes).
  FOR r IN
    SELECT a.grantee, a.privilege_type, a.is_grantable
      FROM _acl_v_clientes_resumen_348 t, aclexplode(t.relacl) a
     WHERE a.grantee <> v_owner
  LOOP
    EXECUTE format('GRANT %s ON public.v_clientes_resumen TO %s%s',
      r.privilege_type,
      CASE WHEN r.grantee = 0 THEN 'PUBLIC'
           ELSE (SELECT quote_ident(rolname) FROM pg_roles WHERE oid = r.grantee) END,
      CASE WHEN r.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 4. borrar_datos_practica
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION borrar_datos_practica(p_org_id TEXT)
RETURNS JSONB AS $$
DECLARE
  v_orden_id TEXT;
  v_cliente_id TEXT;
  v_fk RECORD;
  v_referenciado BOOLEAN;
  v_orden_usada BOOLEAN;
  v_orden_borrada BOOLEAN := FALSE;
  v_orden_conservada BOOLEAN := FALSE;
  v_cliente_conservado BOOLEAN := FALSE;
BEGIN
  -- Camino rápido: la gran mayoría de las órdenes reales llegan acá sin
  -- práctica. Los dos índices parciales hacen esto casi gratis.
  IF NOT EXISTS (SELECT 1 FROM ordenes_servicio WHERE organization_id = p_org_id AND es_practica)
     AND NOT EXISTS (SELECT 1 FROM clientes WHERE organization_id = p_org_id AND es_practica) THEN
    RETURN jsonb_build_object('orden_borrada', FALSE, 'orden_conservada', FALSE,
                              'cliente_conservado', FALSE);
  END IF;

  -- La orden. Mismo criterio que el cliente: si otra tabla ya usa la orden, se
  -- conserva como orden real. FOR UPDATE antes de mirar, así un INSERT
  -- concurrente que la referencie (FOR KEY SHARE) espera.
  FOR v_orden_id IN
    SELECT id FROM ordenes_servicio
     WHERE organization_id = p_org_id AND es_practica
       FOR UPDATE
  LOOP
    v_orden_usada := FALSE;
    -- Las seis tablas excluidas las escribe la práctica misma (eventos,
    -- tiempos por estado, avisos, fotos y checklist): no son uso.
    FOR v_fk IN
      SELECT c.conrelid::regclass AS tabla, c.conkey, a.attname AS columna
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
       WHERE c.contype = 'f'
         AND c.confrelid = 'public.ordenes_servicio'::regclass
         AND c.conrelid NOT IN ('public.orden_eventos'::regclass,
                                'public.orden_tiempos_estado'::regclass,
                                'public.notification_logs'::regclass,
                                'public.user_notifications'::regclass,
                                'public.fotos_orden'::regclass,
                                'public.checklist_recepcion'::regclass)
    LOOP
      IF array_length(v_fk.conkey, 1) <> 1 THEN
        -- FK compuesta: no se sabe chequear, así que se conserva la orden.
        v_orden_usada := TRUE;
      ELSE
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)', v_fk.tabla, v_fk.columna)
          INTO v_orden_usada
          USING v_orden_id;
      END IF;
      EXIT WHEN v_orden_usada;
    END LOOP;

    IF v_orden_usada THEN
      -- El dueño la usó para trabajo real: pasa a ser una orden real. Su
      -- cliente queda referenciado por ella, así que el bucle de abajo también
      -- lo conserva.
      UPDATE ordenes_servicio SET es_practica = FALSE WHERE id = v_orden_id;
      v_orden_conservada := TRUE;
    ELSE
      -- Sus notificaciones tienen FK SET NULL: se borran antes, si no la
      -- campanita queda con un link a una orden que ya no existe. El resto
      -- cascadea.
      DELETE FROM user_notifications WHERE orden_id = v_orden_id;
      DELETE FROM notification_logs WHERE orden_id = v_orden_id;
      DELETE FROM ordenes_servicio WHERE id = v_orden_id;
      v_orden_borrada := TRUE;
    END IF;
  END LOOP;

  -- El cliente, incluido uno huérfano (orden borrada a mano desde el listado).
  FOR v_cliente_id IN
    SELECT id FROM clientes
     WHERE organization_id = p_org_id AND es_practica
       FOR UPDATE
  LOOP
    v_referenciado := FALSE;
    FOR v_fk IN
      SELECT c.conrelid::regclass AS tabla, c.conkey, a.attname AS columna
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
       WHERE c.contype = 'f'
         AND c.confrelid = 'public.clientes'::regclass
         -- Los logs de notificaciones no son uso: son efecto de avisar.
         AND c.conrelid NOT IN ('public.notification_logs'::regclass,
                                'public.user_notifications'::regclass)
    LOOP
      IF array_length(v_fk.conkey, 1) <> 1 THEN
        -- FK compuesta: no se sabe chequear, así que se conserva el cliente.
        v_referenciado := TRUE;
      ELSE
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)', v_fk.tabla, v_fk.columna)
          INTO v_referenciado
          USING v_cliente_id;
      END IF;
      EXIT WHEN v_referenciado;
    END LOOP;

    IF v_referenciado THEN
      -- El dueño lo usó para trabajo real: pasa a ser un cliente real.
      UPDATE clientes SET es_practica = FALSE WHERE id = v_cliente_id;
      v_cliente_conservado := TRUE;
    ELSE
      DELETE FROM user_notifications WHERE cliente_id = v_cliente_id;
      DELETE FROM clientes WHERE id = v_cliente_id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('orden_borrada', v_orden_borrada,
                            'orden_conservada', v_orden_conservada,
                            'cliente_conservado', v_cliente_conservado);
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

COMMENT ON FUNCTION borrar_datos_practica(TEXT) IS
  'Borra la orden de práctica del onboarding y su cliente si nada real los referencia; lo que ya se usó se conserva como real. Ver migración 348.';

REVOKE EXECUTE ON FUNCTION borrar_datos_practica(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION borrar_datos_practica(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION borrar_datos_practica(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION borrar_datos_practica(TEXT) TO service_role;

-- ----------------------------------------------------------------------------
-- 4b. registrar_camino_onboarding
-- ----------------------------------------------------------------------------
-- Una sola sentencia: crea la fila si falta y decide el pisado en el mismo
-- ON CONFLICT, así dos requests concurrentes no se pisan. Reglas:
--   - 'practica' siempre se guarda: es el camino más informativo.
--   - nada pisa una 'practica' ya registrada.
--   - 'omitido' solo completa un camino vacío.
--   - 'real' pisa un camino vacío u 'omitido'.
-- onboarding_progress.organization_id es UNIQUE (039:13).
CREATE OR REPLACE FUNCTION registrar_camino_onboarding(p_org_id TEXT, p_camino TEXT)
RETURNS TEXT AS $$
  INSERT INTO onboarding_progress (organization_id, camino)
  VALUES (p_org_id, p_camino)
  ON CONFLICT (organization_id) DO UPDATE
    SET camino = CASE
      WHEN EXCLUDED.camino = 'practica' THEN 'practica'
      WHEN onboarding_progress.camino = 'practica' THEN 'practica'
      WHEN EXCLUDED.camino = 'omitido' THEN COALESCE(onboarding_progress.camino, 'omitido')
      ELSE EXCLUDED.camino
    END
  RETURNING camino;
$$ LANGUAGE sql STRICT SET search_path = public, pg_temp;

COMMENT ON FUNCTION registrar_camino_onboarding(TEXT, TEXT) IS
  'Upsert de onboarding_progress.camino: crea la fila si falta, omitido nunca pisa, nada pisa practica. Ver migración 348.';

REVOKE EXECUTE ON FUNCTION registrar_camino_onboarding(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION registrar_camino_onboarding(TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION registrar_camino_onboarding(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION registrar_camino_onboarding(TEXT, TEXT) TO service_role;

-- ----------------------------------------------------------------------------
-- 5. Autocheck: org sintética, sub-bloque que siempre se revierte
-- ----------------------------------------------------------------------------
-- La org nace con suscripción Free (006:332-343) y su sucursal principal la
-- crea el trigger de 217. Nada de lo que se crea acá sobrevive: el sub-bloque
-- termina con un RAISE que lo revierte. Las variables de plpgsql no se
-- revierten, así que v_falla conserva lo que se detectó.
DO $$
DECLARE
  v_org TEXT := 'autocheck-348-' || substr(md5(random()::text), 1, 10);
  v_suc TEXT;
  v_falla TEXT;
  v_cli_a TEXT;
  v_cli_b TEXT;
  v_cli_c TEXT;
  v_orden_a TEXT;
  v_orden_b TEXT;
  v_orden_c TEXT;
  v_orden_real TEXT;
  v_res JSONB;
  v_n INT;
  v_antes INT;
  v_c TEXT;
BEGIN
  BEGIN
    INSERT INTO organizations (id, nombre, slug, activo, rubro)
    VALUES (v_org, 'Autocheck 348', v_org, TRUE, 'electronica');

    SELECT id INTO v_suc FROM sucursales WHERE organization_id = v_org AND principal LIMIT 1;
    IF v_suc IS NULL THEN
      v_falla := 'el alta de la org no creó la sucursal principal (217)';
      RAISE EXCEPTION 'autocheck-348-rollback';
    END IF;

    -- (a) La práctica no consume cupo del plan.
    INSERT INTO clientes (organization_id, nombre, telefono, es_practica)
    VALUES (v_org, 'Práctica A', '', TRUE) RETURNING id INTO v_cli_a;
    INSERT INTO ordenes_servicio (organization_id, sucursal_id, cliente_id, numero_orden, codigo_orden,
                                  dispositivo, tipo_dispositivo, problema_reportado, estado, es_practica)
    VALUES (v_org, v_suc, v_cli_a, 0, 'PRACTICA', 'Equipo', 'CELULAR', 'No enciende', 'RECIBIDO', TRUE)
    RETURNING id INTO v_orden_a;

    SELECT COALESCE(clientes_count, 0) + COALESCE(ordenes_mes_actual, 0) INTO v_n
      FROM organization_usage WHERE organization_id = v_org;
    IF COALESCE(v_n, 0) <> 0 THEN
      v_falla := concat_ws('; ', v_falla, 'los triggers contaron filas de práctica (' || v_n || ')');
    END IF;

    -- (b) A lo sumo una práctica por org: numero_orden 0 es único.
    BEGIN
      INSERT INTO ordenes_servicio (organization_id, sucursal_id, cliente_id, numero_orden, codigo_orden,
                                    dispositivo, tipo_dispositivo, problema_reportado, estado, es_practica)
      VALUES (v_org, v_suc, v_cli_a, 0, 'PRACTICA', 'Equipo', 'CELULAR', 'No enciende', 'RECIBIDO', TRUE);
      v_falla := concat_ws('; ', v_falla, 'se pudo crear una segunda orden con numero_orden 0');
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;

    -- (c) Práctica sin uso real: se borra todo y no se descuenta cupo.
    INSERT INTO notification_logs (organization_id, orden_id, cliente_id, tipo, canal, estado,
                                   destinatario, contenido)
    VALUES (v_org, v_orden_a, v_cli_a, 'CAMBIO_ESTADO', 'EMAIL', 'ENVIADO',
            'autocheck@example.com', 'autocheck');

    -- Contador sembrado: con 0 el piso GREATEST(0, n - 1) escondería un descuento.
    UPDATE organization_usage SET clientes_count = 5 WHERE organization_id = v_org;

    v_res := borrar_datos_practica(v_org);
    IF (v_res->>'orden_borrada')::BOOLEAN IS NOT TRUE
       OR (v_res->>'orden_conservada')::BOOLEAN IS NOT FALSE
       OR EXISTS (SELECT 1 FROM ordenes_servicio WHERE id = v_orden_a)
       OR EXISTS (SELECT 1 FROM clientes WHERE id = v_cli_a)
       OR EXISTS (SELECT 1 FROM notification_logs WHERE cliente_id = v_cli_a) THEN
      v_falla := concat_ws('; ', v_falla, 'no se borró la práctica sin uso: ' || v_res::TEXT);
    END IF;
    SELECT COALESCE(clientes_count, 0) INTO v_n FROM organization_usage WHERE organization_id = v_org;
    IF v_n IS DISTINCT FROM 5 THEN
      v_falla := concat_ws('; ', v_falla, 'borrar la práctica movió clientes_count de 5 a ' || v_n);
    END IF;

    -- (d) Cliente de práctica usado en una orden real (FK con CASCADE): se
    --     conserva, pasa a real y suma 1; la orden real sobrevive.
    INSERT INTO clientes (organization_id, nombre, telefono, es_practica)
    VALUES (v_org, 'Práctica B', '', TRUE) RETURNING id INTO v_cli_b;
    INSERT INTO ordenes_servicio (organization_id, sucursal_id, cliente_id, numero_orden, codigo_orden,
                                  dispositivo, tipo_dispositivo, problema_reportado, estado, es_practica)
    VALUES (v_org, v_suc, v_cli_b, 0, 'PRACTICA', 'Equipo', 'CELULAR', 'No enciende', 'RECIBIDO', TRUE)
    RETURNING id INTO v_orden_b;
    INSERT INTO ordenes_servicio (organization_id, sucursal_id, cliente_id, numero_orden, codigo_orden,
                                  dispositivo, tipo_dispositivo, problema_reportado, estado)
    VALUES (v_org, v_suc, v_cli_b, 1, 'CEL001', 'Equipo real', 'CELULAR', 'Pantalla', 'RECIBIDO')
    RETURNING id INTO v_orden_real;

    SELECT COALESCE(clientes_count, 0) INTO v_antes FROM organization_usage WHERE organization_id = v_org;
    v_res := borrar_datos_practica(v_org);

    IF (v_res->>'cliente_conservado')::BOOLEAN IS NOT TRUE
       OR NOT EXISTS (SELECT 1 FROM clientes WHERE id = v_cli_b AND NOT es_practica)
       OR NOT EXISTS (SELECT 1 FROM ordenes_servicio WHERE id = v_orden_real)
       OR EXISTS (SELECT 1 FROM ordenes_servicio WHERE id = v_orden_b) THEN
      v_falla := concat_ws('; ', v_falla, 'se destruyeron o no se liberaron datos reales: ' || v_res::TEXT);
    END IF;
    SELECT COALESCE(clientes_count, 0) INTO v_n FROM organization_usage WHERE organization_id = v_org;
    IF v_n IS DISTINCT FROM v_antes + 1 THEN
      v_falla := concat_ws('; ', v_falla,
        'el cliente que pasó a real no sumó cupo (' || v_antes || ' -> ' || v_n || ')');
    END IF;

    -- (e) La lista de clientes lee la vista: tiene que exponer la columna.
    PERFORM es_practica FROM v_clientes_resumen LIMIT 1;

    -- (h) anon/authenticated no pueden fijar es_practica: el guard responde con
    --     su propio mensaje, antes de RLS (los BEFORE ROW corren primero).
    BEGIN
      SET LOCAL ROLE authenticated;
      INSERT INTO clientes (organization_id, nombre, telefono, es_practica)
      VALUES (v_org, 'Guard C', '1', TRUE);
      RESET ROLE;
      v_falla := concat_ws('; ', v_falla, 'authenticated pudo insertar un cliente con es_practica');
    EXCEPTION WHEN insufficient_privilege THEN
      RESET ROLE;
      IF SQLERRM <> 'es_practica lo escribe solo el servidor' THEN
        v_falla := concat_ws('; ', v_falla, 'cliente: el rechazo no vino del guard: ' || SQLERRM);
      END IF;
    END;
    BEGIN
      SET LOCAL ROLE authenticated;
      INSERT INTO ordenes_servicio (organization_id, sucursal_id, cliente_id, numero_orden, codigo_orden,
                                    dispositivo, tipo_dispositivo, problema_reportado, estado, es_practica)
      VALUES (v_org, v_suc, v_cli_b, 98, 'PRACTICA', 'Equipo', 'CELULAR', 'No enciende', 'RECIBIDO', TRUE);
      RESET ROLE;
      v_falla := concat_ws('; ', v_falla, 'authenticated pudo insertar una orden con es_practica');
    EXCEPTION WHEN insufficient_privilege THEN
      RESET ROLE;
      IF SQLERRM <> 'es_practica lo escribe solo el servidor' THEN
        v_falla := concat_ws('; ', v_falla, 'orden: el rechazo no vino del guard: ' || SQLERRM);
      END IF;
    END;

    -- (g) camino: fila ausente y fila presente, para las dos escrituras.
    --     La org sintética no tiene fila (la crea el registro en la app, no un
    --     trigger), así que arranca en el caso "fila ausente".
    -- POST de la práctica, fila ausente: se crea con 'practica'.
    v_c := registrar_camino_onboarding(v_org, 'practica');
    SELECT COUNT(*) INTO v_n FROM onboarding_progress WHERE organization_id = v_org;
    IF v_c IS DISTINCT FROM 'practica' OR v_n <> 1 THEN
      v_falla := concat_ws('; ', v_falla, 'practica sin fila: ' || COALESCE(v_c, 'NULL') || ', filas ' || v_n);
    END IF;
    -- /complete, fila presente con 'practica': ni 'omitido' ni 'real' la pisan.
    v_c := registrar_camino_onboarding(v_org, 'omitido');
    IF v_c IS DISTINCT FROM 'practica' THEN
      v_falla := concat_ws('; ', v_falla, 'omitido pisó practica: ' || COALESCE(v_c, 'NULL'));
    END IF;
    v_c := registrar_camino_onboarding(v_org, 'real');
    IF v_c IS DISTINCT FROM 'practica' THEN
      v_falla := concat_ws('; ', v_falla, 'real pisó practica: ' || COALESCE(v_c, 'NULL'));
    END IF;
    -- /complete, fila ausente: se crea con el camino pedido.
    DELETE FROM onboarding_progress WHERE organization_id = v_org;
    v_c := registrar_camino_onboarding(v_org, 'omitido');
    SELECT COUNT(*) INTO v_n FROM onboarding_progress WHERE organization_id = v_org;
    IF v_c IS DISTINCT FROM 'omitido' OR v_n <> 1 THEN
      v_falla := concat_ws('; ', v_falla, 'omitido sin fila: ' || COALESCE(v_c, 'NULL') || ', filas ' || v_n);
    END IF;
    -- POST de la práctica, fila presente: 'practica' se guarda igual.
    v_c := registrar_camino_onboarding(v_org, 'practica');
    IF v_c IS DISTINCT FROM 'practica' THEN
      v_falla := concat_ws('; ', v_falla, 'practica no pisó omitido: ' || COALESCE(v_c, 'NULL'));
    END IF;
    -- Fila presente con camino vacío: 'omitido' lo completa.
    UPDATE onboarding_progress SET camino = NULL WHERE organization_id = v_org;
    v_c := registrar_camino_onboarding(v_org, 'omitido');
    IF v_c IS DISTINCT FROM 'omitido' THEN
      v_falla := concat_ws('; ', v_falla, 'omitido no completó un camino vacío: ' || COALESCE(v_c, 'NULL'));
    END IF;
    -- Fila presente con 'omitido': 'real' lo pisa.
    v_c := registrar_camino_onboarding(v_org, 'real');
    IF v_c IS DISTINCT FROM 'real' THEN
      v_falla := concat_ws('; ', v_falla, 'real no pisó omitido: ' || COALESCE(v_c, 'NULL'));
    END IF;
    -- Fila presente con 'real': 'omitido' nunca pisa.
    UPDATE onboarding_progress SET camino = 'real' WHERE organization_id = v_org;
    v_c := registrar_camino_onboarding(v_org, 'omitido');
    IF v_c IS DISTINCT FROM 'real' THEN
      v_falla := concat_ws('; ', v_falla, 'omitido pisó real: ' || COALESCE(v_c, 'NULL'));
    END IF;
    -- El CHECK rechaza un camino desconocido.
    BEGIN
      PERFORM registrar_camino_onboarding(v_org, 'otro');
      v_falla := concat_ws('; ', v_falla, 'se aceptó el camino ''otro''');
    EXCEPTION WHEN check_violation THEN
      NULL;
    END;

    -- (i) Práctica con un cobro (tabla fuera de las que escribe la práctica):
    --     la orden se conserva y pasa a real, el cobro sigue ahí y el cliente,
    --     que la orden referencia, también se conserva. Teléfono '0' porque el
    --     cliente de (d) ya es real con teléfono vacío (UNIQUE por org).
    INSERT INTO clientes (organization_id, nombre, telefono, es_practica)
    VALUES (v_org, 'Práctica C', '0', TRUE) RETURNING id INTO v_cli_c;
    INSERT INTO ordenes_servicio (organization_id, sucursal_id, cliente_id, numero_orden, codigo_orden,
                                  dispositivo, tipo_dispositivo, problema_reportado, estado, es_practica)
    VALUES (v_org, v_suc, v_cli_c, 0, 'PRACTICA', 'Equipo', 'CELULAR', 'No enciende', 'RECIBIDO', TRUE)
    RETURNING id INTO v_orden_c;
    INSERT INTO cobros_orden (orden_id, organization_id, monto, metodo_pago)
    VALUES (v_orden_c, v_org, 100, 'EFECTIVO');

    v_res := borrar_datos_practica(v_org);
    IF (v_res->>'orden_conservada')::BOOLEAN IS NOT TRUE
       OR (v_res->>'orden_borrada')::BOOLEAN IS NOT FALSE
       OR (v_res->>'cliente_conservado')::BOOLEAN IS NOT TRUE
       OR NOT EXISTS (SELECT 1 FROM ordenes_servicio WHERE id = v_orden_c AND NOT es_practica)
       OR NOT EXISTS (SELECT 1 FROM cobros_orden WHERE orden_id = v_orden_c)
       OR NOT EXISTS (SELECT 1 FROM clientes WHERE id = v_cli_c AND NOT es_practica) THEN
      v_falla := concat_ws('; ', v_falla, 'no se conservó la práctica con un cobro: ' || v_res::TEXT);
    END IF;

    RAISE EXCEPTION 'autocheck-348-rollback';
  EXCEPTION WHEN raise_exception THEN
    -- Solo se traga la señal propia. Cualquier otro P0001 (p. ej. un límite de
    -- plan) es un error real y aborta la migración.
    IF SQLERRM <> 'autocheck-348-rollback' THEN
      RAISE;
    END IF;
  END;

  -- (f) Privilegios: lectura pura, fuera del bloque revertido.
  IF has_function_privilege('anon', 'borrar_datos_practica(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'borrar_datos_practica(text)', 'EXECUTE') THEN
    v_falla := concat_ws('; ', v_falla, 'anon/authenticated pueden ejecutar borrar_datos_practica');
  END IF;
  IF has_function_privilege('anon', 'registrar_camino_onboarding(text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'registrar_camino_onboarding(text, text)', 'EXECUTE') THEN
    v_falla := concat_ws('; ', v_falla, 'anon/authenticated pueden ejecutar registrar_camino_onboarding');
  END IF;
  -- La vista recreada tiene exactamente los permisos que tenía (sin mirar el
  -- grantor, que puede cambiar con quien corre la migración).
  IF EXISTS (
    (SELECT a.grantee, a.privilege_type, a.is_grantable
       FROM _acl_v_clientes_resumen_348 t, aclexplode(t.relacl) a
      WHERE a.grantee <> (SELECT relowner FROM pg_class WHERE oid = 'public.v_clientes_resumen'::regclass)
     EXCEPT
     SELECT a.grantee, a.privilege_type, a.is_grantable
       FROM pg_class c, aclexplode(c.relacl) a
      WHERE c.oid = 'public.v_clientes_resumen'::regclass)
    UNION ALL
    (SELECT a.grantee, a.privilege_type, a.is_grantable
       FROM pg_class c, aclexplode(c.relacl) a
      WHERE c.oid = 'public.v_clientes_resumen'::regclass
        AND a.grantee <> c.relowner
     EXCEPT
     SELECT a.grantee, a.privilege_type, a.is_grantable
       FROM _acl_v_clientes_resumen_348 t, aclexplode(t.relacl) a)
  ) THEN
    v_falla := concat_ws('; ', v_falla, 'los permisos de v_clientes_resumen cambiaron al recrearla');
  END IF;
  -- La vista conserva la opción security_invoker.
  IF NOT EXISTS (SELECT 1 FROM pg_class
                  WHERE oid = 'public.v_clientes_resumen'::regclass
                    AND reloptions @> ARRAY['security_invoker=true']) THEN
    v_falla := concat_ws('; ', v_falla, 'v_clientes_resumen quedó sin security_invoker');
  END IF;

  IF v_falla IS NOT NULL THEN
    RAISE EXCEPTION 'AUTOCHECK 348 FALLÓ: %', v_falla;
  END IF;
END $$;

SELECT 'autocheck 348 OK' AS resultado;

-- ----------------------------------------------------------------------------
-- 6. Solo lectura: comparar con las tablas de FKs del plan
-- ----------------------------------------------------------------------------
-- Una FK NO ACTION o RESTRICT hacia ordenes_servicio que no esté en el plan
-- puede hacer fallar borrar_datos_practica. Revisarla antes de --apply.
SELECT c.confrelid::regclass::text AS apunta_a,
       c.conrelid::regclass::text  AS tabla,
       a.attname                   AS columna,
       CASE c.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL'
                          WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
                          WHEN 'd' THEN 'SET DEFAULT' END AS on_delete
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
 WHERE c.contype = 'f'
   AND c.confrelid IN ('public.clientes'::regclass, 'public.ordenes_servicio'::regclass)
 ORDER BY 1, 2, 3;

-- Un cliente real con teléfono vacío choca con el de práctica
-- (UNIQUE(organization_id, telefono)). Esperado: 0.
SELECT COUNT(*) AS clientes_reales_con_telefono_vacio
  FROM clientes WHERE telefono = '' AND NOT es_practica;

-- Permisos y opciones de la vista recreada (los permisos, iguales a los de
-- antes, ver autocheck (f); las opciones, {security_invoker=true}).
SELECT relacl::text AS acl_v_clientes_resumen,
       reloptions::text AS opciones_v_clientes_resumen
  FROM pg_class WHERE oid = 'public.v_clientes_resumen'::regclass;
