-- ========================================
-- 175: LOTES, SERIES Y VENCIMIENTOS
-- ========================================
-- Tracking opt-in por item:
--   - trackea_lotes (boolean): activa workflow de lotes (batch).
--     Cada entrada/salida debe asociarse a un numero_lote.
--   - trackea_series (boolean): activa workflow de números de serie.
--     Cada unidad es 1 fila en inventario_series.
--
-- Diseño compatible con flujos existentes:
--   - Items con flags = false (default) → ningún cambio en RPCs actuales.
--   - inventario.stock sigue siendo el total agregado. Las RPCs nuevas
--     mantienen ese invariante (stock = SUM(cantidad_actual) en lotes
--     opcionalmente, o COUNT(*) FILTER (estado='DISPONIBLE') en series).
--   - Las RPCs de venta/cotización NO se modifican en esta fase. La integración
--     con consumo de series se hace en fase 2 (override en crear_venta_atomica).
--
-- Invariantes:
--   - inventario_lotes.cantidad_actual <= cantidad_inicial
--   - inventario_lotes UNIQUE (inventario_id, numero_lote)
--   - inventario_series UNIQUE (inventario_id, numero_serie)
--   - estado serie 'VENDIDO' implica venta_id IS NOT NULL (sólo enforcement
--     a nivel RPC; la columna queda nullable para tolerar imports)
--
-- Errores ERRCODE:
--   22023 → validación (flag desactivado, cantidad inválida, duplicado)
--   P0002 → item / lote / serie no encontrado
--   P0003 → stock insuficiente (consistente con resto del sistema)

-- ========================================
-- 1. COLUMNAS EN inventario
-- ========================================

ALTER TABLE inventario
  ADD COLUMN IF NOT EXISTS trackea_lotes BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE inventario
  ADD COLUMN IF NOT EXISTS trackea_series BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE inventario
  ADD COLUMN IF NOT EXISTS dias_alerta_vencimiento INTEGER;

COMMENT ON COLUMN inventario.trackea_lotes IS
  'Si true, ENTRADA/SALIDA del item deben asociar un lote (numero_lote). Default false: backwards compatible.';
COMMENT ON COLUMN inventario.trackea_series IS
  'Si true, cada unidad debe registrarse en inventario_series. 1 fila = 1 unidad física.';
COMMENT ON COLUMN inventario.dias_alerta_vencimiento IS
  'Días antes del vencimiento en los que la UI alerta. NULL = sin alertas específicas.';

-- ========================================
-- 2. TABLA inventario_lotes
-- ========================================

CREATE TABLE IF NOT EXISTS inventario_lotes (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  inventario_id TEXT NOT NULL REFERENCES inventario(id) ON DELETE CASCADE,
  numero_lote TEXT NOT NULL,
  fecha_vencimiento DATE,
  fecha_recepcion DATE DEFAULT CURRENT_DATE,
  costo_unitario NUMERIC(12,2),
  cantidad_inicial INTEGER NOT NULL CHECK (cantidad_inicial >= 0),
  cantidad_actual INTEGER NOT NULL DEFAULT 0 CHECK (cantidad_actual >= 0),
  proveedor_id TEXT REFERENCES proveedores(id) ON DELETE SET NULL,
  orden_compra_id TEXT REFERENCES ordenes_compra(id) ON DELETE SET NULL,
  deposito_id TEXT REFERENCES depositos(id) ON DELETE SET NULL,
  estado TEXT NOT NULL DEFAULT 'ACTIVO'
    CHECK (estado IN ('ACTIVO','AGOTADO','VENCIDO','BLOQUEADO')),
  notas TEXT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(inventario_id, numero_lote),
  CHECK (cantidad_actual <= cantidad_inicial)
);

CREATE INDEX IF NOT EXISTS inventario_lotes_inv_estado_idx
  ON inventario_lotes(inventario_id, estado);
CREATE INDEX IF NOT EXISTS inventario_lotes_venc_activos_idx
  ON inventario_lotes(fecha_vencimiento)
  WHERE estado = 'ACTIVO' AND fecha_vencimiento IS NOT NULL;
CREATE INDEX IF NOT EXISTS inventario_lotes_org_idx
  ON inventario_lotes(organization_id);
CREATE INDEX IF NOT EXISTS inventario_lotes_deposito_idx
  ON inventario_lotes(deposito_id) WHERE deposito_id IS NOT NULL;

ALTER TABLE inventario_lotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventario_lotes_select ON inventario_lotes;
CREATE POLICY inventario_lotes_select ON inventario_lotes
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS inventario_lotes_all_service ON inventario_lotes;
CREATE POLICY inventario_lotes_all_service ON inventario_lotes
  FOR ALL USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS inventario_lotes_updated_at ON inventario_lotes;
