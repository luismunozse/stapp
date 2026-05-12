-- ========================================
-- 157: Cupones de descuento para catálogo público
-- ========================================
-- Permite a cada org crear códigos de descuento que el cliente aplica
-- al checkout del catálogo. Tipos: porcentaje (0-100) o monto fijo.
-- Reservas atómicas: usos_actuales se incrementa solo si: cupón activo,
-- dentro de vigencia, no superó max_usos. Función SQL evita race con
-- FOR UPDATE.
-- ========================================

CREATE TABLE IF NOT EXISTS catalogo_cupones (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  codigo          TEXT NOT NULL,
  descripcion     TEXT,
  tipo            TEXT NOT NULL CHECK (tipo IN ('porcentaje', 'monto')),
  valor           DECIMAL(10,2) NOT NULL CHECK (valor > 0),
  min_compra      DECIMAL(10,2) CHECK (min_compra IS NULL OR min_compra >= 0),
  max_usos        INTEGER CHECK (max_usos IS NULL OR max_usos > 0),
  usos_actuales   INTEGER NOT NULL DEFAULT 0 CHECK (usos_actuales >= 0),
  fecha_inicio    TIMESTAMPTZ,
  fecha_fin       TIMESTAMPTZ,
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT catalogo_cupones_codigo_format CHECK (codigo ~ '^[A-Z0-9_-]{3,32}$'),
  CONSTRAINT catalogo_cupones_porcentaje_valido
    CHECK (tipo <> 'porcentaje' OR (valor > 0 AND valor <= 100)),
  CONSTRAINT catalogo_cupones_fechas
    CHECK (fecha_fin IS NULL OR fecha_inicio IS NULL OR fecha_fin >= fecha_inicio),
  UNIQUE (organization_id, codigo)
);

CREATE INDEX IF NOT EXISTS idx_catalogo_cupones_org
  ON catalogo_cupones(organization_id, activo, created_at DESC);

CREATE TRIGGER catalogo_cupones_updated_at
  BEFORE UPDATE ON catalogo_cupones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ========================================
-- cotizaciones: referencia al cupón aplicado
-- ========================================
ALTER TABLE cotizaciones
  ADD COLUMN IF NOT EXISTS cupon_id TEXT REFERENCES catalogo_cupones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cupon_codigo TEXT,
  ADD COLUMN IF NOT EXISTS cupon_descuento DECIMAL(10,2);

COMMENT ON COLUMN cotizaciones.cupon_id IS
  'Cupón de catálogo aplicado en el momento de generar la cotización (NULL = sin cupón).';
COMMENT ON COLUMN cotizaciones.cupon_codigo IS
  'Snapshot del código aplicado, por si el cupón es borrado/modificado luego.';
COMMENT ON COLUMN cotizaciones.cupon_descuento IS
  'Monto absoluto descontado por el cupón en esta cotización (snapshot).';

-- ========================================
-- RPC: reservar uso de cupón atómico
-- ========================================
-- Devuelve JSON: { ok, error?, codigo?, tipo?, valor?, descuento_aplicado? }
-- Validaciones:
--   1. Existe + pertenece a la org + activo
--   2. Dentro de vigencia (fecha_inicio/fecha_fin)
--   3. No superó max_usos
--   4. Subtotal >= min_compra (si min_compra)
-- Incrementa usos_actuales si todo OK, con lock FOR UPDATE.

CREATE OR REPLACE FUNCTION aplicar_cupon_catalogo(
  p_organization_id TEXT,
  p_codigo TEXT,
  p_subtotal DECIMAL
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_cupon catalogo_cupones%ROWTYPE;
  v_descuento DECIMAL(10,2);
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT * INTO v_cupon
  FROM catalogo_cupones
  WHERE organization_id = p_organization_id
    AND codigo = UPPER(p_codigo)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cupón no encontrado');
  END IF;

  IF NOT v_cupon.activo THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cupón inactivo');
  END IF;

  IF v_cupon.fecha_inicio IS NOT NULL AND v_now < v_cupon.fecha_inicio THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cupón aún no vigente');
  END IF;

  IF v_cupon.fecha_fin IS NOT NULL AND v_now > v_cupon.fecha_fin THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cupón vencido');
  END IF;

  IF v_cupon.max_usos IS NOT NULL AND v_cupon.usos_actuales >= v_cupon.max_usos THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cupón agotado');
  END IF;

  IF v_cupon.min_compra IS NOT NULL AND p_subtotal < v_cupon.min_compra THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'El subtotal no alcanza el mínimo del cupón',
      'min_compra', v_cupon.min_compra
    );
  END IF;

  IF v_cupon.tipo = 'porcentaje' THEN
    v_descuento := ROUND(p_subtotal * (v_cupon.valor / 100), 2);
  ELSE
    v_descuento := LEAST(v_cupon.valor, p_subtotal);
  END IF;

  UPDATE catalogo_cupones
  SET usos_actuales = usos_actuales + 1,
      updated_at = v_now
  WHERE id = v_cupon.id;

  RETURN jsonb_build_object(
    'ok', true,
    'cupon_id', v_cupon.id,
    'codigo', v_cupon.codigo,
    'tipo', v_cupon.tipo,
    'valor', v_cupon.valor,
    'descuento_aplicado', v_descuento
  );
END;
$$;

-- ========================================
-- RPC: validar cupón SIN incrementar uso (preview en checkout)
-- ========================================
-- ========================================
-- RPC: revertir uso de cupón (rollback en caso de error post-aplicación)
-- ========================================
CREATE OR REPLACE FUNCTION revertir_uso_cupon_catalogo(
  p_cupon_id TEXT
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE catalogo_cupones
  SET usos_actuales = GREATEST(0, usos_actuales - 1),
      updated_at = NOW()
  WHERE id = p_cupon_id;
END;
$$;

CREATE OR REPLACE FUNCTION validar_cupon_catalogo(
  p_organization_id TEXT,
  p_codigo TEXT,
  p_subtotal DECIMAL
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_cupon catalogo_cupones%ROWTYPE;
  v_descuento DECIMAL(10,2);
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT * INTO v_cupon
  FROM catalogo_cupones
  WHERE organization_id = p_organization_id
    AND codigo = UPPER(p_codigo);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cupón no encontrado');
  END IF;

  IF NOT v_cupon.activo THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cupón inactivo');
  END IF;

  IF v_cupon.fecha_inicio IS NOT NULL AND v_now < v_cupon.fecha_inicio THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cupón aún no vigente');
  END IF;

  IF v_cupon.fecha_fin IS NOT NULL AND v_now > v_cupon.fecha_fin THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cupón vencido');
  END IF;

  IF v_cupon.max_usos IS NOT NULL AND v_cupon.usos_actuales >= v_cupon.max_usos THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cupón agotado');
  END IF;

  IF v_cupon.min_compra IS NOT NULL AND p_subtotal < v_cupon.min_compra THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'El subtotal no alcanza el mínimo del cupón',
      'min_compra', v_cupon.min_compra
    );
  END IF;

  IF v_cupon.tipo = 'porcentaje' THEN
    v_descuento := ROUND(p_subtotal * (v_cupon.valor / 100), 2);
  ELSE
    v_descuento := LEAST(v_cupon.valor, p_subtotal);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'codigo', v_cupon.codigo,
    'tipo', v_cupon.tipo,
    'valor', v_cupon.valor,
    'descuento_aplicado', v_descuento
  );
END;
$$;
