-- ========================================
-- 176: VARIANTES DE INVENTARIO
-- ========================================
-- Permite que un item de inventario tenga variantes (color/talle/capacidad…)
-- con stock + precio + barcode independiente por variante.
--
-- Coexistencia con `catalogo_variantes` (migration 158):
--   - catalogo_variantes opera sobre catalogo_items (catálogo público).
--   - inventario_variantes opera sobre la tabla `inventario` interna (la que
--     usan repuestos, órdenes y ventas). Conceptos análogos pero modelos
--     distintos: el catálogo público no maneja stock_reservado, precio_compra
--     ni audit movements. No se modifica la tabla 158, sólo se coexiste.
--
-- Modelo:
--   inventario.tiene_variantes = false (default) → item legacy, sin cambios.
--   inventario.tiene_variantes = true            → su stock/reservado pasa a
--                                                  ser SUM(variantes.*).
--
-- Sync trigger: cualquier INSERT/UPDATE/DELETE sobre inventario_variantes
-- actualiza el parent con SUM(stock) y SUM(stock_reservado) en una única
-- pasada. El trigger usa pg_trigger_depth() para evitar recursión cuando
-- el propio update del parent dispara otros triggers que toquen variantes.
-- ========================================

-- ========================================
-- 1. Extender inventario
-- ========================================

ALTER TABLE inventario
  ADD COLUMN IF NOT EXISTS tiene_variantes BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN inventario.tiene_variantes IS
  'Si true: stock/stock_reservado se calculan automáticamente sumando inventario_variantes vía trigger sync_inventario_total_variantes.';

-- ========================================
-- 2. Tabla inventario_variantes
-- ========================================

CREATE TABLE IF NOT EXISTS inventario_variantes (
  id                TEXT PRIMARY KEY DEFAULT generate_cuid(),
  inventario_id     TEXT NOT NULL REFERENCES inventario(id) ON DELETE CASCADE,
  nombre            TEXT NOT NULL,
  atributos         JSONB NOT NULL DEFAULT '{}'::jsonb,
  codigo_variante   TEXT NOT NULL,
  barcode           TEXT,
  stock             INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  stock_reservado   INTEGER NOT NULL DEFAULT 0 CHECK (stock_reservado >= 0),
  precio_compra     NUMERIC(12,2),
  precio_venta      NUMERIC(12,2),
  imagen_url        TEXT,
  imagen_path       TEXT,
  activo            BOOLEAN NOT NULL DEFAULT true,
  orden             INTEGER NOT NULL DEFAULT 0,
  organization_id   TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventario_variantes_reservado_le_stock CHECK (stock_reservado <= stock),
  CONSTRAINT inventario_variantes_nombre_len CHECK (length(nombre) BETWEEN 1 AND 200),
  CONSTRAINT inventario_variantes_codigo_len CHECK (length(codigo_variante) BETWEEN 1 AND 80)
);

-- Unicidad de codigo_variante por item (sólo activos no borrados)
CREATE UNIQUE INDEX IF NOT EXISTS inventario_variantes_codigo_unique
  ON inventario_variantes(inventario_id, codigo_variante)
  WHERE deleted_at IS NULL;

-- Unicidad de barcode por organización (sólo activos no borrados con barcode)
CREATE UNIQUE INDEX IF NOT EXISTS inventario_variantes_barcode_unique
  ON inventario_variantes(organization_id, barcode)
  WHERE barcode IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS inventario_variantes_inv_idx
  ON inventario_variantes(inventario_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS inventario_variantes_org_idx
  ON inventario_variantes(organization_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS inventario_variantes_barcode_idx
  ON inventario_variantes(barcode) WHERE barcode IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS inventario_variantes_activo_idx
  ON inventario_variantes(inventario_id, orden) WHERE activo = true AND deleted_at IS NULL;

-- ========================================
-- 3. RLS
-- ========================================

ALTER TABLE inventario_variantes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventario_variantes_select ON inventario_variantes;
CREATE POLICY inventario_variantes_select ON inventario_variantes
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS inventario_variantes_all_service ON inventario_variantes;
CREATE POLICY inventario_variantes_all_service ON inventario_variantes
  FOR ALL USING (true) WITH CHECK (true);

-- ========================================
-- 4. Trigger updated_at (idempotente)
-- ========================================

DROP TRIGGER IF EXISTS inventario_variantes_updated_at ON inventario_variantes;
CREATE TRIGGER inventario_variantes_updated_at
  BEFORE UPDATE ON inventario_variantes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ========================================
-- 5. Trigger sync_inventario_total_variantes
-- ========================================
-- AFTER INSERT/UPDATE/DELETE: recalcula parent.stock y parent.stock_reservado
-- como SUM(variantes activas no borradas).
--
-- Anti-recursion: pg_trigger_depth() > 1 → ya estamos dentro de otro trigger,
-- skipear para evitar loops si algún día un update del parent dispara cambios
-- en variantes.

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

DROP TRIGGER IF EXISTS inventario_variantes_sync_total ON inventario_variantes;
CREATE TRIGGER inventario_variantes_sync_total
  AFTER INSERT OR UPDATE OF stock, stock_reservado, deleted_at, activo OR DELETE
  ON inventario_variantes
  FOR EACH ROW EXECUTE FUNCTION sync_inventario_total_variantes();

-- ========================================
-- 6. RPC: crear_variantes_bulk
-- ========================================
-- Inserta variantes en lote, activa tiene_variantes=true en el parent,
-- valida códigos únicos antes de insertar. Returns array de ids creados.
--
-- p_variantes: JSONB array de objetos
--   { nombre, codigo_variante, atributos?, stock?, stock_reservado?,
--     precio_compra?, precio_venta?, barcode?, activo?, orden? }

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

-- ========================================
-- 7. RPC: ajustar_stock_variante_atomic
-- ========================================
-- Análogo a adjust_stock_atomic pero para variantes. Lock por fila,
-- valida disponibilidad (no permite stock negativo ni reservado > stock),
-- registra movimiento AJUSTE con referencia_tipo='VARIANTE'.
--
-- El trigger sync_inventario_total_variantes recalcula el parent automáticamente.

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

-- ========================================
-- 8. RPC: eliminar_variantes_y_consolidar
-- ========================================
-- Reverso de crear_variantes_bulk: soft-deletes todas las variantes activas,
-- suma sus stocks al parent ANTES de borrarlas (para no perder inventario),
-- desactiva tiene_variantes y emite un movimiento de auditoría.

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