CREATE TRIGGER inventario_lotes_updated_at
  BEFORE UPDATE ON inventario_lotes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE inventario_lotes IS
  'Lotes (batches) por item con vencimiento opcional. Activar trackea_lotes en inventario.';

-- ========================================
-- 3. TABLA inventario_series
-- ========================================

CREATE TABLE IF NOT EXISTS inventario_series (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  inventario_id TEXT NOT NULL REFERENCES inventario(id) ON DELETE CASCADE,
  numero_serie TEXT NOT NULL,
  lote_id TEXT REFERENCES inventario_lotes(id) ON DELETE SET NULL,
  estado TEXT NOT NULL DEFAULT 'DISPONIBLE'
    CHECK (estado IN ('DISPONIBLE','RESERVADO','VENDIDO','GARANTIA_ACTIVA','DEVUELTO','BLOQUEADO')),
  fecha_recepcion DATE DEFAULT CURRENT_DATE,
  fecha_venta TIMESTAMPTZ,
  fecha_garantia_vence DATE,
  venta_id TEXT REFERENCES ventas(id) ON DELETE SET NULL,
  cliente_id TEXT REFERENCES clientes(id) ON DELETE SET NULL,
  deposito_id TEXT REFERENCES depositos(id) ON DELETE SET NULL,
  costo_unitario NUMERIC(12,2),
  notas TEXT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(inventario_id, numero_serie)
);

CREATE INDEX IF NOT EXISTS inventario_series_inv_estado_idx
  ON inventario_series(inventario_id, estado);
CREATE INDEX IF NOT EXISTS inventario_series_numero_idx
  ON inventario_series(numero_serie);
CREATE INDEX IF NOT EXISTS inventario_series_lote_idx
  ON inventario_series(lote_id) WHERE lote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inventario_series_org_idx
  ON inventario_series(organization_id);
CREATE INDEX IF NOT EXISTS inventario_series_venta_idx
  ON inventario_series(venta_id) WHERE venta_id IS NOT NULL;

ALTER TABLE inventario_series ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventario_series_select ON inventario_series;
CREATE POLICY inventario_series_select ON inventario_series
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS inventario_series_all_service ON inventario_series;
CREATE POLICY inventario_series_all_service ON inventario_series
  FOR ALL USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS inventario_series_updated_at ON inventario_series;
CREATE TRIGGER inventario_series_updated_at
  BEFORE UPDATE ON inventario_series
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE inventario_series IS
  'Números de serie (S/N) — 1 fila por unidad física. Activar trackea_series en inventario.';

-- ========================================
-- 4. COLUMNAS EN movimientos_inventario
-- ========================================

ALTER TABLE movimientos_inventario
  ADD COLUMN IF NOT EXISTS lote_id TEXT REFERENCES inventario_lotes(id) ON DELETE SET NULL;

ALTER TABLE movimientos_inventario
  ADD COLUMN IF NOT EXISTS serie_ids TEXT[];

CREATE INDEX IF NOT EXISTS movimientos_inv_lote_idx
  ON movimientos_inventario(lote_id) WHERE lote_id IS NOT NULL;

COMMENT ON COLUMN movimientos_inventario.lote_id IS
  'Lote afectado por este movimiento (NULL si el item no trackea lotes).';
COMMENT ON COLUMN movimientos_inventario.serie_ids IS
  'Array de inventario_series.id afectados por este movimiento (auditoría).';

-- ========================================
-- 5. RPC: registrar_entrada_lote
-- ========================================
-- Upsert por (inventario_id, numero_lote). Si el lote existe, suma cantidad
-- (incluyendo cantidad_inicial para mantener invariante cantidad_actual <=
-- cantidad_inicial). Si no, crea.
--
-- Actualiza inventario.stock += cantidad y, si hay fila en inventario_depositos
-- para el depósito indicado (o el principal si NULL), suma allí también.

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

-- ========================================
-- 6. RPC: registrar_entrada_series
-- ========================================
-- Inserta 1 fila por número de serie en inventario_series. Rechaza si algún
-- número ya existe para el item (lista los conflictos en el mensaje de error).

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

-- ========================================
-- 7. RPC: salida_serie
-- ========================================
-- Marca 1 serie como VENDIDA/DEVUELTA/etc. Decrementa lote y stock total.

