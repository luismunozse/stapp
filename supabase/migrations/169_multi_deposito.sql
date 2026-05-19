-- ========================================
-- 169: MULTI-DEPÓSITO (FASE 1)
-- ========================================
-- Introduce desglose de stock por depósito sin romper RPCs existentes.
--
-- Design:
--   - depositos: catálogo por organización. Cada org tiene 1 "Principal"
--     creado por backfill (idempotente vía índice parcial único).
--   - inventario_depositos: split de stock por (item, depósito). Backfill
--     vuelca todo el stock actual al depósito principal.
--   - inventario.stock sigue siendo el total agregado (source of truth
--     compatible con todas las RPCs actuales: venta, cotización, repuestos,
--     ajuste). NO se sincroniza por trigger en esta fase — las transferencias
--     no alteran el total, así que inventario.stock y SUM(inventario_depositos.stock)
--     se mantienen consistentes mientras los demás flujos sigan asumiendo
--     "todo el stock vive en el principal" (estado por defecto post-backfill).
--   - Fase 2 (futura): RPCs venta/reserva aceptan deposito_id opcional y
--     descuentan del depósito específico, sincronizando ambos lados.
--
-- Esta migración añade además la RPC `transferir_stock_atomic` y los tipos
-- de movimiento TRANSFERENCIA_OUT / TRANSFERENCIA_IN.

-- ========================================
-- 1. TABLA depositos
-- ========================================

CREATE TABLE IF NOT EXISTS depositos (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  codigo TEXT,
  direccion TEXT,
  notas TEXT,
  principal BOOLEAN NOT NULL DEFAULT false,
  activo BOOLEAN NOT NULL DEFAULT true,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Nombre único por org (entre activos)
CREATE UNIQUE INDEX IF NOT EXISTS depositos_org_nombre_unique
  ON depositos(organization_id, LOWER(nombre))
  WHERE deleted_at IS NULL;

-- Solo 1 principal por org
CREATE UNIQUE INDEX IF NOT EXISTS depositos_org_principal_unique
  ON depositos(organization_id)
  WHERE principal = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS depositos_org_idx ON depositos(organization_id) WHERE deleted_at IS NULL;

ALTER TABLE depositos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS depositos_select ON depositos;
CREATE POLICY depositos_select ON depositos
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS depositos_all_service ON depositos;
CREATE POLICY depositos_all_service ON depositos
  FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER depositos_updated_at
  BEFORE UPDATE ON depositos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ========================================
-- 2. TABLA inventario_depositos (split de stock)
-- ========================================

CREATE TABLE IF NOT EXISTS inventario_depositos (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  inventario_id TEXT NOT NULL REFERENCES inventario(id) ON DELETE CASCADE,
  deposito_id TEXT NOT NULL REFERENCES depositos(id) ON DELETE RESTRICT,
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  stock_reservado INTEGER NOT NULL DEFAULT 0 CHECK (stock_reservado >= 0),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(inventario_id, deposito_id),
  CHECK (stock_reservado <= stock)
);

CREATE INDEX IF NOT EXISTS inventario_depositos_inv_idx ON inventario_depositos(inventario_id);
CREATE INDEX IF NOT EXISTS inventario_depositos_dep_idx ON inventario_depositos(deposito_id);
CREATE INDEX IF NOT EXISTS inventario_depositos_org_idx ON inventario_depositos(organization_id);

ALTER TABLE inventario_depositos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventario_depositos_select ON inventario_depositos;
CREATE POLICY inventario_depositos_select ON inventario_depositos
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS inventario_depositos_all_service ON inventario_depositos;
CREATE POLICY inventario_depositos_all_service ON inventario_depositos
  FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER inventario_depositos_updated_at
  BEFORE UPDATE ON inventario_depositos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ========================================
-- 3. BACKFILL: depósito "Principal" por org
-- ========================================

INSERT INTO depositos (organization_id, nombre, principal, activo)
SELECT o.id, 'Principal', true, true
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM depositos d
  WHERE d.organization_id = o.id
    AND d.principal = true
    AND d.deleted_at IS NULL
);

-- ========================================
-- 4. BACKFILL: stock actual al depósito principal
-- ========================================

