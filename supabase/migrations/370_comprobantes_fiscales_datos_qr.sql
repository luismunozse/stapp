-- Migration XXX: foto fiscal del comprobante, para poder reimprimirlo con su QR.
--
-- Hasta ahora comprobantes_fiscales guardaba el CAE y el total, pero no lo que
-- ARCA efectivamente autorizo: fecha, CUIT emisor, tipo de comprobante, importes
-- y receptor. El PDF fiscal y el QR (RG 4892) necesitan exactamente esos datos, y
-- recalcularlos desde la venta seria incorrecto: la venta puede editarse despues
-- de emitida, el comprobante no.
--
-- Columnas nuevas, todas NULLABLE y sin DEFAULT:
--   fecha_emision          fecha del comprobante (CbteFch), no la de creacion
--   cuit_emisor            CUIT del emisor, solo digitos (el representado si la
--                          org delego el servicio)
--   cbte_tipo              codigo ARCA del tipo (B = 6, C = 11)
--   concepto               1 = productos
--   moneda / cotizacion    'PES' y 1
--   importe_neto/_iva/_total  exactamente lo que se mando a ARCA
--   receptor_doc_tipo_cod  codigo ARCA del documento del receptor (99 = CF)
--   receptor_doc_nro_cod   numero de documento, solo digitos (TEXT: hasta 20
--                          digitos no entran de forma segura en un entero)
--   detalle                items tal como se informaron a ARCA
--
-- Las filas emitidas antes de esta migracion quedan con las columnas en NULL: no
-- hay backfill y no se reescribe ningun dato. El codigo que lee tolera el NULL y
-- el codigo que escribe reintenta sin estas columnas si todavia no existen, asi
-- que aplicarla antes o despues del deploy no rompe la emision.
--
-- LOCKS: ADD COLUMN sin DEFAULT es un cambio de catalogo (sin reescribir la
-- tabla); el CREATE INDEX no es CONCURRENTLY pero comprobantes_fiscales es chica.
--
-- Idempotente: se puede correr dos veces.

ALTER TABLE comprobantes_fiscales
  ADD COLUMN IF NOT EXISTS fecha_emision         DATE,
  ADD COLUMN IF NOT EXISTS cuit_emisor           TEXT,
  ADD COLUMN IF NOT EXISTS cbte_tipo             SMALLINT,
  ADD COLUMN IF NOT EXISTS concepto              SMALLINT,
  ADD COLUMN IF NOT EXISTS moneda                TEXT,
  ADD COLUMN IF NOT EXISTS cotizacion            NUMERIC(12,6),
  ADD COLUMN IF NOT EXISTS importe_neto          NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS importe_iva           NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS importe_total         NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS receptor_doc_tipo_cod SMALLINT,
  ADD COLUMN IF NOT EXISTS receptor_doc_nro_cod  TEXT,
  ADD COLUMN IF NOT EXISTS detalle               JSONB;

-- El listado de comprobantes de una organizacion, del mas nuevo al mas viejo.
CREATE INDEX IF NOT EXISTS idx_comprobantes_org_created
  ON comprobantes_fiscales(organization_id, created_at DESC);
