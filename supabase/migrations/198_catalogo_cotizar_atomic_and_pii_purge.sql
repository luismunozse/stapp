-- ============================================
-- 198: Atomicidad de cotización pública + PII retention/consent
-- ============================================
-- Cotizar route hacía INSERT cotización → INSERT items_cotizacion →
-- UPDATE abandono en 3 statements separados. Si crashea entre el 1° y el
-- 2° quedan cotizaciones huérfanas sin items. RPC los envuelve en una
-- sola transacción plpgsql (atomicidad nativa de Postgres).
--
-- PII: el flujo público guarda nombre/teléfono/email en carritos abandonados
-- y clientes sin consentimiento ni retención. Agregamos consent_at y un
-- helper de purge para correr desde cron (Ley 25.326 / GDPR-like).
-- ============================================

-- ============================================
-- catalogo_carritos_abandonados: consent + retención
-- ============================================
ALTER TABLE catalogo_carritos_abandonados
  ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ;

COMMENT ON COLUMN catalogo_carritos_abandonados.consent_at IS
  'Timestamp en que el visitante aceptó el aviso de privacidad. NULL = sin consent (debería purgarse rápido).';

-- ============================================
-- RPC: crear_cotizacion_publica_atomica
-- ============================================
-- Transacción única (plpgsql es atómico por default):
--   1. RESERVAR STOCK (via reservar_stock_catalogo, FOR UPDATE locks)
--   2. INSERT cotizaciones
--   3. INSERT items_cotizacion (todos)
--   4. UPDATE abandono.recovered_at si existe
-- Si cualquier paso falla, ROLLBACK completo (stock incluido, no hace falta
-- liberar manualmente). El cupón se aplica ANTES con su propia RPC; si esta
-- función falla, el route debe llamar revertir_uso_cupon_catalogo.
--
-- p_stock_items separado de p_items porque cada uno necesita campos distintos.

