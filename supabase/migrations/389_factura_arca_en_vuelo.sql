-- 389: emisión de FACTURAS ARCA con número explícito y resultado incierto.
--
-- Hasta acá la factura se emitía con el "próximo número" que elegía el SDK y un
-- corte después del envío (timeout, red) se marcaba `rechazado`. Si ARCA sí la
-- había autorizado, reintentar emitía una SEGUNDA factura con otro CAE.
--
-- Ahora la factura usa el mismo esquema que la nota de crédito (migración 371):
--   - la fila `pendiente` se graba ANTES de enviar, con el número pedido
--     (`cbte_nro_solicitado`) y la foto de lo que se envía;
--   - un envío incierto queda `pendiente` y se resuelve con "Verificar con ARCA".
--
-- Cambios (no toca datos ni funciones):
--   0. comprobantes_fiscales_nc_check (371) exigía cbte_nro_solicitado NULL en
--      las facturas. Ahora una factura PUEDE llevarlo, y si lo lleva también
--      lleva el CUIT emisor (11 dígitos) y el código de su letra (B = 6, C = 11),
--      que es lo que hace falta para verificarla contra ARCA. La rama de la NC
--      queda idéntica.
--   1. uq_comprobante_factura_en_vuelo: a lo sumo UNA factura numerada pendiente
--      por CUIT emisor + punto de venta + tipo. Dos envíos simultáneos pedirían
--      el mismo número; con una pendiente incierta, el siguiente número depende
--      de lo que pasó con ella.
--   2. uq_comprobante_factura_numero: un mismo número de factura no puede quedar
--      registrado dos veces (protege la adopción por verificación).
--
-- Las filas legadas sin `cbte_nro_solicitado` o sin foto fiscal (cuit_emisor
-- NULL) quedan fuera de los dos índices.
--
-- Sin BEGIN/COMMIT: db-run.mjs envuelve el archivo en una transacción.

DO $$
DECLARE
  v_duplicados TEXT;
BEGIN
  SELECT string_agg(format('%s/%s/%s/%s (%s filas)', cuit_emisor, punto_venta, cbte_tipo, numero, n), '; ')
  INTO v_duplicados
  FROM (
    SELECT cuit_emisor, punto_venta, cbte_tipo, numero, count(*) AS n
    FROM comprobantes_fiscales
    WHERE comprobante_asociado_id IS NULL
      AND estado IN ('emitido', 'anulado')
      AND cuit_emisor IS NOT NULL
      AND numero IS NOT NULL
    GROUP BY 1, 2, 3, 4
    HAVING count(*) > 1
  ) d;

  IF v_duplicados IS NOT NULL THEN
    RAISE EXCEPTION 'MIGRACION_389: facturas con el mismo número registradas más de una vez: %', v_duplicados;
  END IF;
END $$;

ALTER TABLE comprobantes_fiscales DROP CONSTRAINT IF EXISTS comprobantes_fiscales_nc_check;
ALTER TABLE comprobantes_fiscales
  ADD CONSTRAINT comprobantes_fiscales_nc_check CHECK (
    (
      comprobante_asociado_id IS NULL
      AND (cbte_tipo IS NULL OR cbte_tipo NOT IN (8, 13))
      AND motivo IS NULL
      AND motivo_detalle IS NULL
      AND (
        cbte_nro_solicitado IS NULL
        OR (
          cbte_nro_solicitado > 0
          AND cuit_emisor IS NOT NULL AND cuit_emisor ~ '^[0-9]{11}$'
          AND cbte_tipo IS NOT NULL AND cbte_tipo = CASE tipo WHEN 'B' THEN 6 WHEN 'C' THEN 11 END
        )
      )
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

CREATE UNIQUE INDEX IF NOT EXISTS uq_comprobante_factura_en_vuelo
  ON comprobantes_fiscales(cuit_emisor, punto_venta, cbte_tipo)
  WHERE comprobante_asociado_id IS NULL
    AND estado = 'pendiente'
    AND cbte_nro_solicitado IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_comprobante_factura_numero
  ON comprobantes_fiscales(cuit_emisor, punto_venta, cbte_tipo, numero)
  WHERE comprobante_asociado_id IS NULL
    AND estado IN ('emitido', 'anulado')
    AND cuit_emisor IS NOT NULL
    AND numero IS NOT NULL;