-- Clamp stock_reservado <= stock: hay items con reservas históricas
-- huérfanas (stock=0, reservado>0) que violarían el CHECK. La diferencia
-- queda como warning para auditoría posterior.
DO $$
DECLARE
  v_clamped INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_clamped
  FROM inventario
  WHERE deleted_at IS NULL
    AND COALESCE(stock_reservado, 0) > COALESCE(stock, 0);
  IF v_clamped > 0 THEN
    RAISE NOTICE 'Backfill inventario_depositos: % item(s) con stock_reservado > stock fueron clamped al backfill', v_clamped;
  END IF;
END $$;

INSERT INTO inventario_depositos (inventario_id, deposito_id, stock, stock_reservado, organization_id)
SELECT
  i.id,
  d.id,
  COALESCE(i.stock, 0),
  LEAST(COALESCE(i.stock_reservado, 0), COALESCE(i.stock, 0)),
  i.organization_id
FROM inventario i
JOIN depositos d ON d.organization_id = i.organization_id
                AND d.principal = true
                AND d.deleted_at IS NULL
WHERE i.deleted_at IS NULL
ON CONFLICT (inventario_id, deposito_id) DO NOTHING;

-- ========================================
-- 5. MOVIMIENTOS: deposito_id + transferencias
-- ========================================

ALTER TABLE movimientos_inventario
  ADD COLUMN IF NOT EXISTS deposito_id TEXT REFERENCES depositos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deposito_destino_id TEXT REFERENCES depositos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS movimientos_inv_deposito_idx
  ON movimientos_inventario(deposito_id) WHERE deposito_id IS NOT NULL;

-- Backfill: marcar movimientos históricos como del depósito principal
UPDATE movimientos_inventario m
SET deposito_id = d.id
FROM depositos d
WHERE m.deposito_id IS NULL
  AND d.organization_id = m.organization_id
  AND d.principal = true
  AND d.deleted_at IS NULL;

-- Tipos de movimiento: agregar transferencias
ALTER TABLE movimientos_inventario DROP CONSTRAINT IF EXISTS movimientos_inventario_tipo_check;
ALTER TABLE movimientos_inventario ADD CONSTRAINT movimientos_inventario_tipo_check
  CHECK (tipo IN (
    'ENTRADA','SALIDA','AJUSTE','VENTA','DEVOLUCION','ANULACION',
    'RESERVA','LIBERACION_RESERVA','COMPRA_RECIBIDA',
    'TRANSFERENCIA_OUT','TRANSFERENCIA_IN'
  ));

-- ========================================
-- 6. RPC: transferir_stock_atomic
-- ========================================
-- Transferencia atómica entre depósitos. Lock pesimista en ambas filas
-- (orden por id para evitar deadlock entre transferencias paralelas).
-- Genera 2 movimientos (OUT en origen, IN en destino) con mismo
-- referencia_id para correlación.
--
-- Errores:
--   P0002 -> item / depósito no encontrado
--   P0003 -> stock insuficiente en origen (considerando reservas)
--   22023 -> origen == destino, cantidad <= 0, o cross-org

