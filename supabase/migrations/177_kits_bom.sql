-- ========================================
-- 177: KITS / COMBOS / BOM (BILL OF MATERIALS)
-- ========================================
-- Permite que un item de inventario sea declarado como "kit" / "combo",
-- compuesto por N items (componentes) con cantidades fijas. El kit puede
-- ser ENSAMBLADO (tiene stock propio: se ensambla consumiendo componentes
-- y se incrementa el stock del kit) o VIRTUAL (no tiene stock propio:
-- al venderlo se descuentan los componentes — fase 2).
--
-- Esta migración:
--   - Agrega flags es_kit + tipo_kit a inventario.
--   - Crea inventario_kit_items (receta / BOM por kit).
--   - Agrega tipos de movimiento ENSAMBLAJE_KIT_IN / ENSAMBLAJE_KIT_OUT
--     en movimientos_inventario para auditoría.
--   - RPCs:
--       validar_kit_no_ciclico
--       agregar_componente_kit
--       ensamblar_kit_atomic
--       desensamblar_kit_atomic
--       calcular_costo_kit
--       componentes_explosionados_kit
--
-- Todo idempotente. ERRCODEs: 22023 validación, P0002 no encontrado,
-- P0003 stock insuficiente.

-- ========================================
-- 1. INVENTARIO: flags es_kit / tipo_kit
-- ========================================

ALTER TABLE inventario
  ADD COLUMN IF NOT EXISTS es_kit BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tipo_kit TEXT;

-- Re-crear CHECK idempotente sobre tipo_kit
ALTER TABLE inventario DROP CONSTRAINT IF EXISTS inventario_tipo_kit_check;
ALTER TABLE inventario ADD CONSTRAINT inventario_tipo_kit_check
  CHECK (tipo_kit IS NULL OR tipo_kit IN ('ENSAMBLADO', 'VIRTUAL'));

-- Si es_kit=true, tipo_kit no puede ser NULL (validado a nivel app
-- también, pero protegemos a nivel DB).
ALTER TABLE inventario DROP CONSTRAINT IF EXISTS inventario_kit_tipo_required_check;
ALTER TABLE inventario ADD CONSTRAINT inventario_kit_tipo_required_check
  CHECK (es_kit = false OR tipo_kit IS NOT NULL);

CREATE INDEX IF NOT EXISTS inventario_es_kit_idx
  ON inventario(organization_id)
  WHERE es_kit = true AND deleted_at IS NULL;

-- ========================================
-- 2. TABLA inventario_kit_items (BOM)
-- ========================================

CREATE TABLE IF NOT EXISTS inventario_kit_items (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  kit_id TEXT NOT NULL REFERENCES inventario(id) ON DELETE CASCADE,
  componente_id TEXT NOT NULL REFERENCES inventario(id) ON DELETE RESTRICT,
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  es_obligatorio BOOLEAN NOT NULL DEFAULT true,
  notas TEXT,
  orden INTEGER NOT NULL DEFAULT 0,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (kit_id, componente_id),
  CHECK (kit_id <> componente_id)
);

CREATE INDEX IF NOT EXISTS inventario_kit_items_kit_idx
  ON inventario_kit_items(kit_id);
CREATE INDEX IF NOT EXISTS inventario_kit_items_componente_idx
  ON inventario_kit_items(componente_id);
CREATE INDEX IF NOT EXISTS inventario_kit_items_org_idx
  ON inventario_kit_items(organization_id);

ALTER TABLE inventario_kit_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventario_kit_items_select ON inventario_kit_items;
CREATE POLICY inventario_kit_items_select ON inventario_kit_items
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS inventario_kit_items_all_service ON inventario_kit_items;
CREATE POLICY inventario_kit_items_all_service ON inventario_kit_items
  FOR ALL USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS inventario_kit_items_updated_at ON inventario_kit_items;
CREATE TRIGGER inventario_kit_items_updated_at
  BEFORE UPDATE ON inventario_kit_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ========================================
-- 3. MOVIMIENTOS: tipos para ensamblaje
-- ========================================
-- Agregar ENSAMBLAJE_KIT_IN / ENSAMBLAJE_KIT_OUT al CHECK existente
-- para auditoría diferenciada (los ENTRADA/SALIDA "comunes" no permiten
-- filtrar por kit en historial).

ALTER TABLE movimientos_inventario DROP CONSTRAINT IF EXISTS movimientos_inventario_tipo_check;
ALTER TABLE movimientos_inventario ADD CONSTRAINT movimientos_inventario_tipo_check
  CHECK (tipo IN (
    'ENTRADA','SALIDA','AJUSTE','VENTA','DEVOLUCION','ANULACION',
    'RESERVA','LIBERACION_RESERVA','COMPRA_RECIBIDA',
    'TRANSFERENCIA_OUT','TRANSFERENCIA_IN',
    'ENSAMBLAJE_KIT_IN','ENSAMBLAJE_KIT_OUT'
  ));