CREATE OR REPLACE FUNCTION salida_serie(
  p_organization_id TEXT,
  p_user_id         TEXT,
  p_inventario_id   TEXT,
  p_serie_id        TEXT,
  p_venta_id        TEXT DEFAULT NULL,
  p_cliente_id      TEXT DEFAULT NULL,
  p_motivo          TEXT DEFAULT NULL,
  p_tipo            TEXT DEFAULT 'VENTA'
) RETURNS JSONB AS $$
DECLARE
  v_serie           inventario_series%ROWTYPE;
  v_inv             inventario%ROWTYPE;
  v_lote            inventario_lotes%ROWTYPE;
  v_stock_anterior  INTEGER;
  v_stock_posterior INTEGER;
  v_mov_id          TEXT;
  v_nuevo_estado    TEXT;
BEGIN
  IF p_tipo NOT IN ('VENTA','SALIDA','DEVOLUCION') THEN
    RAISE EXCEPTION 'Tipo de salida inválido' USING ERRCODE = '22023';
  END IF;

  -- Lock serie
  SELECT * INTO v_serie FROM inventario_series
    WHERE id = p_serie_id
      AND inventario_id = p_inventario_id
      AND organization_id = p_organization_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Serie no encontrada' USING ERRCODE = 'P0002';
  END IF;

  IF v_serie.estado NOT IN ('DISPONIBLE','RESERVADO') THEN
    RAISE EXCEPTION 'Serie no disponible (estado actual: %)', v_serie.estado
      USING ERRCODE = '22023';
  END IF;

  -- Lock item
  SELECT * INTO v_inv FROM inventario
    WHERE id = p_inventario_id
    FOR UPDATE;

  v_nuevo_estado := CASE
    WHEN p_tipo = 'DEVOLUCION' THEN 'DEVUELTO'
    WHEN v_serie.fecha_garantia_vence IS NOT NULL AND v_serie.fecha_garantia_vence >= CURRENT_DATE THEN 'GARANTIA_ACTIVA'
    ELSE 'VENDIDO'
  END;

  UPDATE inventario_series
    SET estado = v_nuevo_estado,
        fecha_venta = NOW(),
        venta_id = COALESCE(p_venta_id, venta_id),
        cliente_id = COALESCE(p_cliente_id, cliente_id),
        notas = COALESCE(NULLIF(BTRIM(p_motivo), ''), notas),
        updated_at = NOW()
    WHERE id = p_serie_id;

  -- Decrementar lote si pertenece
  IF v_serie.lote_id IS NOT NULL THEN
    SELECT * INTO v_lote FROM inventario_lotes
      WHERE id = v_serie.lote_id FOR UPDATE;
    IF FOUND THEN
      UPDATE inventario_lotes
        SET cantidad_actual = GREATEST(cantidad_actual - 1, 0),
            estado = CASE WHEN cantidad_actual - 1 <= 0 THEN 'AGOTADO' ELSE estado END,
            updated_at = NOW()
        WHERE id = v_lote.id;
    END IF;
  END IF;

  -- Actualizar stock total
  v_stock_anterior := COALESCE(v_inv.stock, 0);
  v_stock_posterior := GREATEST(v_stock_anterior - 1, 0);

  UPDATE inventario
    SET stock = v_stock_posterior, updated_at = NOW()
    WHERE id = p_inventario_id;

  -- Sync inventario_depositos si tenía depósito asignado
  IF v_serie.deposito_id IS NOT NULL THEN
    UPDATE inventario_depositos
      SET stock = GREATEST(stock - 1, 0), updated_at = NOW()
      WHERE inventario_id = p_inventario_id AND deposito_id = v_serie.deposito_id;
  END IF;

  INSERT INTO movimientos_inventario (
    inventario_id, tipo, cantidad,
    stock_anterior, stock_posterior,
    deposito_id, referencia_id, referencia_tipo,
    lote_id, serie_ids, usuario_id, organization_id, observaciones
  ) VALUES (
    p_inventario_id, p_tipo, 1,
    v_stock_anterior, v_stock_posterior,
    v_serie.deposito_id, p_venta_id, CASE WHEN p_venta_id IS NOT NULL THEN 'VENTA' ELSE 'SALIDA_SERIE' END,
    v_serie.lote_id, ARRAY[p_serie_id], p_user_id, p_organization_id,
    COALESCE(NULLIF(BTRIM(p_motivo), ''), format('Salida serie %s', v_serie.numero_serie))
  )
  RETURNING id INTO v_mov_id;

  RETURN jsonb_build_object(
    'success', true,
    'serieId', p_serie_id,
    'estado', v_nuevo_estado,
    'movimientoId', v_mov_id,
    'stockPosterior', v_stock_posterior
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION salida_serie(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) IS
  'Salida de 1 serie. Decrementa lote (si pertenece) y stock total. Marca AGOTADO si el lote llega a 0.';

-- ========================================
-- 8. RPC: marcar_lotes_vencidos
-- ========================================
-- Job-friendly. Marca como VENCIDO todos los lotes ACTIVO con fecha_vencimiento
-- <= hoy. Por cada uno genera movimiento AJUSTE negativo (saca cantidad_actual
-- del stock) y reduce cantidad_actual a 0.
--
-- Idempotente: lotes ya VENCIDO/AGOTADO/BLOQUEADO no se vuelven a tocar.

CREATE OR REPLACE FUNCTION marcar_lotes_vencidos()
RETURNS INTEGER AS $$
DECLARE
  v_lote            inventario_lotes%ROWTYPE;
  v_count           INTEGER := 0;
  v_stock_anterior  INTEGER;
  v_stock_posterior INTEGER;
BEGIN
  FOR v_lote IN
    SELECT * FROM inventario_lotes
    WHERE estado = 'ACTIVO'
      AND fecha_vencimiento IS NOT NULL
      AND fecha_vencimiento <= CURRENT_DATE
    FOR UPDATE
  LOOP
    -- Solo descontar stock si todavía tenía cantidad
    IF v_lote.cantidad_actual > 0 THEN
      SELECT stock INTO v_stock_anterior FROM inventario
        WHERE id = v_lote.inventario_id FOR UPDATE;
      v_stock_anterior := COALESCE(v_stock_anterior, 0);
      v_stock_posterior := GREATEST(v_stock_anterior - v_lote.cantidad_actual, 0);

      UPDATE inventario
        SET stock = v_stock_posterior, updated_at = NOW()
        WHERE id = v_lote.inventario_id;

      IF v_lote.deposito_id IS NOT NULL THEN
        UPDATE inventario_depositos
          SET stock = GREATEST(stock - v_lote.cantidad_actual, 0), updated_at = NOW()
          WHERE inventario_id = v_lote.inventario_id
            AND deposito_id = v_lote.deposito_id;
      END IF;

      INSERT INTO movimientos_inventario (
        inventario_id, tipo, cantidad,
        stock_anterior, stock_posterior,
        deposito_id, referencia_id, referencia_tipo,
        lote_id, organization_id, observaciones
      ) VALUES (
        v_lote.inventario_id, 'AJUSTE', -v_lote.cantidad_actual,
        v_stock_anterior, v_stock_posterior,
        v_lote.deposito_id, v_lote.id, 'LOTE_VENCIDO',
        v_lote.id, v_lote.organization_id,
        format('Lote %s vencido (%s)', v_lote.numero_lote, v_lote.fecha_vencimiento)
      );
    END IF;

    UPDATE inventario_lotes
      SET estado = 'VENCIDO',
          cantidad_actual = 0,
          updated_at = NOW()
      WHERE id = v_lote.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION marcar_lotes_vencidos() IS
  'Marca como VENCIDO lotes ACTIVO con fecha_vencimiento<=hoy y descuenta del stock. Idempotente. Retorna count.';

-- ========================================
-- 9. RPC: lotes_proximos_vencer
-- ========================================

CREATE OR REPLACE FUNCTION lotes_proximos_vencer(
  p_organization_id    TEXT,
  p_dias_anticipacion  INTEGER DEFAULT 30
)
RETURNS TABLE (
  lote_id           TEXT,
  inventario_id     TEXT,
  codigo            TEXT,
  nombre            TEXT,
  numero_lote       TEXT,
  cantidad_actual   INTEGER,
  fecha_vencimiento DATE,
  dias_restantes    INTEGER,
  deposito_id       TEXT,
  deposito_nombre   TEXT,
  estado            TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    l.id,
    l.inventario_id,
    i.codigo,
    i.nombre,
    l.numero_lote,
    l.cantidad_actual,
    l.fecha_vencimiento,
    (l.fecha_vencimiento - CURRENT_DATE)::INTEGER AS dias_restantes,
    l.deposito_id,
    d.nombre AS deposito_nombre,
    l.estado
  FROM inventario_lotes l
  JOIN inventario i ON i.id = l.inventario_id
  LEFT JOIN depositos d ON d.id = l.deposito_id
  WHERE l.organization_id = p_organization_id
    AND l.estado = 'ACTIVO'
    AND l.fecha_vencimiento IS NOT NULL
    AND (l.fecha_vencimiento - CURRENT_DATE) <= GREATEST(p_dias_anticipacion, 0)
    AND i.deleted_at IS NULL
  ORDER BY l.fecha_vencimiento ASC NULLS LAST, i.nombre ASC;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION lotes_proximos_vencer(TEXT, INTEGER) IS
  'Lotes ACTIVO cuyo vencimiento cae dentro de p_dias_anticipacion (incluye ya vencidos: dias_restantes negativo).';
