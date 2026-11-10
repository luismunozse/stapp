-- Rollback de 389_factura_arca_en_vuelo: borra los dos índices y vuelve el CHECK
-- comprobantes_fiscales_nc_check a la forma de la 371 (factura sin cbte_nro_solicitado).
--
-- ORDEN: primero volver a desplegar el código anterior. Con el código nuevo en
-- línea, las facturas ARCA no se podrían grabar con el CHECK viejo.
--
-- SE NIEGA a correr si queda alguna factura `pendiente` con número pedido: el
-- código anterior no sabe verificarla y un reintento podría duplicarla en ARCA.
-- Resolverlas antes con "Verificar con ARCA":
--
--   SELECT id, venta_id, punto_venta, cbte_tipo, cbte_nro_solicitado, updated_at
--   FROM comprobantes_fiscales
--   WHERE comprobante_asociado_id IS NULL AND estado = 'pendiente' AND cbte_nro_solicitado IS NOT NULL;
--
-- QUÉ BORRA: el cbte_nro_solicitado de las facturas ya resueltas (emitidas,
-- anuladas o rechazadas). En una emitida es el mismo número que `numero`; en una
-- rechazada es solo el número que se pidió. No tiene efecto fiscal.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM comprobantes_fiscales
    WHERE comprobante_asociado_id IS NULL AND estado = 'pendiente' AND cbte_nro_solicitado IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ROLLBACK_389: hay facturas pendientes con número pedido; verificarlas antes';
  END IF;
END $$;

DROP INDEX IF EXISTS uq_comprobante_factura_en_vuelo;
DROP INDEX IF EXISTS uq_comprobante_factura_numero;

ALTER TABLE comprobantes_fiscales DROP CONSTRAINT IF EXISTS comprobantes_fiscales_nc_check;

UPDATE comprobantes_fiscales
SET cbte_nro_solicitado = NULL
WHERE comprobante_asociado_id IS NULL AND cbte_nro_solicitado IS NOT NULL;

ALTER TABLE comprobantes_fiscales
  ADD CONSTRAINT comprobantes_fiscales_nc_check CHECK (
    (
      comprobante_asociado_id IS NULL
      AND (cbte_tipo IS NULL OR cbte_tipo NOT IN (8, 13))
      AND motivo IS NULL
      AND motivo_detalle IS NULL
      AND cbte_nro_solicitado IS NULL
    ) OR (
      comprobante_asociado_id IS NOT NULL
      AND comprobante_asociado_id <> id
      AND cuit_emisor IS NOT NULL AND cuit_emisor ~ '^[0-9]{11}$'
      AND cbte_tipo IS NOT NULL AND cbte_tipo = CASE tipo WHEN 'B' THEN 8 WHEN 'C' THEN 13 END
      AND cbte_nro_solicitado IS NOT NULL AND cbte_nro_solicitado > 0
      AND estado <> 'anulado'
      AND motivo IS NOT NULL AND motivo IN ('error_factura', 'devolucion_total', 'otro')
      AND (motivo <> 'otro' OR length(btrim(COALESCE(motivo_detalle, ''))) > 0)
      AND (motivo_detalle IS NULL OR length(motivo_detalle) <= 500)
    )
  );