-- ========================================
-- 4. RPC: validar_kit_no_ciclico
-- ========================================
-- Camina aguas abajo desde componente_id por la receta. Si encuentra
-- p_kit_id, hay ciclo (devuelve FALSE). Si no, devuelve TRUE.
-- Profundidad limitada a 20 niveles por seguridad.

CREATE OR REPLACE FUNCTION validar_kit_no_ciclico(
  p_kit_id        TEXT,
  p_componente_id TEXT,
  p_org_id        TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_existe BOOLEAN;
BEGIN
  IF p_kit_id = p_componente_id THEN
    RETURN FALSE;
  END IF;

  WITH RECURSIVE descendientes(id, depth) AS (
    SELECT p_componente_id::TEXT, 0
    UNION ALL
    SELECT ki.componente_id, d.depth + 1
    FROM inventario_kit_items ki
    JOIN descendientes d ON d.id = ki.kit_id
    WHERE ki.organization_id = p_org_id
      AND d.depth < 20
  )
  SELECT EXISTS (
    SELECT 1 FROM descendientes WHERE id = p_kit_id
  ) INTO v_existe;

  RETURN NOT v_existe;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION validar_kit_no_ciclico(TEXT,TEXT,TEXT) IS
  'Devuelve TRUE si agregar p_componente_id a la receta de p_kit_id NO forma un ciclo. Recursivo, profundidad max 20.';

-- ========================================
-- 5. RPC: agregar_componente_kit
-- ========================================
-- Upsert por (kit_id, componente_id): si existe, suma cantidad; si no,
-- inserta. Valida pertenencia a org, no-ciclo, y activa es_kit=true en
-- el padre si todavía estaba en false (tipo_kit por defecto ENSAMBLADO).

CREATE OR REPLACE FUNCTION agregar_componente_kit(
  p_kit_id        TEXT,
  p_componente_id TEXT,
  p_cantidad      INTEGER,
  p_org_id        TEXT,
  p_user_id       TEXT DEFAULT NULL,
  p_notas         TEXT DEFAULT NULL
) RETURNS inventario_kit_items AS $$
DECLARE
  v_kit         inventario%ROWTYPE;
  v_componente  inventario%ROWTYPE;
  v_row         inventario_kit_items%ROWTYPE;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'Cantidad debe ser > 0'
      USING ERRCODE = '22023';
  END IF;

  IF p_kit_id = p_componente_id THEN
    RAISE EXCEPTION 'Un kit no puede contenerse a sí mismo'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_kit FROM inventario
    WHERE id = p_kit_id
      AND organization_id = p_org_id
      AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kit no encontrado' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_componente FROM inventario
    WHERE id = p_componente_id
      AND organization_id = p_org_id
      AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Componente no encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- Validar no-ciclo
  IF NOT validar_kit_no_ciclico(p_kit_id, p_componente_id, p_org_id) THEN
    RAISE EXCEPTION 'Agregar este componente formaría un ciclo en la receta'
      USING ERRCODE = '22023';
  END IF;

  -- Auto-activar es_kit si todavía no lo era (tipo_kit por defecto ENSAMBLADO)
  IF v_kit.es_kit = false THEN
    UPDATE inventario
      SET es_kit = true,
          tipo_kit = COALESCE(tipo_kit, 'ENSAMBLADO'),
          updated_at = NOW()
    WHERE id = p_kit_id;
  END IF;

  -- Upsert: si existe, SUMA cantidad; si no, INSERT
  INSERT INTO inventario_kit_items
    (kit_id, componente_id, cantidad, es_obligatorio, notas, organization_id)
  VALUES
    (p_kit_id, p_componente_id, p_cantidad, true, p_notas, p_org_id)
  ON CONFLICT (kit_id, componente_id) DO UPDATE
    SET cantidad = inventario_kit_items.cantidad + EXCLUDED.cantidad,
        notas = COALESCE(EXCLUDED.notas, inventario_kit_items.notas),
        updated_at = NOW()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION agregar_componente_kit(TEXT,TEXT,INTEGER,TEXT,TEXT,TEXT) IS
  'Agrega/suma un componente a la receta de un kit. Auto-activa es_kit en el padre. Valida no-ciclo. ERRCODE: P0002 no encontrado, 22023 inválido.';

-- ========================================
-- 6. RPC: ensamblar_kit_atomic
-- ========================================
-- Consume componentes y produce kit. Tipo del kit debe ser ENSAMBLADO.
-- Lock pesimista de filas inventario ordenado por id para evitar deadlock.
-- Si p_deposito_id está provisto, descuenta de inventario_depositos también
-- (solo de ese depósito); kit producido va al mismo depósito.

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

-- ========================================
-- 7. RPC: desensamblar_kit_atomic
-- ========================================
-- Inverso de ensamblar_kit_atomic. Decrementa kit, incrementa componentes.

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

-- ========================================
-- 8. RPC: calcular_costo_kit
-- ========================================

CREATE OR REPLACE FUNCTION calcular_costo_kit(
  p_kit_id  TEXT,
  p_org_id  TEXT
) RETURNS NUMERIC AS $$
DECLARE
  v_costo NUMERIC;
BEGIN
  SELECT COALESCE(SUM(ki.cantidad * COALESCE(inv.precio_compra, 0)), 0)
    INTO v_costo
  FROM inventario_kit_items ki
  JOIN inventario inv ON inv.id = ki.componente_id
  WHERE ki.kit_id = p_kit_id
    AND ki.organization_id = p_org_id;

  RETURN v_costo;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION calcular_costo_kit(TEXT,TEXT) IS
  'Suma (cantidad * precio_compra) de cada componente directo de un kit. NO explosiona sub-kits.';

-- ========================================
-- 9. RPC: componentes_explosionados_kit
-- ========================================
-- Explosiona recursivamente: si un componente es a su vez un kit,
-- multiplica cantidades y baja un nivel. Devuelve lista plana de
-- componentes "hoja" (no-kit) con cantidad efectiva total.
-- Profundidad max 10.

CREATE OR REPLACE FUNCTION componentes_explosionados_kit(
  p_kit_id  TEXT,
  p_org_id  TEXT
) RETURNS TABLE (
  componente_id     TEXT,
  codigo            TEXT,
  nombre            TEXT,
  cantidad_total    NUMERIC,
  precio_compra     NUMERIC,
  costo_subtotal    NUMERIC,
  es_kit            BOOLEAN,
  profundidad       INTEGER
) AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE explosion AS (
    -- Nivel 1: componentes directos del kit
    SELECT
      ki.componente_id      AS componente_id,
      ki.cantidad::NUMERIC  AS cantidad_acum,
      1                     AS depth,
      ARRAY[ki.componente_id]::TEXT[] AS path
    FROM inventario_kit_items ki
    WHERE ki.kit_id = p_kit_id
      AND ki.organization_id = p_org_id

    UNION ALL

    -- Niveles N+1: si componente es kit, bajar
    SELECT
      ki.componente_id,
      e.cantidad_acum * ki.cantidad,
      e.depth + 1,
      e.path || ki.componente_id
    FROM explosion e
    JOIN inventario inv ON inv.id = e.componente_id
    JOIN inventario_kit_items ki ON ki.kit_id = e.componente_id
    WHERE inv.es_kit = true
      AND inv.tipo_kit = 'VIRTUAL' -- VIRTUAL: se explosiona; ENSAMBLADO: queda como item final
      AND ki.organization_id = p_org_id
      AND e.depth < 10
      AND NOT (ki.componente_id = ANY(e.path)) -- guard anti-ciclo
  ),
  agregado AS (
    SELECT
      e.componente_id,
      SUM(e.cantidad_acum) AS cant_total,
      MAX(e.depth) AS depth_max
    FROM explosion e
    -- Sólo "hojas": un componente es hoja si NO es VIRTUAL kit
    -- (los ENSAMBLADO también quedan como hojas en la BOM)
    JOIN inventario inv ON inv.id = e.componente_id
    WHERE NOT (inv.es_kit = true AND inv.tipo_kit = 'VIRTUAL')
    GROUP BY e.componente_id
  )
  SELECT
    a.componente_id,
    inv.codigo,
    inv.nombre,
    a.cant_total,
    COALESCE(inv.precio_compra, 0),
    a.cant_total * COALESCE(inv.precio_compra, 0),
    COALESCE(inv.es_kit, false),
    a.depth_max
  FROM agregado a
  JOIN inventario inv ON inv.id = a.componente_id
  ORDER BY inv.nombre;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION componentes_explosionados_kit(TEXT,TEXT) IS
  'Devuelve lista plana de componentes efectivos de un kit, explosionando sub-kits VIRTUAL. Los sub-kits ENSAMBLADO quedan como item final (no se explosionan). Profundidad max 10, con guard anti-ciclo.';

-- ========================================
-- 10. Permisos (Supabase Edge si aplica)
-- ========================================

GRANT EXECUTE ON FUNCTION validar_kit_no_ciclico(TEXT,TEXT,TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION agregar_componente_kit(TEXT,TEXT,INTEGER,TEXT,TEXT,TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION ensamblar_kit_atomic(TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION desensamblar_kit_atomic(TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION calcular_costo_kit(TEXT,TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION componentes_explosionados_kit(TEXT,TEXT) TO authenticated, service_role;