CREATE OR REPLACE FUNCTION transferir_stock_atomic(
  p_inventario_id     TEXT,
  p_organization_id   TEXT,
  p_user_id           TEXT,
  p_deposito_origen   TEXT,
  p_deposito_destino  TEXT,
  p_cantidad          INTEGER,
  p_motivo            TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_first_id          TEXT;
  v_second_id         TEXT;
  v_origen_row        inventario_depositos%ROWTYPE;
  v_destino_row       inventario_depositos%ROWTYPE;
  v_disponible_origen INTEGER;
  v_dep_origen        depositos%ROWTYPE;
  v_dep_destino       depositos%ROWTYPE;
  v_ref_id            TEXT;
  v_mov_out_id        TEXT;
  v_mov_in_id         TEXT;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'Cantidad debe ser > 0'
      USING ERRCODE = '22023';
  END IF;

  IF p_deposito_origen = p_deposito_destino THEN
    RAISE EXCEPTION 'Depósito origen y destino deben ser distintos'
      USING ERRCODE = '22023';
  END IF;

  -- Validar depósitos (ambos pertenecen a la misma org, activos)
  SELECT * INTO v_dep_origen FROM depositos
    WHERE id = p_deposito_origen
      AND organization_id = p_organization_id
      AND deleted_at IS NULL
      AND activo = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Depósito origen inválido o inactivo'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_dep_destino FROM depositos
    WHERE id = p_deposito_destino
      AND organization_id = p_organization_id
      AND deleted_at IS NULL
      AND activo = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Depósito destino inválido o inactivo'
      USING ERRCODE = 'P0002';
  END IF;

  -- Verificar inventario y org
  IF NOT EXISTS (
    SELECT 1 FROM inventario
    WHERE id = p_inventario_id
      AND organization_id = p_organization_id
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Item no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  -- Lock determinista para evitar deadlock: ordenar por id de depósito
  IF p_deposito_origen < p_deposito_destino THEN
    v_first_id := p_deposito_origen;
    v_second_id := p_deposito_destino;
  ELSE
    v_first_id := p_deposito_destino;
    v_second_id := p_deposito_origen;
  END IF;

  -- Lock fila origen (puede no existir aún)
  SELECT * INTO v_origen_row FROM inventario_depositos
    WHERE inventario_id = p_inventario_id AND deposito_id = p_deposito_origen
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sin stock en depósito origen'
      USING ERRCODE = 'P0003';
  END IF;

  v_disponible_origen := v_origen_row.stock - v_origen_row.stock_reservado;
  IF v_disponible_origen < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente en origen. Disponible: %, Solicitado: %',
      v_disponible_origen, p_cantidad
      USING ERRCODE = 'P0003';
  END IF;

  -- Lock / upsert fila destino
  SELECT * INTO v_destino_row FROM inventario_depositos
    WHERE inventario_id = p_inventario_id AND deposito_id = p_deposito_destino
    FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO inventario_depositos (inventario_id, deposito_id, stock, stock_reservado, organization_id)
    VALUES (p_inventario_id, p_deposito_destino, 0, 0, p_organization_id)
    RETURNING * INTO v_destino_row;
  END IF;

  -- Aplicar transferencia
  UPDATE inventario_depositos
    SET stock = stock - p_cantidad, updated_at = NOW()
    WHERE inventario_id = p_inventario_id AND deposito_id = p_deposito_origen;

  UPDATE inventario_depositos
    SET stock = stock + p_cantidad, updated_at = NOW()
    WHERE inventario_id = p_inventario_id AND deposito_id = p_deposito_destino;

  -- Referencia común para correlacionar los dos movimientos
  v_ref_id := generate_cuid();

  INSERT INTO movimientos_inventario (
    inventario_id, tipo, cantidad,
    stock_anterior, stock_posterior,
    deposito_id, deposito_destino_id,
    referencia_id, referencia_tipo,
    usuario_id, organization_id, observaciones
  ) VALUES (
    p_inventario_id, 'TRANSFERENCIA_OUT', p_cantidad,
    v_origen_row.stock, v_origen_row.stock - p_cantidad,
    p_deposito_origen, p_deposito_destino,
    v_ref_id, 'TRANSFERENCIA',
    p_user_id, p_organization_id,
    COALESCE(p_motivo, format('Transferencia a %s', v_dep_destino.nombre))
  )
  RETURNING id INTO v_mov_out_id;

  INSERT INTO movimientos_inventario (
    inventario_id, tipo, cantidad,
    stock_anterior, stock_posterior,
    deposito_id, deposito_destino_id,
    referencia_id, referencia_tipo,
    usuario_id, organization_id, observaciones
  ) VALUES (
    p_inventario_id, 'TRANSFERENCIA_IN', p_cantidad,
    v_destino_row.stock, v_destino_row.stock + p_cantidad,
    p_deposito_destino, p_deposito_origen,
    v_ref_id, 'TRANSFERENCIA',
    p_user_id, p_organization_id,
    COALESCE(p_motivo, format('Transferencia desde %s', v_dep_origen.nombre))
  )
  RETURNING id INTO v_mov_in_id;

  RETURN jsonb_build_object(
    'success', true,
    'referenciaId', v_ref_id,
    'movimientoOutId', v_mov_out_id,
    'movimientoInId', v_mov_in_id,
    'origen', jsonb_build_object(
      'depositoId', p_deposito_origen,
      'stockAnterior', v_origen_row.stock,
      'stockPosterior', v_origen_row.stock - p_cantidad
    ),
    'destino', jsonb_build_object(
      'depositoId', p_deposito_destino,
      'stockAnterior', v_destino_row.stock,
      'stockPosterior', v_destino_row.stock + p_cantidad
    )
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION transferir_stock_atomic(TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT) IS
  'Transferencia atómica de stock entre depósitos de la misma org. Lock pesimista ordenado por id para evitar deadlock. Genera 2 movimientos (OUT/IN) correlacionados por referencia_id. ERRCODE: P0002 no encontrado, P0003 stock insuficiente, 22023 args inválidos.';
