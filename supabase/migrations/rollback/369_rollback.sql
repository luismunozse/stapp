-- Rollback de la 369.
--
-- ORDEN: primero volver a desplegar el codigo anterior al PR4d. Con la ruta de
-- anular en produccion y sin la funcion, anular responde 503.
--
-- Sin la funcion ya no se anula nada. Las NC que ya se anularon quedan
-- anuladas, con sus reversas hechas, y la 368 las sigue ignorando: no hay datos
-- que deshacer (deshacer una anulacion es emitir una NC nueva).

DROP FUNCTION IF EXISTS public.anular_devolucion_venta(TEXT, TEXT, TEXT, TEXT, TEXT);
