-- Rollback de la 365.
--
-- ORDEN: primero volver a desplegar el codigo anterior al PR3b, que llama con
-- 10 parametros y saca el egreso desde la ruta. Con el codigo del 3b en
-- produccion y sin la firma de 14, toda nota de credito de venta responde 503.
--
-- No borra datos: las NC por monto quedan (la vista, el listado, el PDF y el
-- ticket del PR2 ya las muestran) y los egresos quedan con su vinculo a la NC.
--
-- movimientos_caja.devolucion_id y su indice unico NO se borran. Con el codigo
-- de la 356 son inertes: la ruta graba sus egresos sin devolucion_id y el
-- indice es parcial (devolucion_id IS NOT NULL). Borrarlos perderia que egreso
-- salio de que NC, que es lo que la anulacion (PR4) necesita para revertir la
-- plata exacta. Si se vuelve a aplicar la 365, su ADD COLUMN y su CREATE INDEX
-- son IF NOT EXISTS. Tampoco toma locks sobre movimientos_caja.

DROP FUNCTION IF EXISTS public.registrar_devolucion_atomica(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, NUMERIC, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.registrar_devolucion_monto(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

-- El envoltorio de la 356, tal cual.
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
  p_idempotency_key      TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
AS $function$
DECLARE
  v_numero TEXT;
  v_res    JSONB;
BEGIN
  -- El mismo lock que el nucleo toma en su paso 1, tomado antes: un reintento
  -- concurrente con la misma clave espera aca a que el primero commitee, ve su
  -- devolucion y no pide numero.
  PERFORM 1 FROM ventas
  WHERE id = p_venta_id AND organization_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venta no encontrada';
  END IF;

  IF NULLIF(p_idempotency_key, '') IS NOT NULL THEN
    SELECT numero_devolucion INTO v_numero
    FROM devoluciones_venta
    WHERE organization_id = p_org_id AND idempotency_key = p_idempotency_key;
  END IF;

  -- Reintento: el numero de la devolucion ya creada (el nucleo devuelve esa).
  -- Llamada nueva: el que mande el codigo anterior a esta migracion (DEV-) o el
  -- NC- siguiente. Si el nucleo falla, vuelve atras toda la transaccion,
  -- contador incluido: el numero no se quema.
  IF v_numero IS NULL THEN
    v_numero := COALESCE(NULLIF(p_numero_devolucion, ''), get_next_nota_credito_number(p_org_id));
  END IF;

  v_res := registrar_devolucion_nucleo(
    p_org_id, p_venta_id, p_user_id, v_numero, p_motivo, p_observaciones,
    p_metodo_reembolso, p_reembolso_referencia, p_items, p_idempotency_key
  );

  RETURN v_res || jsonb_build_object('numero', v_numero);
END;
$function$;

COMMENT ON FUNCTION public.registrar_devolucion_atomica(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) IS
  'Devolucion de venta (nota de credito del motor de ventas). Asigna el numero NC- '
  'adentro de la transaccion con el contador compartido (get_next_nota_credito_number) '
  'salvo que reciba uno (codigo anterior a la 356) y delega en registrar_devolucion_nucleo '
  '(cuerpo de la 330). Devuelve lo mismo que la 330 mas numero. Migracion 356.';

REVOKE EXECUTE ON FUNCTION public.registrar_devolucion_atomica(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_devolucion_atomica(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT)
  TO service_role;

