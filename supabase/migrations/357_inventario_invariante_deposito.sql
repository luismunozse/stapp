-- ========================================
-- Migracion 357: invariante inventario.stock = SUM(inventario_depositos.stock)
-- en todos los escritores de stock que todavia la rompian.
-- ========================================
--
-- Contexto: desde la 206 el stock del item (inventario.stock) tiene un detalle por
-- deposito (inventario_depositos) y los RPCs de stock lo mantienen sincronizado a
-- traves de incrementar_stock_deposito / descontar_stock_deposito. Una auditoria de
-- todos los escritores encontro seis que escribian solo el total (o solo el
-- detalle de un deposito), asi que la suma del detalle se desvia del total:
--
--   A.  finalizar_conteo: con conteo por deposito pisaba el TOTAL del item con el
--       conteo de UN deposito y no tocaba el detalle. Ahora aplica
--       (contado - sistema) sobre el stock actual del deposito del conteo (o del
--       total si es global) via los helpers 206. Nuevo trigger BEFORE UPDATE OF
--       stock_contado en conteos_items: refresca stock_sistema con el stock vivo
--       al cargar cada conteo, para que la diferencia aplicada sea exactamente la
--       que vio el operador.
--   B1. ensamblar/desensamblar_kit_atomic: sin p_deposito_id movian el total pero
--       no el detalle; desensamblar ignoraba las reservas. Ahora todo el detalle
--       pasa por los helpers y se valida disponible (stock - reservado).
--   B2. consolidate_inventario_items: ignoraba el detalle. Ahora mueve cada fila
--       por deposito al destino y deja el origen archivado sin detalle.
--   F.  registrar_entrada_lote/series: el deposito por defecto era un
--       "principal = true LIMIT 1" sin orden (hay un principal por sucursal) y
--       omitia el detalle si no resolvia ninguno. Ahora usa
--       get_deposito_principal y valida proveedor / orden de compra / deposito
--       contra la organizacion (P0002).
--   G.  seed_deposito_inicial: sembraba el detalle pero no escribia movimiento,
--       el kardex nunca arrancaba en 0. Ahora registra la ENTRADA con
--       referencia_tipo = 'STOCK_INICIAL'. La API re-apunta ese movimiento al
--       deposito elegido cuando mueve el stock inicial (lib/depositos.ts); antes
--       de aplicar esta migracion ese UPDATE no matchea filas (no-op).
--   H.  Variantes: sync_inventario_total_variantes y las RPCs de variantes
--       cambiaban el total del padre sin tocar el detalle. Ahora el delta del
--       total va al detalle (sube al principal / baja drenando principal primero)
--       y el kardex registra totales del item.
--
-- Alcance: solo CREATE OR REPLACE FUNCTION, DROP/CREATE TRIGGER, COMMENT ON y
-- REVOKE/GRANT. NO modifica datos. Las firmas son identicas a las de produccion,
-- asi que CREATE OR REPLACE reemplaza en lugar de agregar sobrecargas. No empieza
-- con BEGIN: scripts/db-run.mjs rechaza --apply sobre archivos transaccionales
-- propios.
--
-- Orden de despliegue:
--   1. Antes de aplicar: finalizar o cancelar los conteos EN_PROGRESO
--      (SELECT id, nombre, deposito_id FROM conteos_inventario
--       WHERE estado = 'EN_PROGRESO'). Los items cargados antes de la migracion
--      conservan el snapshot del inicio y se aplicarian contra ese valor.
--   2. Mergear y desplegar el cambio TS de G (lib/depositos.ts): hasta que esta
--      migracion se aplique no hace nada.
--   3. Dry-run:  node scripts/db-run.mjs supabase/migrations/357_inventario_invariante_deposito.sql
--      Luego --apply, y correr verify/357_probes.sql (BEGIN ... ROLLBACK).
--   4. Correr backfill/357_auditoria_drift_depositos.sql (solo lectura) y esperar
--      0 filas con drift. No hay script de reparacion: una auditoria de solo
--      lectura en produccion (2026-10-13) no encontro items con drift ni conteos
--      por deposito aplicados.
--   5. Despues, la 358 (REVOKE de los RPCs de stock a anon/authenticated).
--
-- Reversible: rollback/357_rollback.sql restaura los cuerpos originales
-- (170, 177, 123, 175, 176, 291) y elimina el trigger y la funcion nuevos.
-- ========================================

-- ========================================
-- A. Conteos: la diferencia se aplica sobre el deposito correcto
-- ========================================
-- ============================================================
-- A.1 Refrescar stock_sistema al cargar el conteo
-- ============================================================
-- stock_sistema pasa a ser "el stock del sistema en el momento en que se cargó
-- el conteo" (no al iniciar). Así la diferencia (columna generada) es exacta y
-- lo que se aplica al finalizar es lo que el operador vio.
CREATE OR REPLACE FUNCTION conteo_item_refrescar_sistema()
RETURNS TRIGGER AS $$
DECLARE
  v_estado      TEXT;
  v_deposito_id TEXT;
  v_actual      INTEGER;
BEGIN
  IF NEW.stock_contado IS NULL
     OR NEW.stock_contado IS NOT DISTINCT FROM OLD.stock_contado THEN
    RETURN NEW;
  END IF;

  SELECT estado, deposito_id INTO v_estado, v_deposito_id
  FROM conteos_inventario
  WHERE id = NEW.conteo_id;

  IF NOT FOUND OR v_estado <> 'EN_PROGRESO' THEN
    RETURN NEW;
  END IF;

  IF v_deposito_id IS NOT NULL THEN
    SELECT COALESCE(
      (SELECT stock FROM inventario_depositos
       WHERE inventario_id = NEW.inventario_id AND deposito_id = v_deposito_id),
      0)
    INTO v_actual;
  ELSE
    SELECT COALESCE(stock, 0) INTO v_actual
    FROM inventario WHERE id = NEW.inventario_id;
  END IF;

  NEW.stock_sistema := COALESCE(v_actual, NEW.stock_sistema);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS conteos_items_refrescar_sistema ON conteos_items;
CREATE TRIGGER conteos_items_refrescar_sistema
  BEFORE UPDATE OF stock_contado ON conteos_items
  FOR EACH ROW EXECUTE FUNCTION conteo_item_refrescar_sistema();

COMMENT ON FUNCTION conteo_item_refrescar_sistema() IS
  'v357: al cargar stock_contado, stock_sistema se refresca con el stock vivo (del depósito del conteo o total). La diferencia generada queda exacta al momento del conteo físico.';

-- ============================================================
-- A.2 finalizar_conteo: aplica la diferencia en el depósito correcto
-- ============================================================
CREATE OR REPLACE FUNCTION finalizar_conteo(
  p_conteo_id TEXT,
  p_user_id   TEXT,
  p_forzar    BOOLEAN DEFAULT false  -- true = permite finalizar con items sin contar
) RETURNS JSONB AS $$
DECLARE
  v_conteo        RECORD;
  v_pendientes    INTEGER;
  v_item          RECORD;
  v_total_actual  INTEGER;
  v_reservado     INTEGER;
  v_base          INTEGER;   -- stock sobre el que se aplica la diferencia
  v_aplicado      INTEGER;
  v_dep_efectivo  TEXT;
  v_obs           TEXT;
  v_ajustados     INTEGER := 0;
