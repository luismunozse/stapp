-- ========================================
-- Rollback de la migracion 357
-- ========================================
-- Restaura los cuerpos originales de las funciones que la 357 reemplaza, copiados
-- tal cual de las migraciones de origen (170, 177, 123, 175, 176, 291) -- en
-- produccion eran identicos a los del repo al 2026-10-13 -- y elimina el trigger
-- y la funcion que la 357 agrega. No toca datos.
--
-- Nota: los movimientos STOCK_INICIAL, CONTEO, VARIANTE, etc. ya escritos por la
-- 357 quedan en el kardex (son filas validas); solo deja de generarse el alta.
-- Tampoco empieza con BEGIN: db-run.mjs lo rechaza en --apply.
-- ========================================

-- Nuevo en la 357
DROP TRIGGER IF EXISTS conteos_items_refrescar_sistema ON conteos_items;
DROP FUNCTION IF EXISTS conteo_item_refrescar_sistema();

-- finalizar_conteo (origen: 170_conteos_inventario.sql)
CREATE OR REPLACE FUNCTION finalizar_conteo(
  p_conteo_id TEXT,
  p_user_id   TEXT,
  p_forzar    BOOLEAN DEFAULT false  -- true = permite finalizar con items sin contar
) RETURNS JSONB AS $$
DECLARE
  v_conteo RECORD;
  v_pendientes INTEGER;
  v_item RECORD;
  v_stock_actual INTEGER;
  v_ajustados INTEGER := 0;
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
    LOOP
      -- Lock + re-read stock actual (puede haber cambiado desde el snapshot).
      -- El ajuste lleva el stock al valor contado, no al delta del snapshot.
      SELECT stock INTO v_stock_actual
      FROM inventario
      WHERE id = v_item.inventario_id
      FOR UPDATE;

      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      UPDATE inventario
      SET stock = v_item.stock_contado
      WHERE id = v_item.inventario_id;

      INSERT INTO movimientos_inventario (
        inventario_id, tipo, cantidad,
        stock_anterior, stock_posterior,
        deposito_id,
        referencia_id, referencia_tipo,
        usuario_id, organization_id, observaciones
      ) VALUES (
        v_item.inventario_id, 'AJUSTE',
        v_item.stock_contado - v_stock_actual,
        v_stock_actual, v_item.stock_contado,
        v_conteo.deposito_id,
        p_conteo_id, 'CONTEO',
        p_user_id, v_conteo.organization_id,
        COALESCE(
          'Conteo físico "' || v_conteo.nombre || '"' ||
          CASE WHEN v_item.observaciones IS NOT NULL THEN ' — ' || v_item.observaciones ELSE '' END,
          'Conteo físico'
        )
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

-- ensamblar_kit_atomic (origen: 177_kits_bom.sql)
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
  v_comp_inv           inventario%ROWTYPE;
  v_dep_row            inventario_depositos%ROWTYPE;
  v_disponible         INTEGER;
  v_consumir           INTEGER;
  v_ref_id             TEXT;
  v_stock_anterior     INTEGER;
  v_stock_posterior    INTEGER;
  v_ids                TEXT[];
  v_id                 TEXT;
BEGIN
  IF p_cantidad_a_ensamblar IS NULL OR p_cantidad_a_ensamblar <= 0 THEN
    RAISE EXCEPTION 'Cantidad a ensamblar debe ser > 0'
      USING ERRCODE = '22023';
  END IF;

  -- Validar kit
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

  -- Validar depósito si provisto
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

  -- Verificar receta no vacía
  IF NOT EXISTS (
    SELECT 1 FROM inventario_kit_items
    WHERE kit_id = p_kit_id AND organization_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'El kit no tiene receta definida' USING ERRCODE = '22023';
  END IF;

  -- Recolectar ids (kit + componentes) y ordenar para lock determinista
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_ids
  FROM (
    SELECT p_kit_id AS x
    UNION
    SELECT componente_id FROM inventario_kit_items
    WHERE kit_id = p_kit_id AND organization_id = p_org_id
  ) s;

  -- Lock pesimista de todas las filas inventario en orden determinista
  FOREACH v_id IN ARRAY v_ids LOOP
    PERFORM 1 FROM inventario WHERE id = v_id FOR UPDATE;
  END LOOP;

  -- Validar stock disponible de cada componente y consumir
  FOR v_comp_row IN
    SELECT ki.componente_id, ki.cantidad,
           inv.nombre AS comp_nombre, inv.codigo AS comp_codigo,
           inv.stock AS comp_stock,
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

    -- Si hay depósito, validar y descontar también de inventario_depositos
    IF p_deposito_id IS NOT NULL THEN
      SELECT * INTO v_dep_row FROM inventario_depositos
        WHERE inventario_id = v_comp_row.componente_id
          AND deposito_id = p_deposito_id
        FOR UPDATE;

      IF NOT FOUND OR (v_dep_row.stock - v_dep_row.stock_reservado) < v_consumir THEN
        RAISE EXCEPTION 'Stock insuficiente de componente "%" en depósito seleccionado',
          v_comp_row.comp_nombre
          USING ERRCODE = 'P0003';
      END IF;

      UPDATE inventario_depositos
        SET stock = stock - v_consumir, updated_at = NOW()
        WHERE inventario_id = v_comp_row.componente_id
          AND deposito_id = p_deposito_id;
    END IF;

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
      p_deposito_id, p_kit_id, 'ENSAMBLAJE_KIT',
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

  -- Incrementar kit
  v_stock_anterior := v_kit.stock;
  v_stock_posterior := v_stock_anterior + p_cantidad_a_ensamblar;

  UPDATE inventario
    SET stock = v_stock_posterior, updated_at = NOW()
    WHERE id = p_kit_id;

  -- Si hay depósito, sumar también en inventario_depositos
  IF p_deposito_id IS NOT NULL THEN
    INSERT INTO inventario_depositos
      (inventario_id, deposito_id, stock, stock_reservado, organization_id)
    VALUES (p_kit_id, p_deposito_id, p_cantidad_a_ensamblar, 0, p_org_id)
    ON CONFLICT (inventario_id, deposito_id) DO UPDATE
      SET stock = inventario_depositos.stock + EXCLUDED.stock,
          updated_at = NOW();
  END IF;

  v_ref_id := generate_cuid();

  INSERT INTO movimientos_inventario (
    inventario_id, tipo, cantidad,
    stock_anterior, stock_posterior,
    deposito_id, referencia_id, referencia_tipo,
    usuario_id, organization_id, observaciones
  ) VALUES (
    p_kit_id, 'ENSAMBLAJE_KIT_IN', p_cantidad_a_ensamblar,
    v_stock_anterior, v_stock_posterior,
    p_deposito_id, v_ref_id, 'ENSAMBLAJE_KIT',
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
  'Ensambla N unidades de un kit ENSAMBLADO: consume componentes (según receta) e incrementa el kit. Lock pesimista ordenado por id. Genera movimientos ENSAMBLAJE_KIT_OUT/IN. ERRCODE: P0002 no encontrado, P0003 stock insuficiente, 22023 args inválidos.';

-- desensamblar_kit_atomic (origen: 177_kits_bom.sql)
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
  v_ref_id             TEXT;
  v_stock_anterior     INTEGER;
  v_stock_posterior    INTEGER;
  v_ids                TEXT[];
  v_id                 TEXT;
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

  -- Lock determinista
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

  -- Validar stock kit
  IF v_kit.stock < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente del kit: disponible %, solicitado %',
      v_kit.stock, p_cantidad
      USING ERRCODE = 'P0003';
  END IF;

  IF p_deposito_id IS NOT NULL THEN
    SELECT * INTO v_dep_kit_row FROM inventario_depositos
      WHERE inventario_id = p_kit_id AND deposito_id = p_deposito_id
      FOR UPDATE;
    IF NOT FOUND OR v_dep_kit_row.stock < p_cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente del kit en depósito seleccionado'
        USING ERRCODE = 'P0003';
    END IF;
    UPDATE inventario_depositos
      SET stock = stock - p_cantidad, updated_at = NOW()
      WHERE inventario_id = p_kit_id AND deposito_id = p_deposito_id;
  END IF;

  -- Decrementar kit
  v_stock_anterior := v_kit.stock;
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
    p_deposito_id, v_ref_id, 'DESENSAMBLAJE_KIT',
    p_user_id, p_org_id,
    COALESCE(p_motivo, format('Desensamblaje de %s unidades', p_cantidad))
  );

  -- Devolver componentes
  FOR v_comp_row IN
    SELECT ki.componente_id, ki.cantidad,
           inv.nombre AS comp_nombre, inv.codigo AS comp_codigo,
           inv.stock AS comp_stock
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

    IF p_deposito_id IS NOT NULL THEN
      INSERT INTO inventario_depositos
        (inventario_id, deposito_id, stock, stock_reservado, organization_id)
      VALUES (v_comp_row.componente_id, p_deposito_id, v_devolver, 0, p_org_id)
      ON CONFLICT (inventario_id, deposito_id) DO UPDATE
        SET stock = inventario_depositos.stock + EXCLUDED.stock,
            updated_at = NOW();
    END IF;

    INSERT INTO movimientos_inventario (
      inventario_id, tipo, cantidad,
      stock_anterior, stock_posterior,
      deposito_id, referencia_id, referencia_tipo,
      usuario_id, organization_id, observaciones
    ) VALUES (
      v_comp_row.componente_id, 'ENSAMBLAJE_KIT_IN', v_devolver,
      v_stock_anterior, v_stock_posterior,
      p_deposito_id, p_kit_id, 'DESENSAMBLAJE_KIT',
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
  'Desensambla N unidades de un kit: decrementa kit, devuelve componentes según receta. Inverso de ensamblar_kit_atomic. ERRCODE: P0002 no encontrado, P0003 stock insuficiente.';

-- consolidate_inventario_items (origen: 123_consolidate_inventario_duplicates.sql)
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
BEGIN
  IF p_source_id = p_target_id THEN
    RAISE EXCEPTION 'El item origen y destino no pueden ser el mismo';
  END IF;

  -- Lock both rows in a stable order to avoid deadlocks when two users
  -- consolidate symmetrically at the same time.
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

  -- Stock reservado queda en el origen hasta que las ventas/órdenes asociadas
  -- se liquiden. Bloqueamos la consolidación si hay reservas pendientes para
  -- evitar perder trazabilidad.
  IF COALESCE(v_source.stock_reservado, 0) > 0 THEN
    RAISE EXCEPTION 'El item origen tiene stock reservado (%), liberá las reservas antes de consolidar', v_source.stock_reservado;
  END IF;

  v_org_id := v_source.organization_id;
  v_stock_source := COALESCE(v_source.stock, 0);
  v_stock_target_before := COALESCE(v_target.stock, 0);
  v_stock_target_after := v_stock_target_before + v_stock_source;

  IF v_stock_source > 0 THEN
    -- SALIDA en origen: deja el stock en 0
    UPDATE inventario
       SET stock = 0,
           updated_at = NOW()
     WHERE id = p_source_id;

    INSERT INTO movimientos_inventario (
      inventario_id, tipo, cantidad,
      stock_anterior, stock_posterior,
      referencia_id, referencia_tipo,
      usuario_id, organization_id, observaciones
    ) VALUES (
      p_source_id, 'SALIDA', v_stock_source,
      v_stock_source, 0,
      p_target_id, 'CONSOLIDACION',
      p_user_id, v_org_id,
      'Consolidación: stock movido a ' || v_target.codigo
    );

    -- ENTRADA en destino
    UPDATE inventario
       SET stock = v_stock_target_after,
           updated_at = NOW()
     WHERE id = p_target_id;

    INSERT INTO movimientos_inventario (
      inventario_id, tipo, cantidad,
      stock_anterior, stock_posterior,
      referencia_id, referencia_tipo,
      usuario_id, organization_id, observaciones
    ) VALUES (
      p_target_id, 'ENTRADA', v_stock_source,
      v_stock_target_before, v_stock_target_after,
      p_source_id, 'CONSOLIDACION',
      p_user_id, v_org_id,
      'Consolidación: stock recibido desde ' || v_source.codigo
    );
  END IF;

  -- Archivar origen (soft-delete)
  UPDATE inventario
     SET deleted_at = NOW(),
         deleted_by = p_user_id,
         updated_at = NOW()
   WHERE id = p_source_id;

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
  'Consolida un item duplicado de inventario: mueve stock al destino, registra movimientos SALIDA/ENTRADA con referencia_tipo=CONSOLIDACION y archiva el origen. Atómico.';

-- registrar_entrada_lote (origen: 175_lotes_series.sql)
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

  -- Resolver depósito (default principal si NULL)
  v_dep_id := p_deposito_id;
  IF v_dep_id IS NULL THEN
    SELECT id INTO v_dep_id FROM depositos
      WHERE organization_id = p_organization_id
        AND deleted_at IS NULL
        AND principal = true
      LIMIT 1;
  END IF;

  -- Upsert lote
  SELECT * INTO v_lote FROM inventario_lotes
    WHERE inventario_id = p_inventario_id
      AND numero_lote = v_numero_lote
    FOR UPDATE;

  IF FOUND THEN
    UPDATE inventario_lotes
      SET cantidad_inicial   = cantidad_inicial + p_cantidad,
          cantidad_actual    = cantidad_actual + p_cantidad,
          -- defensive: si entra más a un lote vencido o bloqueado, reactivar
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

  -- Actualizar stock total
  v_stock_anterior := COALESCE(v_inv.stock, 0);
  v_stock_posterior := v_stock_anterior + p_cantidad;

  UPDATE inventario
    SET stock = v_stock_posterior,
        updated_at = NOW()
    WHERE id = p_inventario_id;

  -- Mantener inventario_depositos en sync (si hay depósito resuelto)
  IF v_dep_id IS NOT NULL THEN
    INSERT INTO inventario_depositos (inventario_id, deposito_id, stock, stock_reservado, organization_id)
    VALUES (p_inventario_id, v_dep_id, p_cantidad, 0, p_organization_id)
    ON CONFLICT (inventario_id, deposito_id)
    DO UPDATE SET stock = inventario_depositos.stock + EXCLUDED.stock,
                  updated_at = NOW();
  END IF;

  -- Registrar movimiento
  INSERT INTO movimientos_inventario (
    inventario_id, tipo, cantidad,
    stock_anterior, stock_posterior,
    deposito_id, referencia_id, referencia_tipo,
    lote_id, usuario_id, organization_id, observaciones
  ) VALUES (
    p_inventario_id, 'ENTRADA', p_cantidad,
    v_stock_anterior, v_stock_posterior,
    v_dep_id, p_orden_compra_id, CASE WHEN p_orden_compra_id IS NOT NULL THEN 'ORDEN_COMPRA' ELSE 'ENTRADA_LOTE' END,
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
  'Registra entrada con lote. Upsert por (inventario_id, numero_lote). Requiere inventario.trackea_lotes=true.';

-- registrar_entrada_series (origen: 175_lotes_series.sql)
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

  -- Normalizar (trim + filtrar vacíos + dedup en el array recibido)
  SELECT array_agg(DISTINCT s ORDER BY s)
    INTO v_normalizados
    FROM unnest(p_numeros_serie) AS s
    WHERE NULLIF(BTRIM(s), '') IS NOT NULL;

  IF v_normalizados IS NULL OR array_length(v_normalizados, 1) IS NULL THEN
    RAISE EXCEPTION 'Todas las series están vacías' USING ERRCODE = '22023';
  END IF;

  -- Re-normalizar con trim (DISTINCT en el array crudo no incluye el trim)
  SELECT array_agg(DISTINCT BTRIM(s))
    INTO v_normalizados
    FROM unnest(v_normalizados) AS s
    WHERE BTRIM(s) <> '';

  v_count := array_length(v_normalizados, 1);

  -- Lock item
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

  -- Validar lote si se pasa
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

  -- Detectar duplicados ya existentes en BD para el item
  SELECT array_agg(numero_serie ORDER BY numero_serie)
    INTO v_existentes
    FROM inventario_series
    WHERE inventario_id = p_inventario_id
      AND numero_serie = ANY (v_normalizados);

  IF v_existentes IS NOT NULL AND array_length(v_existentes, 1) > 0 THEN
    RAISE EXCEPTION 'Series duplicadas (ya existen): %', array_to_string(v_existentes, ', ')
      USING ERRCODE = '22023';
  END IF;

  -- Resolver depósito (default principal si NULL)
  v_dep_id := p_deposito_id;
  IF v_dep_id IS NULL THEN
    SELECT id INTO v_dep_id FROM depositos
      WHERE organization_id = p_organization_id
        AND deleted_at IS NULL
        AND principal = true
      LIMIT 1;
  END IF;

  IF p_garantia_dias IS NOT NULL AND p_garantia_dias > 0 THEN
    v_garantia_vence := CURRENT_DATE + (p_garantia_dias || ' days')::INTERVAL;
  END IF;

  -- Insertar series una por una para acumular IDs en orden
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

  -- Actualizar stock total
  v_stock_anterior := COALESCE(v_inv.stock, 0);
  v_stock_posterior := v_stock_anterior + v_count;

  UPDATE inventario
    SET stock = v_stock_posterior,
        updated_at = NOW()
    WHERE id = p_inventario_id;

  IF v_dep_id IS NOT NULL THEN
    INSERT INTO inventario_depositos (inventario_id, deposito_id, stock, stock_reservado, organization_id)
    VALUES (p_inventario_id, v_dep_id, v_count, 0, p_organization_id)
    ON CONFLICT (inventario_id, deposito_id)
    DO UPDATE SET stock = inventario_depositos.stock + EXCLUDED.stock,
                  updated_at = NOW();
  END IF;

  -- Movimiento
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
  'Ingresa N series para un item. Rechaza si algún numero_serie ya existe.';

-- seed_deposito_inicial (origen: 291_seed_deposito_al_crear_item.sql)
CREATE OR REPLACE FUNCTION seed_deposito_inicial()
RETURNS TRIGGER AS $$
DECLARE
  v_principal TEXT;
BEGIN
  IF NEW.stock IS NULL OR NEW.stock <= 0 THEN
    RETURN NEW;
  END IF;
  v_principal := get_deposito_principal(NEW.organization_id);
  -- Org sin depósito principal: comportamiento global previo, sin detalle.
  IF v_principal IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO inventario_depositos (inventario_id, deposito_id, stock, stock_reservado, organization_id)
  VALUES (NEW.id, v_principal, NEW.stock, 0, NEW.organization_id)
  ON CONFLICT (inventario_id, deposito_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION seed_deposito_inicial() IS
  'v291: siembra inventario_depositos (depósito principal) cuando un item nace con stock > 0. Mantiene la invariante inventario.stock = SUM(inventario_depositos.stock) para todos los caminos de creación.';

-- sync_inventario_total_variantes (origen: 176_inventario_variantes.sql)
CREATE OR REPLACE FUNCTION sync_inventario_total_variantes()
RETURNS TRIGGER AS $$
DECLARE
  v_inv_id     TEXT;
  v_stock      INTEGER;
  v_reservado  INTEGER;
  v_has_var    BOOLEAN;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_inv_id := COALESCE(NEW.inventario_id, OLD.inventario_id);

  SELECT tiene_variantes INTO v_has_var
  FROM inventario
  WHERE id = v_inv_id;

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

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- crear_variantes_bulk (origen: 176_inventario_variantes.sql)
CREATE OR REPLACE FUNCTION crear_variantes_bulk(
  p_inv_id      TEXT,
  p_org         TEXT,
  p_user        TEXT,
  p_variantes   JSONB
) RETURNS JSONB AS $$
DECLARE
  v_var          JSONB;
  v_codigo       TEXT;
  v_codigos      TEXT[] := ARRAY[]::TEXT[];
  v_dup_codes    TEXT[];
  v_ids          TEXT[] := ARRAY[]::TEXT[];
  v_new_id       TEXT;
  v_count        INTEGER := 0;
  v_stock_total  INTEGER := 0;
  v_existing     INTEGER;
  v_was_variant  BOOLEAN;
  v_prev_stock   INTEGER;
  v_prev_reserv  INTEGER;
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

  -- Validar duplicados dentro del payload
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

  -- Validar duplicados contra existentes
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

  -- Activar flag si era false
  IF v_was_variant IS NOT TRUE THEN
    UPDATE inventario
       SET tiene_variantes = true,
           updated_at = NOW()
     WHERE id = p_inv_id;
  END IF;

  -- Insertar variantes
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
    v_stock_total := v_stock_total + COALESCE((v_var->>'stock')::INTEGER, 0);

    -- Movimiento auditable de entrada inicial
    IF COALESCE((v_var->>'stock')::INTEGER, 0) > 0 THEN
      INSERT INTO movimientos_inventario (
        inventario_id, tipo, cantidad,
        stock_anterior, stock_posterior,
        referencia_id, referencia_tipo,
        usuario_id, organization_id, observaciones
      ) VALUES (
        p_inv_id, 'ENTRADA', (v_var->>'stock')::INTEGER,
        0, (v_var->>'stock')::INTEGER,
        v_new_id, 'VARIANTE',
        p_user, p_org,
        format('Stock inicial variante "%s"', v_var->>'nombre')
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'ids', to_jsonb(v_ids),
    'count', v_count
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION crear_variantes_bulk(TEXT, TEXT, TEXT, JSONB) IS
  'Crea variantes de inventario en lote. Activa tiene_variantes en el parent. ERRCODE: P0002 item no encontrado, 23505 codigo duplicado, 22023 payload inválido.';

-- ajustar_stock_variante_atomic (origen: 176_inventario_variantes.sql)
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
  v_cantidad         INTEGER;
  v_mov_id           TEXT;
BEGIN
  IF p_mode NOT IN ('absolute', 'delta') THEN
    RAISE EXCEPTION 'Modo inválido: %', p_mode
      USING ERRCODE = '22023';
  END IF;

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

  v_cantidad := v_stock_posterior - v_stock_anterior;

  UPDATE inventario_variantes
     SET stock = v_stock_posterior,
         updated_at = NOW()
   WHERE id = p_variante_id;

  INSERT INTO movimientos_inventario (
    inventario_id, tipo, cantidad,
    stock_anterior, stock_posterior,
    referencia_id, referencia_tipo,
    usuario_id, organization_id, observaciones
  ) VALUES (
    v_inv_id, 'AJUSTE', v_cantidad,
    v_stock_anterior, v_stock_posterior,
    p_variante_id, 'VARIANTE',
    p_user, p_org,
    COALESCE(p_motivo, 'Ajuste manual de variante')
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
  'Ajuste atómico de stock por variante. Lock por fila + movimiento. ERRCODE: P0002 no encontrada, P0003 stock inválido, 22023 modo inválido.';

-- eliminar_variantes_y_consolidar (origen: 176_inventario_variantes.sql)
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
BEGIN
  -- Lock parent
  SELECT stock INTO v_stock_anterior
  FROM inventario
  WHERE id = p_inv_id
    AND organization_id = p_org
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  -- Sumar stocks vivos
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

  -- Soft-delete variantes
  UPDATE inventario_variantes
     SET deleted_at = NOW(),
         activo = false,
         updated_at = NOW()
   WHERE inventario_id = p_inv_id
     AND deleted_at IS NULL;

  -- Movimiento auditable (sólo si hubo cambio efectivo)
  IF v_stock_posterior <> v_stock_anterior THEN
    INSERT INTO movimientos_inventario (
      inventario_id, tipo, cantidad,
      stock_anterior, stock_posterior,
      referencia_id, referencia_tipo,
      usuario_id, organization_id, observaciones
    ) VALUES (
      p_inv_id, 'AJUSTE', v_stock_posterior - v_stock_anterior,
      v_stock_anterior, v_stock_posterior,
      p_inv_id, 'CONSOLIDACION_VARIANTES',
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
  'Consolida variantes en el stock del parent y las soft-deletea. ERRCODE: P0002 item no encontrado.';

-- finalizar_conteo y sync_inventario_total_variantes no tenian COMMENT antes de la 357.
COMMENT ON FUNCTION finalizar_conteo(TEXT, TEXT, BOOLEAN) IS NULL;
COMMENT ON FUNCTION sync_inventario_total_variantes() IS NULL;
