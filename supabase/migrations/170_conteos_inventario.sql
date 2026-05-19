-- ========================================
-- 170: CONTEO FÍSICO DE INVENTARIO
-- ========================================
-- Workflow para hacer arqueo de stock:
--   1. Iniciar conteo: snapshot del stock actual de los items que pasan filtros.
--   2. Cargar stock real contado por cada item (carga progresiva).
--   3. Finalizar: si aplicar_ajustes=true, genera movimientos AJUSTE para
--      cada diferencia y actualiza inventario.stock. Si false, queda como
--      reporte sin tocar stock.
--   4. Cancelar: descarta conteo sin tocar stock.
--
-- Cada conteo es atómico: usar 1 conteo por sesión física. Soporta scope
-- por depósito (deposito_id NULL = global) y filtros por categoría/tipo/proveedor.
--
-- Concurrencia: si entre iniciar y finalizar hubo ventas/ajustes, el
-- snapshot (stock_sistema) queda desactualizado. La diferencia reflejará
-- ese drift — es esperado. El operador decide si re-iniciar el conteo.

-- ========================================
-- 1. TABLA conteos_inventario
-- ========================================

CREATE TABLE IF NOT EXISTS conteos_inventario (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'EN_PROGRESO'
    CHECK (estado IN ('EN_PROGRESO','FINALIZADO','CANCELADO')),
  deposito_id TEXT REFERENCES depositos(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL DEFAULT 'PARCIAL'
    CHECK (tipo IN ('COMPLETO','PARCIAL','CICLICO')),
  -- Tolerancia en % sobre el stock contado; informativo, no bloquea
  tolerancia_pct NUMERIC(5,2),
  -- Snapshot de los filtros usados para selección (categoría, tipo, proveedor)
  filtros_snapshot JSONB,
  -- Si true, al finalizar genera AJUSTE en movimientos_inventario; si false
  -- queda solo como reporte de arqueo sin tocar stock.
  aplicar_ajustes BOOLEAN NOT NULL DEFAULT true,
  -- Agregados denormalizados (mantenidos por triggers)
  total_items INTEGER NOT NULL DEFAULT 0,
  items_contados INTEGER NOT NULL DEFAULT 0,
  items_diferencia INTEGER NOT NULL DEFAULT 0,
  items_ajustados INTEGER NOT NULL DEFAULT 0,
  notas TEXT,
  iniciado_por TEXT REFERENCES users(id) ON DELETE SET NULL,
  iniciado_at TIMESTAMPTZ DEFAULT NOW(),
  finalizado_por TEXT REFERENCES users(id) ON DELETE SET NULL,
  finalizado_at TIMESTAMPTZ,
  cancelado_por TEXT REFERENCES users(id) ON DELETE SET NULL,
  cancelado_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS conteos_inv_org_idx ON conteos_inventario(organization_id);
CREATE INDEX IF NOT EXISTS conteos_inv_estado_idx ON conteos_inventario(organization_id, estado);
CREATE INDEX IF NOT EXISTS conteos_inv_deposito_idx ON conteos_inventario(deposito_id) WHERE deposito_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS conteos_inv_created_idx ON conteos_inventario(created_at DESC);

ALTER TABLE conteos_inventario ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conteos_inv_select ON conteos_inventario;
CREATE POLICY conteos_inv_select ON conteos_inventario
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS conteos_inv_all_service ON conteos_inventario;
CREATE POLICY conteos_inv_all_service ON conteos_inventario
  FOR ALL USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS conteos_inv_updated_at ON conteos_inventario;
CREATE TRIGGER conteos_inv_updated_at
  BEFORE UPDATE ON conteos_inventario
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ========================================
-- 2. TABLA conteos_items
-- ========================================

CREATE TABLE IF NOT EXISTS conteos_items (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  conteo_id TEXT NOT NULL REFERENCES conteos_inventario(id) ON DELETE CASCADE,
  inventario_id TEXT NOT NULL REFERENCES inventario(id) ON DELETE CASCADE,
  -- Snapshot del stock al iniciar el conteo (no se actualiza después)
  stock_sistema INTEGER NOT NULL,
  -- Stock físico cargado por el operador (NULL = pendiente)
  stock_contado INTEGER,
  -- Diferencia: contado - sistema. Columna generada.
  diferencia INTEGER GENERATED ALWAYS AS (
    COALESCE(stock_contado, 0) - stock_sistema
  ) STORED,
  observaciones TEXT,
  contado_por TEXT REFERENCES users(id) ON DELETE SET NULL,
  contado_at TIMESTAMPTZ,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(conteo_id, inventario_id)
);

CREATE INDEX IF NOT EXISTS conteos_items_conteo_idx ON conteos_items(conteo_id);
CREATE INDEX IF NOT EXISTS conteos_items_inv_idx ON conteos_items(inventario_id);
CREATE INDEX IF NOT EXISTS conteos_items_pendientes_idx
  ON conteos_items(conteo_id) WHERE stock_contado IS NULL;

ALTER TABLE conteos_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conteos_items_select ON conteos_items;
CREATE POLICY conteos_items_select ON conteos_items
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS conteos_items_all_service ON conteos_items;
CREATE POLICY conteos_items_all_service ON conteos_items
  FOR ALL USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS conteos_items_updated_at ON conteos_items;
CREATE TRIGGER conteos_items_updated_at
  BEFORE UPDATE ON conteos_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ========================================
-- 3. TRIGGER: mantener agregados en conteos_inventario
-- ========================================

CREATE OR REPLACE FUNCTION sync_conteo_agregados()
RETURNS TRIGGER AS $$
DECLARE
  v_conteo_id TEXT;
  v_total INTEGER;
  v_contados INTEGER;
  v_diferencia INTEGER;
BEGIN
  v_conteo_id := COALESCE(NEW.conteo_id, OLD.conteo_id);

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE stock_contado IS NOT NULL),
    COUNT(*) FILTER (WHERE stock_contado IS NOT NULL AND diferencia <> 0)
  INTO v_total, v_contados, v_diferencia
  FROM conteos_items
  WHERE conteo_id = v_conteo_id;

  UPDATE conteos_inventario
  SET total_items = v_total,
      items_contados = v_contados,
      items_diferencia = v_diferencia
  WHERE id = v_conteo_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS conteos_items_sync_agregados ON conteos_items;
CREATE TRIGGER conteos_items_sync_agregados
  AFTER INSERT OR UPDATE OR DELETE ON conteos_items
  FOR EACH ROW EXECUTE FUNCTION sync_conteo_agregados();

-- ========================================
-- 4. RPC: iniciar_conteo
-- ========================================
-- Crea conteo + snapshot de items que pasan los filtros.
-- p_filtros JSON shape: { categoria?, tipo_dispositivo?, proveedor_id?, solo_con_stock? }
--
-- Errores:
--   P0002 -> organización inválida
--   22023 -> sin items que matcheen

CREATE OR REPLACE FUNCTION iniciar_conteo(
  p_organization_id TEXT,
  p_user_id         TEXT,
  p_nombre          TEXT,
  p_deposito_id     TEXT DEFAULT NULL,
  p_tipo            TEXT DEFAULT 'PARCIAL',
  p_filtros         JSONB DEFAULT '{}'::JSONB,
  p_tolerancia_pct  NUMERIC DEFAULT NULL,
  p_aplicar_ajustes BOOLEAN DEFAULT true,
  p_notas           TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_conteo_id TEXT;
  v_count INTEGER;
  v_categoria TEXT;
  v_tipo_disp TEXT;
  v_proveedor_id TEXT;
  v_solo_con_stock BOOLEAN;
BEGIN
  IF p_nombre IS NULL OR LENGTH(TRIM(p_nombre)) = 0 THEN
    RAISE EXCEPTION 'Nombre de conteo requerido' USING ERRCODE = '22023';
  END IF;

  v_categoria      := p_filtros->>'categoria';
  v_tipo_disp      := p_filtros->>'tipoDispositivo';
  v_proveedor_id   := p_filtros->>'proveedorId';
  v_solo_con_stock := COALESCE((p_filtros->>'soloConStock')::BOOLEAN, false);

  -- Validar depósito si se especifica
  IF p_deposito_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM depositos
      WHERE id = p_deposito_id AND organization_id = p_organization_id
        AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Depósito inválido' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  -- Crear conteo
  INSERT INTO conteos_inventario (
    organization_id, nombre, estado, deposito_id, tipo,
    tolerancia_pct, filtros_snapshot, aplicar_ajustes, notas,
    iniciado_por, iniciado_at
  ) VALUES (
    p_organization_id, TRIM(p_nombre), 'EN_PROGRESO', p_deposito_id, p_tipo,
    p_tolerancia_pct, p_filtros, COALESCE(p_aplicar_ajustes, true), p_notas,
    p_user_id, NOW()
  )
  RETURNING id INTO v_conteo_id;

  -- Snapshot items: si hay deposito_id usar inventario_depositos.stock,
  -- si no usar inventario.stock (total).
  IF p_deposito_id IS NOT NULL THEN
    INSERT INTO conteos_items (conteo_id, inventario_id, stock_sistema, organization_id)
    SELECT
      v_conteo_id,
      i.id,
      COALESCE(idep.stock, 0),
      i.organization_id
    FROM inventario i
    LEFT JOIN inventario_depositos idep
      ON idep.inventario_id = i.id AND idep.deposito_id = p_deposito_id
    WHERE i.organization_id = p_organization_id
      AND i.deleted_at IS NULL
      AND (v_categoria IS NULL OR i.categoria = v_categoria)
      AND (v_tipo_disp IS NULL OR i.tipo_dispositivo::TEXT = v_tipo_disp)
      AND (v_proveedor_id IS NULL OR i.proveedor_id = v_proveedor_id)
      AND (NOT v_solo_con_stock OR COALESCE(idep.stock, 0) > 0);
  ELSE
    INSERT INTO conteos_items (conteo_id, inventario_id, stock_sistema, organization_id)
    SELECT
      v_conteo_id,
      i.id,
      COALESCE(i.stock, 0),
      i.organization_id
    FROM inventario i
    WHERE i.organization_id = p_organization_id
      AND i.deleted_at IS NULL
      AND (v_categoria IS NULL OR i.categoria = v_categoria)
      AND (v_tipo_disp IS NULL OR i.tipo_dispositivo::TEXT = v_tipo_disp)
      AND (v_proveedor_id IS NULL OR i.proveedor_id = v_proveedor_id)
      AND (NOT v_solo_con_stock OR COALESCE(i.stock, 0) > 0);
  END IF;

  SELECT COUNT(*) INTO v_count FROM conteos_items WHERE conteo_id = v_conteo_id;

  IF v_count = 0 THEN
    DELETE FROM conteos_inventario WHERE id = v_conteo_id;
    RAISE EXCEPTION 'Ningún item coincide con los filtros' USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    'conteoId', v_conteo_id,
    'totalItems', v_count
  );
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- 5. RPC: finalizar_conteo
-- ========================================
-- Aplica los ajustes (si aplicar_ajustes=true) generando movimientos AJUSTE
-- y actualizando inventario.stock para cada item con diferencia.
-- Si aplicar_ajustes=false, solo marca FINALIZADO sin tocar stock.
--
-- Errores:
--   P0002 -> conteo no encontrado
--   22023 -> estado inválido (ya finalizado/cancelado) o items sin contar

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

-- ========================================
-- 6. RPC: cancelar_conteo
-- ========================================

CREATE OR REPLACE FUNCTION cancelar_conteo(
  p_conteo_id TEXT,
  p_user_id   TEXT,
  p_motivo    TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_conteo RECORD;
BEGIN
  SELECT * INTO v_conteo FROM conteos_inventario
  WHERE id = p_conteo_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conteo no encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF v_conteo.estado <> 'EN_PROGRESO' THEN
    RAISE EXCEPTION 'Solo se puede cancelar un conteo en progreso (estado: %)', v_conteo.estado
      USING ERRCODE = '22023';
  END IF;

  UPDATE conteos_inventario
  SET estado = 'CANCELADO',
      cancelado_por = p_user_id,
      cancelado_at = NOW(),
      notas = COALESCE(notas, '') ||
              CASE WHEN p_motivo IS NOT NULL THEN E'\n[Cancelado] ' || p_motivo ELSE '' END
  WHERE id = p_conteo_id;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql;