BEGIN
  SELECT * INTO v_conteo
  FROM conteos_inventario
  WHERE id = p_conteo_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conteo no encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF v_conteo.estado <> 'EN_PROGRESO' THEN
    RAISE EXCEPTION 'Conteo no está en progreso (estado: %)', v_conteo.estado
      USING ERRCODE = '22023';
  END IF;

  IF NOT p_forzar THEN
    SELECT COUNT(*) INTO v_pendientes
    FROM conteos_items
    WHERE conteo_id = p_conteo_id AND stock_contado IS NULL;

    IF v_pendientes > 0 THEN
      RAISE EXCEPTION 'Hay % items sin contar. Cargá todos o usá p_forzar=true', v_pendientes
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_conteo.aplicar_ajustes THEN
    FOR v_item IN
      SELECT ci.inventario_id, ci.stock_sistema, ci.stock_contado, ci.diferencia, ci.observaciones
      FROM conteos_items ci
      WHERE ci.conteo_id = p_conteo_id
        AND ci.stock_contado IS NOT NULL
        AND ci.diferencia <> 0
      ORDER BY ci.inventario_id            -- orden de locks determinista
    LOOP
      SELECT COALESCE(stock, 0), COALESCE(stock_reservado, 0)
        INTO v_total_actual, v_reservado
      FROM inventario
      WHERE id = v_item.inventario_id
        AND organization_id = v_conteo.organization_id
      FOR UPDATE;

      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      -- Pre-lock del detalle en el mismo orden que transferir_stock_atomic.
      PERFORM 1 FROM inventario_depositos
      WHERE inventario_id = v_item.inventario_id
      ORDER BY deposito_id
      FOR UPDATE;

      -- Delta = contado - sistema (sistema refrescado al cargar el conteo),
      -- aplicado sobre el stock ACTUAL: lo que se movió después del conteo
      -- físico se conserva.
      IF v_conteo.deposito_id IS NOT NULL THEN
        SELECT COALESCE(
          (SELECT stock FROM inventario_depositos
           WHERE inventario_id = v_item.inventario_id
             AND deposito_id = v_conteo.deposito_id),
          0)
        INTO v_base;
      ELSE
        v_base := v_total_actual;
      END IF;

      v_aplicado := GREATEST(v_base + v_item.diferencia, 0) - v_base;
      -- Defensa ante drift histórico (detalle > total): el total no baja de 0.
      v_aplicado := GREATEST(v_aplicado, -v_total_actual);

      IF v_aplicado = 0 THEN
        CONTINUE;
      END IF;

      -- Depósito del conteo (o principal / drain principal-primero si es global).
      -- Nunca estricto: el conteo físico manda sobre las reservas; el drain
      -- clampea stock_reservado por fila.
      IF v_aplicado > 0 THEN
        v_dep_efectivo := incrementar_stock_deposito(
          v_item.inventario_id, v_conteo.organization_id,
          v_conteo.deposito_id, v_aplicado);
      ELSE
        v_dep_efectivo := descontar_stock_deposito(
          v_item.inventario_id, v_conteo.organization_id,
          v_conteo.deposito_id, -v_aplicado, false);
      END IF;

      UPDATE inventario
      SET stock = v_total_actual + v_aplicado,
          updated_at = NOW()
      WHERE id = v_item.inventario_id;

      v_obs := 'Conteo físico "' || v_conteo.nombre || '"';
      IF v_aplicado <> v_item.diferencia THEN
        v_obs := v_obs || format(
          ' (diferencia contada %s, aplicada %s: el stock no puede quedar negativo)',
          v_item.diferencia, v_aplicado);
      END IF;
      IF v_reservado > v_total_actual + v_aplicado THEN
        v_obs := v_obs || format(' [reservado %s supera el stock %s]',
                                 v_reservado, v_total_actual + v_aplicado);
      END IF;
      IF v_item.observaciones IS NOT NULL THEN
        v_obs := v_obs || ' — ' || v_item.observaciones;
      END IF;

      INSERT INTO movimientos_inventario (
        inventario_id, tipo, cantidad,
        stock_anterior, stock_posterior,
        deposito_id,
        referencia_id, referencia_tipo,
        usuario_id, organization_id, observaciones
      ) VALUES (
        v_item.inventario_id, 'AJUSTE', v_aplicado,
        v_total_actual, v_total_actual + v_aplicado,
        v_dep_efectivo,
        p_conteo_id, 'CONTEO',
        p_user_id, v_conteo.organization_id, v_obs
      );

      v_ajustados := v_ajustados + 1;
    END LOOP;
  END IF;

  UPDATE conteos_inventario
  SET estado = 'FINALIZADO',
      finalizado_por = p_user_id,
      finalizado_at = NOW(),
      items_ajustados = v_ajustados
  WHERE id = p_conteo_id;

  RETURN jsonb_build_object(
    'success', true,
    'conteoId', p_conteo_id,
    'itemsAjustados', v_ajustados,
    'aplicoAjustes', v_conteo.aplicar_ajustes
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION finalizar_conteo(TEXT, TEXT, BOOLEAN) IS
  'v357: aplica (contado - sistema) sobre el stock actual del depósito del conteo (o total si es global) vía incrementar/descontar_stock_deposito; actualiza inventario.stock por el mismo delta y registra AJUSTE con totales del item y depósito efectivo. Mantiene stock = SUM(detalle). ERRCODE: P0002 no encontrado, 22023 estado/pendientes.';

-- ========================================
-- B1. Kits: el detalle por deposito se mueve siempre
-- ========================================
-- ============================================================
-- B1.1 ensamblar_kit_atomic
-- ============================================================
CREATE OR REPLACE FUNCTION ensamblar_kit_atomic(
  p_kit_id                  TEXT,
  p_cantidad_a_ensamblar    INTEGER,
  p_org_id                  TEXT,
  p_user_id                 TEXT,
  p_deposito_id             TEXT DEFAULT NULL,
  p_motivo                  TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_kit                inventario%ROWTYPE;
  v_componentes        JSONB := '[]'::JSONB;
  v_comp_row           RECORD;
  v_dep_row            inventario_depositos%ROWTYPE;
  v_disponible         INTEGER;
  v_consumir           INTEGER;
  v_ref_id             TEXT;
  v_stock_anterior     INTEGER;
  v_stock_posterior    INTEGER;
  v_ids                TEXT[];
  v_id                 TEXT;
  v_strict             BOOLEAN := (p_deposito_id IS NOT NULL);
  v_dep_mov            TEXT;
BEGIN
  IF p_cantidad_a_ensamblar IS NULL OR p_cantidad_a_ensamblar <= 0 THEN
    RAISE EXCEPTION 'Cantidad a ensamblar debe ser > 0'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_kit FROM inventario
    WHERE id = p_kit_id
      AND organization_id = p_org_id
      AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kit no encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF v_kit.es_kit = false THEN
    RAISE EXCEPTION 'El item no es un kit' USING ERRCODE = '22023';
  END IF;

  IF v_kit.tipo_kit <> 'ENSAMBLADO' THEN
    RAISE EXCEPTION 'Solo kits ENSAMBLADO pueden ensamblarse (tipo actual: %)', v_kit.tipo_kit
      USING ERRCODE = '22023';
  END IF;

  IF p_deposito_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM depositos
      WHERE id = p_deposito_id
        AND organization_id = p_org_id
        AND deleted_at IS NULL
        AND activo = true
    ) THEN
      RAISE EXCEPTION 'Depósito inválido o inactivo' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM inventario_kit_items
    WHERE kit_id = p_kit_id AND organization_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'El kit no tiene receta definida' USING ERRCODE = '22023';
  END IF;

  -- Lock pesimista determinista (kit + componentes)
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_ids
  FROM (
    SELECT p_kit_id AS x
    UNION
    SELECT componente_id FROM inventario_kit_items
    WHERE kit_id = p_kit_id AND organization_id = p_org_id
  ) s;

  FOREACH v_id IN ARRAY v_ids LOOP
    PERFORM 1 FROM inventario WHERE id = v_id FOR UPDATE;
  END LOOP;

  -- Re-leer el kit con la fila ya bloqueada (la lectura de arriba es previa
  -- al lock: escribir stock absoluto con ese valor era un lost update).
  SELECT * INTO v_kit FROM inventario WHERE id = p_kit_id;

  FOR v_comp_row IN
    SELECT ki.componente_id, ki.cantidad,
           inv.nombre AS comp_nombre, inv.codigo AS comp_codigo,
           COALESCE(inv.stock, 0) AS comp_stock,
           COALESCE(inv.stock_reservado, 0) AS comp_reservado
    FROM inventario_kit_items ki
    JOIN inventario inv ON inv.id = ki.componente_id
    WHERE ki.kit_id = p_kit_id
      AND ki.organization_id = p_org_id
    ORDER BY ki.orden, ki.componente_id
  LOOP
    v_consumir := v_comp_row.cantidad * p_cantidad_a_ensamblar;
    v_disponible := v_comp_row.comp_stock - v_comp_row.comp_reservado;

    IF v_disponible < v_consumir THEN
      RAISE EXCEPTION 'Stock insuficiente de componente "%": disponible %, requerido %',
        v_comp_row.comp_nombre, v_disponible, v_consumir
        USING ERRCODE = 'P0003';
    END IF;

    IF v_strict THEN
      SELECT * INTO v_dep_row FROM inventario_depositos
        WHERE inventario_id = v_comp_row.componente_id
          AND deposito_id = p_deposito_id
        FOR UPDATE;

      IF NOT FOUND OR (v_dep_row.stock - v_dep_row.stock_reservado) < v_consumir THEN
        RAISE EXCEPTION 'Stock insuficiente de componente "%" en depósito seleccionado',
          v_comp_row.comp_nombre
          USING ERRCODE = 'P0003';
      END IF;
    END IF;

    -- Explícito: estricto (ya validado, la helper no falla).
    -- NULL: drain principal-primero con clamp de reservado (contrato 206).
    v_dep_mov := descontar_stock_deposito(
      v_comp_row.componente_id, p_org_id, p_deposito_id, v_consumir, v_strict);

    v_stock_anterior := v_comp_row.comp_stock;
    v_stock_posterior := v_stock_anterior - v_consumir;

    UPDATE inventario
      SET stock = v_stock_posterior, updated_at = NOW()
      WHERE id = v_comp_row.componente_id;

    INSERT INTO movimientos_inventario (
      inventario_id, tipo, cantidad,
      stock_anterior, stock_posterior,
      deposito_id, referencia_id, referencia_tipo,
      usuario_id, organization_id, observaciones
    ) VALUES (
      v_comp_row.componente_id, 'ENSAMBLAJE_KIT_OUT', v_consumir,
      v_stock_anterior, v_stock_posterior,
      v_dep_mov, p_kit_id, 'ENSAMBLAJE_KIT',
      p_user_id, p_org_id,
      COALESCE(p_motivo, format('Consumido para ensamblar %s x "%s"',
        p_cantidad_a_ensamblar, v_kit.nombre))
    );

    v_componentes := v_componentes || jsonb_build_object(
      'componenteId', v_comp_row.componente_id,
      'nombre', v_comp_row.comp_nombre,
      'codigo', v_comp_row.comp_codigo,
      'cantidadConsumida', v_consumir,
      'stockPosterior', v_stock_posterior
    );
  END LOOP;

  -- Incrementar kit (explícito: ese depósito; NULL: principal)
  v_stock_anterior := COALESCE(v_kit.stock, 0);
  v_stock_posterior := v_stock_anterior + p_cantidad_a_ensamblar;

  UPDATE inventario
    SET stock = v_stock_posterior, updated_at = NOW()
    WHERE id = p_kit_id;

  v_dep_mov := incrementar_stock_deposito(
    p_kit_id, p_org_id, p_deposito_id, p_cantidad_a_ensamblar);

  v_ref_id := generate_cuid();

  INSERT INTO movimientos_inventario (
    inventario_id, tipo, cantidad,
    stock_anterior, stock_posterior,
    deposito_id, referencia_id, referencia_tipo,
    usuario_id, organization_id, observaciones
  ) VALUES (
    p_kit_id, 'ENSAMBLAJE_KIT_IN', p_cantidad_a_ensamblar,
    v_stock_anterior, v_stock_posterior,
    v_dep_mov, v_ref_id, 'ENSAMBLAJE_KIT',
    p_user_id, p_org_id,
    COALESCE(p_motivo, format('Ensamblaje de %s unidades', p_cantidad_a_ensamblar))
  );

  RETURN jsonb_build_object(
    'success', true,
    'kitId', p_kit_id,
    'cantidadEnsamblada', p_cantidad_a_ensamblar,
    'stockAnterior', v_stock_anterior,
    'stockPosterior', v_stock_posterior,
    'componentesConsumidos', v_componentes,
    'referenciaId', v_ref_id
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ensamblar_kit_atomic(TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT) IS
  'v357: ensambla N unidades de un kit ENSAMBLADO. Detalle por depósito SIEMPRE vía helpers 206 (explícito = estricto; NULL = drain principal-primero / kit al principal). Re-lee el kit tras el lock. ERRCODE: P0002 no encontrado/depósito inválido, P0003 stock insuficiente, 22023 args inválidos.';

-- ============================================================
-- B1.2 desensamblar_kit_atomic
-- ============================================================
CREATE OR REPLACE FUNCTION desensamblar_kit_atomic(
  p_kit_id        TEXT,
  p_cantidad      INTEGER,
  p_org_id        TEXT,
  p_user_id       TEXT,
  p_deposito_id   TEXT DEFAULT NULL,
  p_motivo        TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_kit                inventario%ROWTYPE;
  v_componentes        JSONB := '[]'::JSONB;
  v_comp_row           RECORD;
  v_dep_kit_row        inventario_depositos%ROWTYPE;
  v_devolver           INTEGER;
  v_disponible         INTEGER;
  v_ref_id             TEXT;
  v_stock_anterior     INTEGER;
  v_stock_posterior    INTEGER;
  v_ids                TEXT[];
  v_id                 TEXT;
  v_strict             BOOLEAN := (p_deposito_id IS NOT NULL);
  v_dep_kit            TEXT;
  v_dep_mov            TEXT;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'Cantidad a desensamblar debe ser > 0'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_kit FROM inventario
    WHERE id = p_kit_id
      AND organization_id = p_org_id
      AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kit no encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF v_kit.es_kit = false OR v_kit.tipo_kit <> 'ENSAMBLADO' THEN
    RAISE EXCEPTION 'Solo kits ENSAMBLADO pueden desensamblarse'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM inventario_kit_items
    WHERE kit_id = p_kit_id AND organization_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'El kit no tiene receta definida' USING ERRCODE = '22023';
  END IF;

  IF p_deposito_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM depositos
      WHERE id = p_deposito_id
        AND organization_id = p_org_id
        AND deleted_at IS NULL
        AND activo = true
    ) THEN
      RAISE EXCEPTION 'Depósito inválido o inactivo' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_ids
  FROM (
    SELECT p_kit_id AS x
    UNION
    SELECT componente_id FROM inventario_kit_items
    WHERE kit_id = p_kit_id AND organization_id = p_org_id
  ) s;

  FOREACH v_id IN ARRAY v_ids LOOP
    PERFORM 1 FROM inventario WHERE id = v_id FOR UPDATE;
  END LOOP;

  -- Re-leer el kit con la fila bloqueada.
  SELECT * INTO v_kit FROM inventario WHERE id = p_kit_id;

  -- Lo reservado está comprometido (orden/cotización): no se desarma.
  v_disponible := COALESCE(v_kit.stock, 0) - COALESCE(v_kit.stock_reservado, 0);
  IF v_disponible < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente del kit: disponible %, solicitado %',
      v_disponible, p_cantidad
      USING ERRCODE = 'P0003';
  END IF;

  IF v_strict THEN
    SELECT * INTO v_dep_kit_row FROM inventario_depositos
      WHERE inventario_id = p_kit_id AND deposito_id = p_deposito_id
      FOR UPDATE;
    IF NOT FOUND OR (v_dep_kit_row.stock - v_dep_kit_row.stock_reservado) < p_cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente del kit en depósito seleccionado'
        USING ERRCODE = 'P0003';
    END IF;
  END IF;

  v_dep_kit := descontar_stock_deposito(
    p_kit_id, p_org_id, p_deposito_id, p_cantidad, v_strict);

  v_stock_anterior := COALESCE(v_kit.stock, 0);
  v_stock_posterior := v_stock_anterior - p_cantidad;
  UPDATE inventario
    SET stock = v_stock_posterior, updated_at = NOW()
    WHERE id = p_kit_id;

  v_ref_id := generate_cuid();

  INSERT INTO movimientos_inventario (
    inventario_id, tipo, cantidad,
    stock_anterior, stock_posterior,
    deposito_id, referencia_id, referencia_tipo,
    usuario_id, organization_id, observaciones
  ) VALUES (
    p_kit_id, 'ENSAMBLAJE_KIT_OUT', p_cantidad,
    v_stock_anterior, v_stock_posterior,
    v_dep_kit, v_ref_id, 'DESENSAMBLAJE_KIT',
    p_user_id, p_org_id,
    COALESCE(p_motivo, format('Desensamblaje de %s unidades', p_cantidad))
  );

  -- Componentes vuelven al depósito de donde salió el kit.
  FOR v_comp_row IN
    SELECT ki.componente_id, ki.cantidad,
           inv.nombre AS comp_nombre, inv.codigo AS comp_codigo,
           COALESCE(inv.stock, 0) AS comp_stock
    FROM inventario_kit_items ki
    JOIN inventario inv ON inv.id = ki.componente_id
    WHERE ki.kit_id = p_kit_id
      AND ki.organization_id = p_org_id
    ORDER BY ki.orden, ki.componente_id
  LOOP
    v_devolver := v_comp_row.cantidad * p_cantidad;
    v_stock_anterior := v_comp_row.comp_stock;
    v_stock_posterior := v_stock_anterior + v_devolver;

    UPDATE inventario
      SET stock = v_stock_posterior, updated_at = NOW()
      WHERE id = v_comp_row.componente_id;

    v_dep_mov := incrementar_stock_deposito(
      v_comp_row.componente_id, p_org_id, COALESCE(p_deposito_id, v_dep_kit), v_devolver);

    INSERT INTO movimientos_inventario (
      inventario_id, tipo, cantidad,
      stock_anterior, stock_posterior,
      deposito_id, referencia_id, referencia_tipo,
      usuario_id, organization_id, observaciones
    ) VALUES (
      v_comp_row.componente_id, 'ENSAMBLAJE_KIT_IN', v_devolver,
      v_stock_anterior, v_stock_posterior,
      v_dep_mov, p_kit_id, 'DESENSAMBLAJE_KIT',
      p_user_id, p_org_id,
      COALESCE(p_motivo, format('Recuperado de desensamblaje de %s x "%s"',
        p_cantidad, v_kit.nombre))
    );

    v_componentes := v_componentes || jsonb_build_object(
      'componenteId', v_comp_row.componente_id,
      'nombre', v_comp_row.comp_nombre,
      'codigo', v_comp_row.comp_codigo,
      'cantidadDevuelta', v_devolver,
      'stockPosterior', v_stock_posterior
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'kitId', p_kit_id,
    'cantidadDesensamblada', p_cantidad,
    'componentesDevueltos', v_componentes,
    'referenciaId', v_ref_id
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION desensamblar_kit_atomic(TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT) IS
  'v357: desensambla N unidades de un kit. Valida disponible (stock - reservado) global y por depósito; detalle siempre vía helpers 206; componentes vuelven al depósito del que salió el kit. ERRCODE: P0002 no encontrado/depósito inválido, P0003 stock insuficiente, 22023 args inválidos.';

-- ========================================
-- B2. consolidate_inventario_items: mueve el detalle por deposito
-- ========================================
CREATE OR REPLACE FUNCTION consolidate_inventario_items(
  p_source_id TEXT,
  p_target_id TEXT,
  p_user_id TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_source RECORD;
  v_target RECORD;
  v_org_id TEXT;
  v_stock_source INTEGER;
  v_stock_target_before INTEGER;
  v_stock_target_after INTEGER;
  v_suma_detalle INTEGER;
  v_drift INTEGER;
  v_row RECORD;
  v_src_running INTEGER;
  v_tgt_running INTEGER;
BEGIN
  IF p_source_id = p_target_id THEN
    RAISE EXCEPTION 'El item origen y destino no pueden ser el mismo';
  END IF;

  -- Lock de ambas filas en orden estable (evita deadlock en consolidaciones simétricas).
  IF p_source_id < p_target_id THEN
    SELECT * INTO v_source FROM inventario WHERE id = p_source_id FOR UPDATE;
    SELECT * INTO v_target FROM inventario WHERE id = p_target_id FOR UPDATE;
  ELSE
    SELECT * INTO v_target FROM inventario WHERE id = p_target_id FOR UPDATE;
    SELECT * INTO v_source FROM inventario WHERE id = p_source_id FOR UPDATE;
  END IF;

  IF v_source IS NULL THEN
    RAISE EXCEPTION 'Item origen no encontrado';
  END IF;
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'Item destino no encontrado';
  END IF;

  IF v_source.organization_id <> v_target.organization_id THEN
    RAISE EXCEPTION 'Los items pertenecen a organizaciones distintas';
  END IF;

  IF v_source.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'El item origen ya está archivado';
  END IF;
  IF v_target.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'El item destino está archivado';
  END IF;

  IF COALESCE(v_source.stock_reservado, 0) > 0 THEN
    RAISE EXCEPTION 'El item origen tiene stock reservado (%), liberá las reservas antes de consolidar', v_source.stock_reservado;
  END IF;

  v_org_id := v_source.organization_id;
  v_stock_source := COALESCE(v_source.stock, 0);
  v_stock_target_before := COALESCE(v_target.stock, 0);
  v_stock_target_after := v_stock_target_before + v_stock_source;

  -- Pre-lock del detalle de ambos items (orden determinista).
  PERFORM 1 FROM inventario_depositos
  WHERE inventario_id IN (p_source_id, p_target_id)
  ORDER BY inventario_id, deposito_id
  FOR UPDATE;

  -- 1. Normalizar el detalle del origen a su total (drift histórico), para que
  --    lo que se mueve por depósito sume exactamente v_stock_source.
  SELECT COALESCE(SUM(stock), 0) INTO v_suma_detalle
  FROM inventario_depositos WHERE inventario_id = p_source_id;
  v_drift := v_stock_source - v_suma_detalle;
  IF v_drift > 0 THEN
    PERFORM incrementar_stock_deposito(p_source_id, v_org_id, NULL, v_drift);
  ELSIF v_drift < 0 THEN
    PERFORM descontar_stock_deposito(p_source_id, v_org_id, NULL, -v_drift, false);
  END IF;
  IF v_drift <> 0 THEN
    RAISE WARNING 'consolidate_inventario_items: origen % con drift % normalizado antes de mover', p_source_id, v_drift;
  END IF;

  -- 2. Archivar el origen ANTES de registrar su SALIDA (el trigger de stock
  --    bajo ignora items archivados) y fijar los totales.
  UPDATE inventario
     SET stock = 0,
         deleted_at = NOW(),
         deleted_by = p_user_id,
         updated_at = NOW()
   WHERE id = p_source_id;

  IF v_stock_source > 0 THEN
    UPDATE inventario
       SET stock = v_stock_target_after,
           updated_at = NOW()
     WHERE id = p_target_id;
  END IF;

  -- 3. Mover cada fila del origen al mismo depósito del destino, con un par
  --    de movimientos por depósito y totales acumulados.
  v_src_running := v_stock_source;
  v_tgt_running := v_stock_target_before;

  FOR v_row IN
    SELECT deposito_id, stock
    FROM inventario_depositos
    WHERE inventario_id = p_source_id AND stock > 0
    ORDER BY deposito_id
  LOOP
    PERFORM incrementar_stock_deposito(p_target_id, v_org_id, v_row.deposito_id, v_row.stock);

    INSERT INTO movimientos_inventario (
      inventario_id, tipo, cantidad,
      stock_anterior, stock_posterior,
      deposito_id, referencia_id, referencia_tipo,
      usuario_id, organization_id, observaciones
    ) VALUES (
      p_source_id, 'SALIDA', v_row.stock,
      v_src_running, v_src_running - v_row.stock,
      v_row.deposito_id, p_target_id, 'CONSOLIDACION',
      p_user_id, v_org_id,
      'Consolidación: stock movido a ' || v_target.codigo
    );

    INSERT INTO movimientos_inventario (
      inventario_id, tipo, cantidad,
      stock_anterior, stock_posterior,
      deposito_id, referencia_id, referencia_tipo,
      usuario_id, organization_id, observaciones
    ) VALUES (
      p_target_id, 'ENTRADA', v_row.stock,
      v_tgt_running, v_tgt_running + v_row.stock,
      v_row.deposito_id, p_source_id, 'CONSOLIDACION',
      p_user_id, v_org_id,
      'Consolidación: stock recibido desde ' || v_source.codigo
    );

    v_src_running := v_src_running - v_row.stock;
    v_tgt_running := v_tgt_running + v_row.stock;
  END LOOP;

  -- 4. El origen archivado queda sin detalle (0 = SUM(vacío)).
  DELETE FROM inventario_depositos WHERE inventario_id = p_source_id;

  RETURN jsonb_build_object(
    'success', true,
    'sourceId', p_source_id,
    'targetId', p_target_id,
    'movedStock', v_stock_source,
    'targetStockAfter', v_stock_target_after
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION consolidate_inventario_items(TEXT, TEXT, TEXT) IS
  'v357: consolida un item duplicado: normaliza el detalle del origen, mueve cada fila de inventario_depositos al mismo depósito del destino (un par SALIDA/ENTRADA CONSOLIDACION por depósito), archiva el origen y borra su detalle. Mantiene stock = SUM(detalle) en ambos.';

-- ========================================
-- F. Lotes y series: principal determinista y referencias validadas
-- ========================================
-- ============================================================
-- F.1 registrar_entrada_lote
-- ============================================================
CREATE OR REPLACE FUNCTION registrar_entrada_lote(
  p_organization_id   TEXT,
  p_user_id           TEXT,
  p_inventario_id     TEXT,
  p_numero_lote       TEXT,
  p_cantidad          INTEGER,
  p_costo_unitario    NUMERIC DEFAULT NULL,
  p_fecha_vencimiento DATE    DEFAULT NULL,
  p_proveedor_id      TEXT    DEFAULT NULL,
  p_orden_compra_id   TEXT    DEFAULT NULL,
  p_deposito_id       TEXT    DEFAULT NULL,
  p_notas             TEXT    DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_inv             inventario%ROWTYPE;
  v_lote            inventario_lotes%ROWTYPE;
  v_lote_id         TEXT;
  v_stock_anterior  INTEGER;
  v_stock_posterior INTEGER;
  v_mov_id          TEXT;
  v_dep_id          TEXT;
  v_numero_lote     TEXT;
BEGIN
  v_numero_lote := NULLIF(BTRIM(p_numero_lote), '');

  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'Cantidad debe ser > 0' USING ERRCODE = '22023';
  END IF;

  IF v_numero_lote IS NULL THEN
    RAISE EXCEPTION 'numero_lote requerido' USING ERRCODE = '22023';
  END IF;

  -- Referencias de la misma organización (el FK solo valida existencia)
  IF p_proveedor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM proveedores
    WHERE id = p_proveedor_id AND organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'Proveedor inválido' USING ERRCODE = 'P0002';
  END IF;

  IF p_orden_compra_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM ordenes_compra
    WHERE id = p_orden_compra_id AND organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'Orden de compra inválida' USING ERRCODE = 'P0002';
  END IF;

  IF p_deposito_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM depositos
    WHERE id = p_deposito_id AND organization_id = p_organization_id
      AND deleted_at IS NULL AND activo = true
  ) THEN
    RAISE EXCEPTION 'Depósito inválido o inactivo' USING ERRCODE = 'P0002';
  END IF;

  -- Lock item
  SELECT * INTO v_inv FROM inventario
    WHERE id = p_inventario_id
      AND organization_id = p_organization_id
      AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item no encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF NOT COALESCE(v_inv.trackea_lotes, false) THEN
    RAISE EXCEPTION 'El item no tiene tracking de lotes habilitado' USING ERRCODE = '22023';
  END IF;

  -- Depósito: explícito o principal determinista (mig 221).
  v_dep_id := COALESCE(p_deposito_id, get_deposito_principal(p_organization_id));

  -- Upsert lote
  SELECT * INTO v_lote FROM inventario_lotes
    WHERE inventario_id = p_inventario_id
      AND numero_lote = v_numero_lote
    FOR UPDATE;

  IF FOUND THEN
    UPDATE inventario_lotes
      SET cantidad_inicial   = cantidad_inicial + p_cantidad,
          cantidad_actual    = cantidad_actual + p_cantidad,
          estado             = CASE WHEN estado = 'AGOTADO' THEN 'ACTIVO' ELSE estado END,
          fecha_vencimiento  = COALESCE(fecha_vencimiento, p_fecha_vencimiento),
          costo_unitario     = COALESCE(costo_unitario, p_costo_unitario),
          proveedor_id       = COALESCE(proveedor_id, p_proveedor_id),
          orden_compra_id    = COALESCE(orden_compra_id, p_orden_compra_id),
          deposito_id        = COALESCE(deposito_id, v_dep_id),
          notas              = COALESCE(NULLIF(BTRIM(p_notas), ''), notas),
          updated_at         = NOW()
      WHERE id = v_lote.id
      RETURNING id INTO v_lote_id;
  ELSE
    INSERT INTO inventario_lotes (
      inventario_id, numero_lote, cantidad_inicial, cantidad_actual,
      costo_unitario, fecha_vencimiento, proveedor_id, orden_compra_id,
      deposito_id, notas, organization_id
    ) VALUES (
      p_inventario_id, v_numero_lote, p_cantidad, p_cantidad,
      p_costo_unitario, p_fecha_vencimiento, p_proveedor_id, p_orden_compra_id,
      v_dep_id, NULLIF(BTRIM(p_notas), ''), p_organization_id
    )
    RETURNING id INTO v_lote_id;
  END IF;

  -- Total + detalle (la helper falla con P0011 si la org no tiene principal)
  v_stock_anterior := COALESCE(v_inv.stock, 0);
  v_stock_posterior := v_stock_anterior + p_cantidad;

  UPDATE inventario
    SET stock = v_stock_posterior,
        updated_at = NOW()
    WHERE id = p_inventario_id;

  v_dep_id := incrementar_stock_deposito(
    p_inventario_id, p_organization_id, v_dep_id, p_cantidad);

  INSERT INTO movimientos_inventario (
    inventario_id, tipo, cantidad,
    stock_anterior, stock_posterior,
    deposito_id, referencia_id, referencia_tipo,
    lote_id, usuario_id, organization_id, observaciones
  ) VALUES (
    p_inventario_id, 'ENTRADA', p_cantidad,
    v_stock_anterior, v_stock_posterior,
    v_dep_id, p_orden_compra_id,
    CASE WHEN p_orden_compra_id IS NOT NULL THEN 'ORDEN_COMPRA' ELSE 'ENTRADA_LOTE' END,
    v_lote_id, p_user_id, p_organization_id,
    COALESCE(NULLIF(BTRIM(p_notas), ''), format('Entrada lote %s', v_numero_lote))
  )
  RETURNING id INTO v_mov_id;

  RETURN jsonb_build_object(
    'success', true,
    'loteId', v_lote_id,
    'movimientoId', v_mov_id,
    'stockPosterior', v_stock_posterior,
    'numeroLote', v_numero_lote
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION registrar_entrada_lote(TEXT, TEXT, TEXT, TEXT, INTEGER, NUMERIC, DATE, TEXT, TEXT, TEXT, TEXT) IS
  'v357: entrada con lote (upsert por inventario_id+numero_lote). Depósito = explícito o get_deposito_principal(org); detalle vía incrementar_stock_deposito. Valida proveedor/OC/depósito contra la org (P0002). Requiere trackea_lotes.';

-- ============================================================
-- F.2 registrar_entrada_series
-- ============================================================
CREATE OR REPLACE FUNCTION registrar_entrada_series(
  p_organization_id TEXT,
  p_user_id         TEXT,
  p_inventario_id   TEXT,
  p_numeros_serie   TEXT[],
  p_lote_id         TEXT DEFAULT NULL,
  p_costo_unitario  NUMERIC DEFAULT NULL,
  p_deposito_id     TEXT DEFAULT NULL,
  p_garantia_dias   INTEGER DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_inv             inventario%ROWTYPE;
  v_normalizados    TEXT[];
  v_existentes      TEXT[];
  v_count           INTEGER;
  v_serie_ids       TEXT[] := ARRAY[]::TEXT[];
  v_stock_anterior  INTEGER;
  v_stock_posterior INTEGER;
  v_mov_id          TEXT;
  v_dep_id          TEXT;
  v_garantia_vence  DATE;
  v_new_id          TEXT;
  v_serie           TEXT;
BEGIN
  IF p_numeros_serie IS NULL OR array_length(p_numeros_serie, 1) IS NULL THEN
    RAISE EXCEPTION 'Lista de series vacía' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(DISTINCT s ORDER BY s)
    INTO v_normalizados
    FROM unnest(p_numeros_serie) AS s
    WHERE NULLIF(BTRIM(s), '') IS NOT NULL;

  IF v_normalizados IS NULL OR array_length(v_normalizados, 1) IS NULL THEN
    RAISE EXCEPTION 'Todas las series están vacías' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(DISTINCT BTRIM(s))
    INTO v_normalizados
    FROM unnest(v_normalizados) AS s
    WHERE BTRIM(s) <> '';

  v_count := array_length(v_normalizados, 1);

  IF p_deposito_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM depositos
    WHERE id = p_deposito_id AND organization_id = p_organization_id
      AND deleted_at IS NULL AND activo = true
  ) THEN
    RAISE EXCEPTION 'Depósito inválido o inactivo' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_inv FROM inventario
    WHERE id = p_inventario_id
      AND organization_id = p_organization_id
      AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item no encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF NOT COALESCE(v_inv.trackea_series, false) THEN
    RAISE EXCEPTION 'El item no tiene tracking de series habilitado' USING ERRCODE = '22023';
  END IF;

  IF p_lote_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM inventario_lotes
      WHERE id = p_lote_id
        AND inventario_id = p_inventario_id
        AND organization_id = p_organization_id
    ) THEN
      RAISE EXCEPTION 'Lote inválido para este item' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  SELECT array_agg(numero_serie ORDER BY numero_serie)
    INTO v_existentes
    FROM inventario_series
    WHERE inventario_id = p_inventario_id
      AND numero_serie = ANY (v_normalizados);

  IF v_existentes IS NOT NULL AND array_length(v_existentes, 1) > 0 THEN
    RAISE EXCEPTION 'Series duplicadas (ya existen): %', array_to_string(v_existentes, ', ')
      USING ERRCODE = '22023';
  END IF;

  -- Depósito: explícito o principal determinista (mig 221).
  v_dep_id := COALESCE(p_deposito_id, get_deposito_principal(p_organization_id));

  IF p_garantia_dias IS NOT NULL AND p_garantia_dias > 0 THEN
    v_garantia_vence := CURRENT_DATE + (p_garantia_dias || ' days')::INTERVAL;
  END IF;

  FOREACH v_serie IN ARRAY v_normalizados LOOP
    INSERT INTO inventario_series (
      inventario_id, numero_serie, lote_id, estado,
      fecha_garantia_vence, deposito_id, costo_unitario, organization_id
    ) VALUES (
      p_inventario_id, v_serie, p_lote_id, 'DISPONIBLE',
      v_garantia_vence, v_dep_id, p_costo_unitario, p_organization_id
    )
    RETURNING id INTO v_new_id;
    v_serie_ids := array_append(v_serie_ids, v_new_id);
  END LOOP;

  v_stock_anterior := COALESCE(v_inv.stock, 0);
  v_stock_posterior := v_stock_anterior + v_count;

  UPDATE inventario
    SET stock = v_stock_posterior,
        updated_at = NOW()
    WHERE id = p_inventario_id;

  v_dep_id := incrementar_stock_deposito(
    p_inventario_id, p_organization_id, v_dep_id, v_count);

  INSERT INTO movimientos_inventario (
    inventario_id, tipo, cantidad,
    stock_anterior, stock_posterior,
    deposito_id, referencia_tipo,
    lote_id, serie_ids, usuario_id, organization_id, observaciones
  ) VALUES (
    p_inventario_id, 'ENTRADA', v_count,
    v_stock_anterior, v_stock_posterior,
    v_dep_id, 'ENTRADA_SERIES',
    p_lote_id, v_serie_ids, p_user_id, p_organization_id,
    format('Entrada de %s serie(s)', v_count)
  )
  RETURNING id INTO v_mov_id;

  RETURN jsonb_build_object(
    'success', true,
    'cantidad', v_count,
    'serieIds', v_serie_ids,
    'movimientoId', v_mov_id,
    'stockPosterior', v_stock_posterior
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION registrar_entrada_series(TEXT, TEXT, TEXT, TEXT[], TEXT, NUMERIC, TEXT, INTEGER) IS
  'v357: ingresa N series. Depósito = explícito (validado contra la org) o get_deposito_principal(org); detalle vía incrementar_stock_deposito. Rechaza series duplicadas.';

-- ========================================
-- G. seed_deposito_inicial: registra el alta en el kardex
-- ========================================
CREATE OR REPLACE FUNCTION seed_deposito_inicial()
RETURNS TRIGGER AS $$
DECLARE
  v_principal TEXT;
BEGIN
  IF NEW.stock IS NULL OR NEW.stock <= 0 THEN
    RETURN NEW;
  END IF;

  v_principal := get_deposito_principal(NEW.organization_id);

  -- Detalle: solo si la org tiene principal (sin principal no hay detalle).
  IF v_principal IS NOT NULL THEN
    INSERT INTO inventario_depositos (inventario_id, deposito_id, stock, stock_reservado, organization_id)
    VALUES (NEW.id, v_principal, NEW.stock, 0, NEW.organization_id)
    ON CONFLICT (inventario_id, deposito_id) DO NOTHING;
  END IF;

  -- Kardex: el alta es la primera ENTRADA del item (0 -> stock). Si la API
  -- mueve el stock inicial a otro depósito (POST /api/inventario), re-apunta
  -- este movimiento (referencia_tipo = 'STOCK_INICIAL') al mismo depósito.
  INSERT INTO movimientos_inventario (
    inventario_id, tipo, cantidad,
    stock_anterior, stock_posterior,
    deposito_id, referencia_id, referencia_tipo,
    usuario_id, organization_id, observaciones
  ) VALUES (
    NEW.id, 'ENTRADA', NEW.stock,
    0, NEW.stock,
    v_principal, NEW.id, 'STOCK_INICIAL',
    NULL, NEW.organization_id,
    'Stock inicial al crear el item'
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS inventario_seed_deposito ON inventario;
CREATE TRIGGER inventario_seed_deposito
  AFTER INSERT ON inventario
  FOR EACH ROW
  EXECUTE FUNCTION seed_deposito_inicial();

COMMENT ON FUNCTION seed_deposito_inicial() IS
  'v357: al crear un item con stock > 0 siembra inventario_depositos (principal) y registra la ENTRADA STOCK_INICIAL (0 -> stock). Mantiene la invariante y el kardex desde el primer movimiento.';

-- ========================================
-- H. Variantes: el delta del total acompana al detalle
-- ========================================
-- ============================================================
-- H.1 sync_inventario_total_variantes: el delta del padre también va al detalle
-- ============================================================
CREATE OR REPLACE FUNCTION sync_inventario_total_variantes()
RETURNS TRIGGER AS $$
DECLARE
  v_inv_id     TEXT;
  v_org_id     TEXT;
  v_stock      INTEGER;
  v_reservado  INTEGER;
  v_has_var    BOOLEAN;
  v_stock_prev INTEGER;
  v_delta      INTEGER;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_inv_id := COALESCE(NEW.inventario_id, OLD.inventario_id);

  SELECT tiene_variantes, COALESCE(stock, 0), organization_id
    INTO v_has_var, v_stock_prev, v_org_id
  FROM inventario
  WHERE id = v_inv_id
  FOR UPDATE;

  IF NOT FOUND OR v_has_var IS NOT TRUE THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT
    COALESCE(SUM(stock), 0),
    COALESCE(SUM(stock_reservado), 0)
  INTO v_stock, v_reservado
  FROM inventario_variantes
  WHERE inventario_id = v_inv_id
    AND deleted_at IS NULL;

  UPDATE inventario
     SET stock = v_stock,
         stock_reservado = v_reservado,
         updated_at = NOW()
   WHERE id = v_inv_id;

  -- Invariante: el detalle por depósito acompaña el cambio del total.
  -- Las variantes no tienen depósito: suben al principal, bajan drain
  -- principal-primero (contrato 206 para NULL).
  v_delta := v_stock - v_stock_prev;
  IF v_delta <> 0 AND get_deposito_principal(v_org_id) IS NOT NULL THEN
    IF v_delta > 0 THEN
      PERFORM incrementar_stock_deposito(v_inv_id, v_org_id, NULL, v_delta);
    ELSE
      PERFORM descontar_stock_deposito(v_inv_id, v_org_id, NULL, -v_delta, false);
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
-- El trigger inventario_variantes_sync_total (176:155-158) ya apunta a esta función: no se recrea.

COMMENT ON FUNCTION sync_inventario_total_variantes() IS
  'v357: recalcula stock/stock_reservado del padre como suma de variantes y aplica el delta del total a inventario_depositos (principal / drain principal-primero). Mantiene stock = SUM(detalle).';

-- ============================================================
-- H.2 crear_variantes_bulk: kardex con totales del item
-- ============================================================
CREATE OR REPLACE FUNCTION crear_variantes_bulk(
  p_inv_id      TEXT,
  p_org         TEXT,
  p_user        TEXT,
  p_variantes   JSONB
) RETURNS JSONB AS $$
DECLARE
  v_var           JSONB;
  v_codigo        TEXT;
  v_codigos       TEXT[] := ARRAY[]::TEXT[];
  v_dup_codes     TEXT[];
  v_ids           TEXT[] := ARRAY[]::TEXT[];
  v_new_id        TEXT;
  v_count         INTEGER := 0;
  v_was_variant   BOOLEAN;
  v_prev_stock    INTEGER;
  v_prev_reserv   INTEGER;
  v_stock_antes   INTEGER;
  v_stock_despues INTEGER;
  v_mov_cant      INTEGER;
  v_principal     TEXT;
BEGIN
  IF jsonb_typeof(p_variantes) <> 'array' THEN
    RAISE EXCEPTION 'p_variantes debe ser un array JSONB'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_variantes) = 0 THEN
    RAISE EXCEPTION 'p_variantes vacío'
      USING ERRCODE = '22023';
  END IF;

  -- Lock parent
  SELECT tiene_variantes, stock, stock_reservado
    INTO v_was_variant, v_prev_stock, v_prev_reserv
  FROM inventario
  WHERE id = p_inv_id
    AND organization_id = p_org
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item de inventario no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  FOR v_var IN SELECT * FROM jsonb_array_elements(p_variantes)
  LOOP
    v_codigo := trim(COALESCE(v_var->>'codigo_variante', ''));
    IF v_codigo = '' THEN
      RAISE EXCEPTION 'Cada variante requiere codigo_variante'
        USING ERRCODE = '22023';
    END IF;
    IF v_codigo = ANY(v_codigos) THEN
      RAISE EXCEPTION 'Código de variante duplicado en el lote: %', v_codigo
        USING ERRCODE = '23505';
    END IF;
    v_codigos := array_append(v_codigos, v_codigo);
  END LOOP;

  SELECT array_agg(codigo_variante)
    INTO v_dup_codes
  FROM inventario_variantes
  WHERE inventario_id = p_inv_id
    AND deleted_at IS NULL
    AND codigo_variante = ANY(v_codigos);

  IF v_dup_codes IS NOT NULL AND array_length(v_dup_codes, 1) > 0 THEN
    RAISE EXCEPTION 'Códigos de variante ya existen: %', array_to_string(v_dup_codes, ', ')
      USING ERRCODE = '23505';
  END IF;

  IF v_was_variant IS NOT TRUE THEN
    UPDATE inventario
       SET tiene_variantes = true,
           updated_at = NOW()
     WHERE id = p_inv_id;
  END IF;

  v_principal := get_deposito_principal(p_org);
  v_stock_antes := COALESCE(v_prev_stock, 0);

  FOR v_var IN SELECT * FROM jsonb_array_elements(p_variantes)
  LOOP
    INSERT INTO inventario_variantes (
      inventario_id, organization_id,
      nombre, codigo_variante, atributos, barcode,
      stock, stock_reservado,
      precio_compra, precio_venta,
      imagen_url, imagen_path,
      activo, orden
    ) VALUES (
      p_inv_id, p_org,
      v_var->>'nombre',
      v_var->>'codigo_variante',
      COALESCE(v_var->'atributos', '{}'::jsonb),
      NULLIF(trim(COALESCE(v_var->>'barcode', '')), ''),
      COALESCE((v_var->>'stock')::INTEGER, 0),
      COALESCE((v_var->>'stock_reservado')::INTEGER, 0),
      CASE WHEN v_var ? 'precio_compra' AND v_var->>'precio_compra' IS NOT NULL
           THEN (v_var->>'precio_compra')::NUMERIC ELSE NULL END,
      CASE WHEN v_var ? 'precio_venta' AND v_var->>'precio_venta' IS NOT NULL
           THEN (v_var->>'precio_venta')::NUMERIC ELSE NULL END,
      NULLIF(v_var->>'imagen_url', ''),
      NULLIF(v_var->>'imagen_path', ''),
      COALESCE((v_var->>'activo')::BOOLEAN, true),
      COALESCE((v_var->>'orden')::INTEGER, v_count)
    )
    RETURNING id INTO v_new_id;

    v_ids := array_append(v_ids, v_new_id);
    v_count := v_count + 1;

    -- El trigger de sync ya dejó el total del padre (y el detalle): el
    -- movimiento registra el cambio observado del total, así el kardex
    -- encadena (incluye el paso de stock legacy a suma de variantes).
    SELECT COALESCE(stock, 0) INTO v_stock_despues FROM inventario WHERE id = p_inv_id;
    v_mov_cant := v_stock_despues - v_stock_antes;

    IF v_mov_cant <> 0 THEN
      INSERT INTO movimientos_inventario (
        inventario_id, tipo, cantidad,
        stock_anterior, stock_posterior,
        deposito_id, referencia_id, referencia_tipo,
        usuario_id, organization_id, observaciones
      ) VALUES (
        p_inv_id,
        CASE WHEN v_mov_cant > 0 THEN 'ENTRADA' ELSE 'AJUSTE' END,
        v_mov_cant,
        v_stock_antes, v_stock_despues,
        v_principal, v_new_id, 'VARIANTE',
        p_user, p_org,
        format('Alta de variante "%s" (stock %s)', v_var->>'nombre',
               COALESCE((v_var->>'stock')::INTEGER, 0))
      );
    END IF;

    v_stock_antes := v_stock_despues;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'ids', to_jsonb(v_ids),
    'count', v_count
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION crear_variantes_bulk(TEXT, TEXT, TEXT, JSONB) IS
  'v357: crea variantes en lote y activa tiene_variantes. El detalle lo mueve el trigger de sync; el kardex registra el cambio del total del item por variante. ERRCODE: P0002 item no encontrado, 23505 codigo duplicado, 22023 payload inválido.';

-- ============================================================
-- H.3 ajustar_stock_variante_atomic: lock variante->padre, kardex con totales
-- ============================================================
CREATE OR REPLACE FUNCTION ajustar_stock_variante_atomic(
  p_variante_id  TEXT,
  p_org          TEXT,
  p_user         TEXT,
  p_mode         TEXT,
  p_value        INTEGER,
  p_motivo       TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_inv_id           TEXT;
  v_stock_anterior   INTEGER;
  v_reservado        INTEGER;
  v_stock_posterior  INTEGER;
  v_mov_id           TEXT;
  v_item_antes       INTEGER;
  v_item_despues     INTEGER;
BEGIN
  IF p_mode NOT IN ('absolute', 'delta') THEN
    RAISE EXCEPTION 'Modo inválido: %', p_mode
      USING ERRCODE = '22023';
  END IF;

  -- Orden de locks: variante primero, padre despues. Es el mismo orden de la
  -- produccion actual y de la ruta PATCH/DELETE de la variante (un UPDATE sobre la
  -- variante que bloquea al padre desde el trigger de sync), asi dos operaciones
  -- concurrentes sobre la misma variante no se cruzan. Leer la variante bajo lock
  -- antes de tomar el padre es correcto: nadie mas puede cambiarla en el medio.
  SELECT inventario_id, stock, stock_reservado
    INTO v_inv_id, v_stock_anterior, v_reservado
  FROM inventario_variantes
  WHERE id = p_variante_id
    AND organization_id = p_org
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Variante no encontrada'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(stock, 0) INTO v_item_antes
  FROM inventario WHERE id = v_inv_id
  FOR UPDATE;

  IF p_mode = 'absolute' THEN
    v_stock_posterior := p_value;
  ELSE
    v_stock_posterior := v_stock_anterior + p_value;
  END IF;

  IF v_stock_posterior < 0 THEN
    RAISE EXCEPTION 'El stock no puede quedar negativo'
      USING ERRCODE = 'P0003';
  END IF;

  IF v_stock_posterior < v_reservado THEN
    RAISE EXCEPTION 'El stock resultante (%) es menor al reservado (%)', v_stock_posterior, v_reservado
      USING ERRCODE = 'P0003';
  END IF;

  IF v_stock_posterior = v_stock_anterior THEN
    RETURN jsonb_build_object(
      'stock', v_stock_anterior,
      'changed', false,
      'stockAnterior', v_stock_anterior,
      'stockPosterior', v_stock_anterior,
      'movimientoId', NULL
    );
  END IF;

  -- El trigger de sync recalcula el padre y mueve el detalle por depósito.
  UPDATE inventario_variantes
     SET stock = v_stock_posterior,
         updated_at = NOW()
   WHERE id = p_variante_id;

  SELECT COALESCE(stock, 0) INTO v_item_despues FROM inventario WHERE id = v_inv_id;

  INSERT INTO movimientos_inventario (
    inventario_id, tipo, cantidad,
    stock_anterior, stock_posterior,
    deposito_id, referencia_id, referencia_tipo,
    usuario_id, organization_id, observaciones
  ) VALUES (
    v_inv_id, 'AJUSTE', v_item_despues - v_item_antes,
    v_item_antes, v_item_despues,
    get_deposito_principal(p_org), p_variante_id, 'VARIANTE',
    p_user, p_org,
    COALESCE(p_motivo, 'Ajuste manual de variante')
      || format(' (variante: %s -> %s)', v_stock_anterior, v_stock_posterior)
  )
  RETURNING id INTO v_mov_id;

  RETURN jsonb_build_object(
    'stock', v_stock_posterior,
    'changed', true,
    'stockAnterior', v_stock_anterior,
    'stockPosterior', v_stock_posterior,
    'movimientoId', v_mov_id
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ajustar_stock_variante_atomic(TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT) IS
  'v357: ajuste atómico de stock por variante (lock variante -> padre). El trigger de sync mantiene padre y detalle; el movimiento registra totales del item. Retorno con valores de la variante. ERRCODE: P0002 no encontrada, P0003 stock inválido, 22023 modo inválido.';

-- ============================================================
-- H.4 eliminar_variantes_y_consolidar: el delta del total va al detalle
-- ============================================================
CREATE OR REPLACE FUNCTION eliminar_variantes_y_consolidar(
  p_inv_id   TEXT,
  p_org      TEXT,
  p_user     TEXT
) RETURNS JSONB AS $$
DECLARE
  v_total_stock     INTEGER := 0;
  v_total_reserv    INTEGER := 0;
  v_count           INTEGER;
  v_stock_anterior  INTEGER;
  v_stock_posterior INTEGER;
  v_delta           INTEGER;
  v_dep_efectivo    TEXT;
BEGIN
  SELECT COALESCE(stock, 0) INTO v_stock_anterior
  FROM inventario
  WHERE id = p_inv_id
    AND organization_id = p_org
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT
    COALESCE(SUM(stock), 0),
    COALESCE(SUM(stock_reservado), 0),
    COUNT(*)
  INTO v_total_stock, v_total_reserv, v_count
  FROM inventario_variantes
  WHERE inventario_id = p_inv_id
    AND deleted_at IS NULL;

  -- Desactivar flag PRIMERO para que el trigger no recalcule sobre filas borradas
  UPDATE inventario
     SET tiene_variantes = false,
         stock = v_total_stock,
         stock_reservado = v_total_reserv,
         updated_at = NOW()
   WHERE id = p_inv_id;

  v_stock_posterior := v_total_stock;
  v_delta := v_stock_posterior - v_stock_anterior;
  v_dep_efectivo := get_deposito_principal(p_org);

  IF v_delta <> 0 AND v_dep_efectivo IS NOT NULL THEN
    IF v_delta > 0 THEN
      v_dep_efectivo := incrementar_stock_deposito(p_inv_id, p_org, NULL, v_delta);
    ELSE
      v_dep_efectivo := descontar_stock_deposito(p_inv_id, p_org, NULL, -v_delta, false);
    END IF;
  END IF;

  UPDATE inventario_variantes
     SET deleted_at = NOW(),
         activo = false,
         updated_at = NOW()
   WHERE inventario_id = p_inv_id
     AND deleted_at IS NULL;

  IF v_delta <> 0 THEN
    INSERT INTO movimientos_inventario (
      inventario_id, tipo, cantidad,
      stock_anterior, stock_posterior,
      deposito_id, referencia_id, referencia_tipo,
      usuario_id, organization_id, observaciones
    ) VALUES (
      p_inv_id, 'AJUSTE', v_delta,
      v_stock_anterior, v_stock_posterior,
      v_dep_efectivo, p_inv_id, 'CONSOLIDACION_VARIANTES',
      p_user, p_org,
      format('Consolidación de %s variantes en stock del item', v_count)
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'variantesEliminadas', v_count,
    'stockConsolidado', v_total_stock,
    'reservadoConsolidado', v_total_reserv
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION eliminar_variantes_y_consolidar(TEXT, TEXT, TEXT) IS
  'v357: consolida variantes en el stock del padre (aplicando el delta también a inventario_depositos) y las soft-deletea. ERRCODE: P0002 item no encontrado.';

-- ========================================
-- Permisos de la funcion nueva
-- ========================================
-- Misma politica que la 358: solo service_role ejecuta. El trigger dispara igual
-- para quien escribe conteos_items (el privilegio EXECUTE no se evalua al disparar).
REVOKE EXECUTE ON FUNCTION conteo_item_refrescar_sistema() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION conteo_item_refrescar_sistema() FROM anon;
REVOKE EXECUTE ON FUNCTION conteo_item_refrescar_sistema() FROM authenticated;
GRANT EXECUTE ON FUNCTION conteo_item_refrescar_sistema() TO service_role;