CREATE OR REPLACE FUNCTION crear_cotizacion_publica_atomica(
  p_cotizacion  JSONB,   -- { organization_id, cliente_id, numero_cotizacion, public_token, notas, subtotal, iva, total, cupon_id, cupon_codigo, cupon_descuento }
  p_items       JSONB,   -- [{ descripcion, cantidad, precio_unitario, subtotal, inventario_id, catalogo_item_id, comentario_cliente, adjuntos, variante_id, variante_etiqueta }]
  p_stock_items JSONB,   -- [{ item_id, cantidad, variante_id? }] para reservar_stock_catalogo
  p_telefono    TEXT     -- para marcar abandono recovered (opcional, NULL = no marcar)
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_cotizacion_id TEXT;
  v_item          JSONB;
  v_org_id        TEXT;
  v_stock_ok      BOOLEAN;
BEGIN
  v_org_id := p_cotizacion->>'organization_id';

  -- 1. Reservar stock primero. Si falla (P0003 stock insuficiente), propaga
  -- la exception y revierte toda la transacción ANTES de tocar cotizaciones.
  v_stock_ok := reservar_stock_catalogo(v_org_id, p_stock_items);

  INSERT INTO cotizaciones (
    organization_id, cliente_id, numero_cotizacion, public_token,
    tipo, estado, origen, notas,
    subtotal, iva, total, iva_porcentaje,
    descuento_global_tipo, descuento_global_valor,
    cupon_id, cupon_codigo, cupon_descuento
  )
  VALUES (
    v_org_id,
    p_cotizacion->>'cliente_id',
    p_cotizacion->>'numero_cotizacion',
    p_cotizacion->>'public_token',
    'PRESUPUESTO',
    'ENVIADA',
    'CATALOGO_PUBLICO',
    p_cotizacion->>'notas',
    (p_cotizacion->>'subtotal')::DECIMAL,
    (p_cotizacion->>'iva')::DECIMAL,
    (p_cotizacion->>'total')::DECIMAL,
    0,
    'porcentaje',
    0,
    NULLIF(p_cotizacion->>'cupon_id', ''),
    NULLIF(p_cotizacion->>'cupon_codigo', ''),
    NULLIF(p_cotizacion->>'cupon_descuento', '')::DECIMAL
  )
  RETURNING id INTO v_cotizacion_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO items_cotizacion (
      cotizacion_id, descripcion, cantidad, precio_unitario, subtotal,
      unidad, descuento_tipo, descuento_valor,
      inventario_id, catalogo_item_id, tipo_repuesto,
      comentario_cliente, adjuntos,
      variante_id, variante_etiqueta
    )
    VALUES (
      v_cotizacion_id,
      v_item->>'descripcion',
      (v_item->>'cantidad')::INTEGER,
      (v_item->>'precio_unitario')::DECIMAL,
      (v_item->>'subtotal')::DECIMAL,
      'Unidad',
      'porcentaje',
      0,
      NULLIF(v_item->>'inventario_id', ''),
      NULLIF(v_item->>'catalogo_item_id', ''),
      'NO_APLICA',
      NULLIF(v_item->>'comentario_cliente', ''),
      COALESCE(v_item->'adjuntos', '[]'::jsonb),
      NULLIF(v_item->>'variante_id', ''),
      NULLIF(v_item->>'variante_etiqueta', '')
    );
  END LOOP;

  IF p_telefono IS NOT NULL AND length(p_telefono) > 0 THEN
    UPDATE catalogo_carritos_abandonados
    SET recovered_at = NOW(),
        cotizacion_id = v_cotizacion_id
    WHERE organization_id = v_org_id
      AND cliente_telefono = p_telefono
      AND recovered_at IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'cotizacion_id', v_cotizacion_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION crear_cotizacion_publica_atomica(JSONB, JSONB, JSONB, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION crear_cotizacion_publica_atomica(JSONB, JSONB, JSONB, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION crear_cotizacion_publica_atomica(JSONB, JSONB, JSONB, TEXT) TO service_role;

-- ============================================
-- PII auto-purge
-- ============================================
-- Purge agregado para que el cron HTTP pegue una sola RPC.
-- Reglas (alineadas con buenas prácticas Ley 25.326 / GDPR):
--   - Carritos abandonados sin consent → 7 días
--   - Carritos abandonados con consent, no recovered → 90 días
--   - Views (analytics) → 60 días (no son PII sensible pero pesa)
-- Devuelve conteos para logging.

CREATE OR REPLACE FUNCTION purgar_pii_catalogo_publico()
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_carritos_sin_consent INT;
  v_carritos_viejos      INT;
  v_views_viejas         INT;
BEGIN
  WITH deleted AS (
    DELETE FROM catalogo_carritos_abandonados
    WHERE consent_at IS NULL
      AND recovered_at IS NULL
      AND created_at < NOW() - INTERVAL '7 days'
    RETURNING 1
  )
  SELECT count(*) INTO v_carritos_sin_consent FROM deleted;

  WITH deleted AS (
    DELETE FROM catalogo_carritos_abandonados
    WHERE recovered_at IS NULL
      AND created_at < NOW() - INTERVAL '90 days'
    RETURNING 1
  )
  SELECT count(*) INTO v_carritos_viejos FROM deleted;

  WITH deleted AS (
    DELETE FROM catalogo_views
    WHERE created_at < NOW() - INTERVAL '60 days'
    RETURNING 1
  )
  SELECT count(*) INTO v_views_viejas FROM deleted;

  RETURN jsonb_build_object(
    'carritos_sin_consent', v_carritos_sin_consent,
    'carritos_viejos', v_carritos_viejos,
    'views_viejas', v_views_viejas,
    'ran_at', NOW()
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION purgar_pii_catalogo_publico() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION purgar_pii_catalogo_publico() FROM anon;
GRANT EXECUTE ON FUNCTION purgar_pii_catalogo_publico() TO service_role;
