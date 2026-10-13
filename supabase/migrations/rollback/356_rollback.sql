-- Rollback de la 356. No pierde datos: las devoluciones ya numeradas NC-
-- quedan con su numero.
--
-- ORDEN: primero volver a desplegar el codigo anterior al PR1c, que manda su
-- propio numero DEV-. Con el codigo del PR1c en produccion y sin el envoltorio,
-- toda devolucion falla: el nucleo recibe p_numero_devolucion NULL y viola el
-- NOT NULL de numero_devolucion.
--
-- Revertir ANTES las migraciones posteriores que lean v_notas_credito.

DROP VIEW IF EXISTS v_notas_credito;

DROP FUNCTION IF EXISTS public.registrar_devolucion_atomica(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT);

ALTER FUNCTION public.registrar_devolucion_nucleo(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT)
  RENAME TO registrar_devolucion_atomica;

-- Estado previo a la 356: la funcion con los permisos por default.
GRANT EXECUTE ON FUNCTION public.registrar_devolucion_atomica(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT)
  TO PUBLIC, anon, authenticated, service_role;
