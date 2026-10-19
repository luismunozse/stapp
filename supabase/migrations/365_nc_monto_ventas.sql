-- Migration 365: nota de credito por monto en ventas y egreso de caja atomico.
--
-- Spec: docs/superpowers/specs/2026-10-07-notas-de-credito-design.md
-- Plan: docs/superpowers/plans/2026-10-19-notas-credito-pr3-ventas-monto.md (PR3a)
-- Requiere la 350 (modo, motivo_nc, anulada) y la 356 (envoltorio y nucleo).
--
-- 1. registrar_devolucion_atomica suma cuatro parametros AL FINAL, todos con
--    default: p_modo ('ITEMS'), p_monto, p_motivo_nc y p_registrar_egreso
--    (false). Se borra la firma de 10 y se crea la de 14 en la misma
--    transaccion: queda una sola funcion con ese nombre (PostgREST no ve dos
--    candidatas) y el codigo anterior, que llama con los 10 parametros por
--    nombre, cae en los defaults y hace lo mismo que con la 356. En particular
--    el egreso de caja lo sigue haciendo su ruta (p_registrar_egreso false).
--
-- 2. Modo MONTO: registrar_devolucion_monto acredita un importe sin tocar
--    stock, series, garantias ni items. Mismas reglas de plata que el nucleo
--    (330): tope = lo facturado menos lo acreditado por las NC activas; primero
--    baja la deuda y el resto se reintegra.
--    Modo ITEMS: sigue en registrar_devolucion_nucleo (330), sin copiarlo; el
--    envoltorio le guarda el motivo del catalogo y, si lo recibio (dialogo
--    nuevo), rechaza un reintegro sin medio como el modo monto (probe 36).
--
-- 3. Caja: con p_registrar_egreso, el reintegro en efectivo sale de la caja
--    ADENTRO de la transaccion (antes lo grababa la ruta despues, fuera de
--    ella y best-effort). Se engancha a la caja abierta de la sucursal de la
--    venta; si no hay, queda sin sesion, como hacia la ruta.
--    movimientos_caja.devolucion_id une el movimiento con su NC: la anulacion
--    (PR4) revierte exactamente lo que salio, y el indice unico impide sacar
--    dos veces la plata de la misma NC.
--
-- 4. Una venta sin saldo para acreditar rechaza cualquier NC con un mensaje
--    claro. Antes, devolver productos de una venta ya acreditada entera
--    terminaba en el CHECK monto_devolucion > 0 de la 043 (error 500).
--
-- FK nueva: movimientos_caja.devolucion_id -> devoluciones_venta ON DELETE SET
-- NULL. Borrar la venta (o la org) borra la NC; el movimiento queda porque la
-- plata se movio igual. SET NULL no depende del orden de la cola de triggers
-- RI (probes 29-31).
--
-- Sin BEGIN/COMMIT: db-run.mjs envuelve el archivo en una transaccion y el
-- editor SQL de Supabase lo manda como una sola consulta, que Postgres corre
-- en una transaccion implicita. Entre el DROP y el CREATE del envoltorio no
-- queda un instante sin funcion.
--
-- Locks (aplicar fuera del pico del POS), todos hasta el final de la transaccion:
--   * ACCESS EXCLUSIVE sobre movimientos_caja (ADD COLUMN e indice): mientras
--     tanto nadie lee ni escribe esa tabla (movimientos, resumen, arqueo);
--   * SHARE ROW EXCLUSIVE sobre devoluciones_venta (la FK nueva).
-- Con la columna nula y el indice parcial, el archivo corre en segundos. El
-- riesgo es la ESPERA: si el ALTER queda encolado detras de una consulta larga,
-- todo lo que toque la caja se encola detras de el. lock_timeout acota esa
-- espera: si aborta por el timeout ("canceling statement due to lock
-- timeout"), no se aplico nada; re-correr el archivo.

SET LOCAL lock_timeout = '3s';

-- ── 0. Requiere la 356 ─────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.registrar_devolucion_nucleo(text,text,text,text,text,text,text,text,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'Abort: falta registrar_devolucion_nucleo. Aplicar la 356 antes de la 365.';
  END IF;
END $$;

-- ── 1. Vinculo entre el movimiento de caja y su NC ─────────────────────────
ALTER TABLE movimientos_caja
  ADD COLUMN IF NOT EXISTS devolucion_id TEXT REFERENCES devoluciones_venta(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS movimientos_caja_devolucion_tipo_unique
  ON movimientos_caja (devolucion_id, tipo)
  WHERE devolucion_id IS NOT NULL;

COMMENT ON COLUMN movimientos_caja.devolucion_id IS
  'NC de venta (devoluciones_venta) que genero este movimiento: el EGRESO del reintegro en efectivo y, '
  'desde el PR4, el INGRESO de su anulacion. Uno por tipo (indice unico). SET NULL: si la NC se borra '
  'con su venta, el movimiento queda porque la plata se movio igual. Migracion 365.';

-- ── 2. Modo MONTO ──────────────────────────────────────────────────────────
CREATE FUNCTION public.registrar_devolucion_monto(
  p_org_id               TEXT,
  p_venta_id             TEXT,
  p_user_id              TEXT,
  p_numero               TEXT,
  p_monto                NUMERIC,
  p_motivo_nc            TEXT,
  p_motivo               TEXT,
  p_observaciones        TEXT,
  p_metodo_reembolso     TEXT,
  p_reembolso_referencia TEXT,
  p_idempotency_key      TEXT
) RETURNS JSONB
LANGUAGE plpgsql
AS $function$
DECLARE
  v_venta         ventas%ROWTYPE;
  v_monto         DECIMAL := ROUND(COALESCE(p_monto, 0), 2);
  v_acreditado    DECIMAL := 0;
  v_aplicado_prev DECIMAL := 0;
  v_disponible    DECIMAL;
  v_pendiente     DECIMAL;
  v_aplicado      DECIMAL;
  v_reembolso     DECIMAL;
  v_cobertura     DECIMAL;
  v_metodo        TEXT;
  v_tipo          TEXT;
  v_dev_id        TEXT;
BEGIN
  -- El envoltorio ya tiene el lock de la venta: esto solo relee la fila.
  SELECT * INTO v_venta FROM ventas
  WHERE id = p_venta_id AND organization_id = p_org_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venta no encontrada';
  END IF;
  IF v_venta.estado::text <> 'COMPLETADA' THEN
    RAISE EXCEPTION 'Solo se pueden crear devoluciones para ventas completadas';
  END IF;

  -- Que este en el catalogo lo controla el CHECK de la 350; aca, que venga.
  IF NULLIF(p_motivo_nc, '') IS NULL THEN
    RAISE EXCEPTION 'El motivo de la nota de crédito es obligatorio';
  END IF;
  IF v_monto <= 0 THEN
    RAISE EXCEPTION 'El monto de la nota de crédito tiene que ser mayor a cero';
  END IF;

  -- Tope unico: lo acreditado por las NC activas no pasa lo facturado.
  SELECT COALESCE(SUM(monto_devolucion), 0), COALESCE(SUM(monto_aplicado_deuda), 0)
  INTO v_acreditado, v_aplicado_prev
  FROM devoluciones_venta
  WHERE venta_id = p_venta_id AND anulada = false;

  v_disponible := GREATEST(ROUND(COALESCE(v_venta.total, 0) - v_acreditado, 2), 0);
  IF v_monto > v_disponible THEN
    RAISE EXCEPTION 'El monto supera lo disponible para acreditar. Máximo: %', v_disponible;
  END IF;
  v_tipo := CASE WHEN v_monto = v_disponible THEN 'TOTAL' ELSE 'PARCIAL' END;

  -- Reparto (regla de la 330): primero baja lo que el cliente debe; el resto
  -- se le reintegra.
  v_pendiente := GREATEST(
    COALESCE(v_venta.total, 0) - COALESCE(v_venta.monto_abonado, 0) - v_aplicado_prev, 0);
  v_aplicado  := LEAST(v_monto, v_pendiente);
  v_reembolso := v_monto - v_aplicado;

  v_metodo := NULLIF(p_metodo_reembolso, '');
  IF v_metodo = 'CREDITO_TIENDA' THEN
    v_metodo := 'CUENTA_CORRIENTE';
  END IF;
  IF v_reembolso > 0 AND v_metodo IS NULL THEN
    RAISE EXCEPTION 'Falta el medio de reintegro';
  END IF;
  IF v_reembolso > 0 AND v_metodo = 'CUENTA_CORRIENTE' AND v_venta.cliente_id IS NULL THEN
    RAISE EXCEPTION 'Para devolver a cuenta corriente la venta tiene que tener un cliente';
  END IF;
  -- Sin reintegro no hay medio: el documento no puede decir "te devolvimos".
  IF v_reembolso = 0 THEN
    v_metodo := NULL;
  END IF;

  INSERT INTO devoluciones_venta (
    venta_id, numero_devolucion, motivo, tipo, monto_devolucion, estado,
    observaciones, procesado_por, organization_id,
    metodo_reembolso, reembolso_referencia, fecha_reembolso, reembolso_procesado_por,
    monto_aplicado_deuda, idempotency_key, modo, motivo_nc
  ) VALUES (
    p_venta_id, p_numero, COALESCE(NULLIF(btrim(p_motivo), ''), p_motivo_nc), v_tipo, v_monto, 'COMPLETADA',
    NULLIF(p_observaciones, ''), p_user_id, p_org_id,
    v_metodo::metodo_reembolso,
    CASE WHEN v_metodo IS NOT NULL THEN NULLIF(p_reembolso_referencia, '') END,
    CASE WHEN v_metodo IS NOT NULL THEN now() END,
    CASE WHEN v_metodo IS NOT NULL THEN p_user_id END,
    v_aplicado, NULLIF(p_idempotency_key, ''), 'MONTO', p_motivo_nc
  ) RETURNING id INTO v_dev_id;

  -- Cuenta corriente, igual que el nucleo (330, paso 7): lo que bajo la deuda
  -- compensa el CARGO de la venta; el reintegro a cuenta queda a favor.
  IF v_aplicado > 0 AND v_venta.cliente_id IS NOT NULL THEN
    PERFORM devolver_cuenta_corriente(
      p_org_id, v_venta.cliente_id, v_aplicado, 'VENTA', p_venta_id, p_user_id,
      'Nota de credito ' || p_numero || ' (descuenta saldo pendiente)', v_venta.sucursal_id);
  END IF;
  IF v_reembolso > 0 AND v_metodo = 'CUENTA_CORRIENTE' THEN
    PERFORM devolver_cuenta_corriente(
      p_org_id, v_venta.cliente_id, v_reembolso, 'VENTA', p_venta_id, p_user_id,
      'Nota de credito ' || p_numero, v_venta.sucursal_id);
  END IF;

  IF v_aplicado > 0 THEN
    v_cobertura := COALESCE(v_venta.monto_abonado, 0) + v_aplicado_prev + v_aplicado;
    UPDATE ventas
    SET estado_pago = CASE
          WHEN v_cobertura >= v_venta.total THEN 'PAGADO'
          WHEN v_cobertura > 0 THEN 'PAGADO_PARCIAL'
          ELSE 'PENDIENTE'
        END
    WHERE id = p_venta_id;
  END IF;

  RETURN jsonb_build_object(
    'id', v_dev_id, 'tipo', v_tipo, 'montoDevolucion', v_monto,
    'montoAplicadoDeuda', v_aplicado, 'montoReembolso', v_reembolso, 'replayed', false);
END;
$function$;

COMMENT ON FUNCTION public.registrar_devolucion_monto(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) IS
  'Nota de credito por monto sobre una venta (sin productos). Tope, reparto entre deuda y reintegro, '
  'cuenta corriente y estado_pago con las reglas de la 330. Solo la llama registrar_devolucion_atomica, '
  'con el lock de la venta tomado y el numero ya asignado. Migracion 365.';

REVOKE EXECUTE ON FUNCTION public.registrar_devolucion_monto(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_devolucion_monto(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  TO service_role;

-- ── 3. Envoltorio de 14 parametros ─────────────────────────────────────────
DROP FUNCTION public.registrar_devolucion_atomica(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT);

CREATE FUNCTION public.registrar_devolucion_atomica(
  p_org_id               TEXT,
  p_venta_id             TEXT,
  p_user_id              TEXT,
  p_numero_devolucion    TEXT,
  p_motivo               TEXT,
  p_observaciones        TEXT,
  p_metodo_reembolso     TEXT,
  p_reembolso_referencia TEXT,
  p_items                JSONB,
  p_idempotency_key      TEXT    DEFAULT NULL,
  p_modo                 TEXT    DEFAULT 'ITEMS',
  p_monto                NUMERIC DEFAULT NULL,
  p_motivo_nc            TEXT    DEFAULT NULL,
  p_registrar_egreso     BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql
AS $function$
DECLARE
  v_venta      ventas%ROWTYPE;
  v_existente  devoluciones_venta%ROWTYPE;
  v_modo       TEXT := COALESCE(NULLIF(p_modo, ''), 'ITEMS');
  v_disponible DECIMAL;
  v_numero     TEXT;
  v_res        JSONB;
  v_dev_id     TEXT;
  v_metodo     TEXT;
  v_reembolso  DECIMAL;
  v_sesion_id  TEXT;
  v_mov_id     TEXT;
BEGIN
  -- Lock de la venta antes que nada: dos NC de la misma venta, o el reintento
  -- de un doble click, se serializan aca.
  SELECT * INTO v_venta FROM ventas
  WHERE id = p_venta_id AND organization_id = p_org_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venta no encontrada';
  END IF;

  -- Reintento del mismo pedido: lo ya registrado, sin pedir numero ni sacar
  -- plata otra vez.
  IF NULLIF(p_idempotency_key, '') IS NOT NULL THEN
    SELECT * INTO v_existente FROM devoluciones_venta
    WHERE organization_id = p_org_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      -- La clave es unica por org, no por venta. Una clave reusada en otra venta
      -- no es un reintento: devolver esa NC haria creer que se acredito esta.
      IF v_existente.venta_id <> p_venta_id THEN
        RAISE EXCEPTION 'La clave de reintento ya se uso en una nota de credito de otra venta';
      END IF;
      RETURN jsonb_build_object(
        'id', v_existente.id, 'numero', v_existente.numero_devolucion,
        'modo', v_existente.modo, 'tipo', v_existente.tipo,
        'montoDevolucion', v_existente.monto_devolucion,
        'montoAplicadoDeuda', v_existente.monto_aplicado_deuda,
        'montoReembolso', v_existente.monto_devolucion - v_existente.monto_aplicado_deuda,
        'movimientoCajaId', (SELECT id FROM movimientos_caja
                              WHERE devolucion_id = v_existente.id AND tipo = 'EGRESO'),
        'replayed', true);
    END IF;
  END IF;

  IF v_venta.estado::text <> 'COMPLETADA' THEN
    RAISE EXCEPTION 'Solo se pueden crear devoluciones para ventas completadas';
  END IF;
  IF v_modo NOT IN ('ITEMS', 'MONTO') THEN
    RAISE EXCEPTION 'Modo de nota de crédito inválido: %', v_modo;
  END IF;
  IF v_modo = 'ITEMS' AND jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Elegí al menos un producto para devolver';
  END IF;

  -- Venta ya acreditada entera: ninguna NC mas, en ningun modo.
  SELECT GREATEST(ROUND(COALESCE(v_venta.total, 0) - COALESCE(SUM(monto_devolucion), 0), 2), 0)
  INTO v_disponible
  FROM devoluciones_venta
  WHERE venta_id = p_venta_id AND anulada = false;
  IF v_disponible <= 0 THEN
    RAISE EXCEPTION 'La venta ya no tiene saldo para acreditar';
  END IF;

  -- El NC- se asigna adentro de la transaccion: si algo falla vuelve atras con
  -- todo lo demas y el numero no se quema. Un numero explicito (codigo anterior
  -- a la 356, DEV-) se respeta.
  v_numero := COALESCE(NULLIF(p_numero_devolucion, ''), get_next_nota_credito_number(p_org_id));

  IF v_modo = 'ITEMS' THEN
    v_res := registrar_devolucion_nucleo(
      p_org_id, p_venta_id, p_user_id, v_numero, p_motivo, p_observaciones,
      p_metodo_reembolso, p_reembolso_referencia, p_items, p_idempotency_key);
    IF NULLIF(p_motivo_nc, '') IS NOT NULL THEN
      UPDATE devoluciones_venta SET motivo_nc = p_motivo_nc WHERE id = v_res->>'id';
    END IF;
    -- El reintegro lo calcula el nucleo. Si el dialogo nuevo (el unico que manda
    -- el motivo) lo previo en cero con datos viejos, no manda medio: rechazar,
    -- como el modo monto, en vez de guardar plata devuelta sin medio ni egreso.
    -- La excepcion revierte tambien lo que hizo el nucleo. Sin motivo (codigo
    -- anterior, ventana de deploy) sigue igual que con la 356.
    IF NULLIF(p_motivo_nc, '') IS NOT NULL
       AND COALESCE((v_res->>'montoReembolso')::DECIMAL, 0) > 0
       AND NULLIF(p_metodo_reembolso, '') IS NULL THEN
      RAISE EXCEPTION 'Falta el medio de reintegro';
    END IF;
  ELSE
    v_res := registrar_devolucion_monto(
      p_org_id, p_venta_id, p_user_id, v_numero, p_monto, p_motivo_nc, p_motivo,
      p_observaciones, p_metodo_reembolso, p_reembolso_referencia, p_idempotency_key);
  END IF;

  v_dev_id    := v_res->>'id';
  v_reembolso := COALESCE((v_res->>'montoReembolso')::DECIMAL, 0);
  SELECT metodo_reembolso::TEXT INTO v_metodo FROM devoluciones_venta WHERE id = v_dev_id;

  -- Caja: solo el efectivo que sale del cajon, adentro de la transaccion. Se
  -- engancha a la caja abierta de la sucursal de la venta; sin caja abierta
  -- queda sin sesion, como hacia la ruta. Con p_registrar_egreso false (codigo
  -- anterior a la 365) el egreso lo sigue haciendo la ruta.
  IF p_registrar_egreso AND v_metodo = 'EFECTIVO' AND v_reembolso > 0 THEN
    SELECT id INTO v_sesion_id
    FROM sesiones_caja
    WHERE organization_id = p_org_id AND sucursal_id = v_venta.sucursal_id AND estado = 'ABIERTA'
    LIMIT 1;

    INSERT INTO movimientos_caja (
      organization_id, sesion_caja_id, tipo, monto, metodo_pago, concepto, observaciones,
      usuario_id, afecta_rentabilidad, sucursal_id, origen, devolucion_id
    ) VALUES (
      p_org_id, v_sesion_id, 'EGRESO', v_reembolso, 'EFECTIVO',
      -- V0042, como lib/counters.ts. LPAD corta lo que pasa del largo pedido
      -- (V12345 saldria V1234): el largo nunca baja del numero.
      'Nota de crédito ' || v_numero || ' - Venta V'
        || LPAD(v_venta.numero_venta::TEXT, GREATEST(length(v_venta.numero_venta::TEXT), 4), '0'),
      'Reintegro en efectivo de una nota de crédito de venta',
      p_user_id, false, v_venta.sucursal_id, 'DEVOLUCION', v_dev_id
    ) RETURNING id INTO v_mov_id;
  END IF;

  RETURN v_res || jsonb_build_object('numero', v_numero, 'modo', v_modo, 'movimientoCajaId', v_mov_id);
END;
$function$;

COMMENT ON FUNCTION public.registrar_devolucion_atomica(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, NUMERIC, TEXT, BOOLEAN) IS
  'Nota de credito de una venta (motor de ventas). Lock de la venta, reintento por clave, numero NC- '
  'adentro de la transaccion, modo ITEMS (registrar_devolucion_nucleo, 330) o MONTO '
  '(registrar_devolucion_monto) y, con p_registrar_egreso, el egreso de caja del reintegro en efectivo '
  'enlazado a la NC. Los 4 ultimos parametros tienen default: el codigo anterior llama con 10 y hace '
  'lo mismo que con la 356. Migracion 365.';

REVOKE EXECUTE ON FUNCTION public.registrar_devolucion_atomica(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, NUMERIC, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_devolucion_atomica(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, NUMERIC, TEXT, BOOLEAN)
  TO service_role;
