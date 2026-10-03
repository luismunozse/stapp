-- Migration 329: una venta facturada no se anula ni se borra sin más.
--
-- Antes:
--   - Anular una venta con factura electronica (CAE) la dejaba ANULADA con el
--     comprobante emitido en ARCA y sin nota de credito: el libro de IVA
--     seguia mostrando una venta que el sistema daba por anulada.
--   - Anular una venta con remito vigente dejaba el remito como si nada.
--   - Eliminar una venta anulada borraba en cascada su remito y sus
--     comprobantes fiscales (facturas.venta_id y comprobantes_fiscales.venta_id
--     eran ON DELETE CASCADE): se perdia la numeracion y el CAE.
--
-- Ahora:
--   1. Trigger BEFORE UPDATE en ventas: COMPLETADA -> ANULADA falla (P0022) si
--      hay un comprobante fiscal pendiente/emitido o un remito no anulado.
--      La ruta controla lo mismo antes para dar el mensaje; esto lo garantiza
--      para cualquier camino que anule.
--   2. Las FK pasan a NO ACTION: borrar una venta con remito o comprobante
--      falla. NO ACTION (y no RESTRICT) para que borrar la organizacion entera,
--      que borra en cascada ventas y comprobantes en la misma sentencia, siga
--      funcionando.
--
-- La emision de nota de credito electronica todavia no esta implementada: para
-- anular una venta con CAE hay que emitir la NC en ARCA y registrar la
-- devolucion de los productos en el sistema.

-- En una transaccion: entre los DROP y los CREATE/ADD no queda un instante
-- sin trigger ni FK para una venta que se anule o se borre mientras se aplica.
BEGIN;

CREATE OR REPLACE FUNCTION proteger_anulacion_venta()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.estado::text = 'COMPLETADA' AND NEW.estado::text = 'ANULADA' THEN
    IF EXISTS (SELECT 1 FROM comprobantes_fiscales
               WHERE venta_id = NEW.id AND estado IN ('pendiente', 'emitido')) THEN
      RAISE EXCEPTION 'VENTA_NO_ANULABLE: La venta tiene una factura electrónica emitida: para anularla hay que emitir una nota de crédito en ARCA. Registrá la devolución de los productos.'
        USING ERRCODE = 'P0022';
    END IF;
    IF EXISTS (SELECT 1 FROM facturas
               WHERE venta_id = NEW.id AND estado_pago::text <> 'ANULADA') THEN
      RAISE EXCEPTION 'VENTA_NO_ANULABLE: La venta tiene un remito vigente: anulalo primero desde Facturación.'
        USING ERRCODE = 'P0022';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ventas_proteger_anulacion ON ventas;
CREATE TRIGGER ventas_proteger_anulacion
  BEFORE UPDATE OF estado ON ventas
  FOR EACH ROW EXECUTE FUNCTION proteger_anulacion_venta();

ALTER TABLE facturas DROP CONSTRAINT IF EXISTS facturas_venta_id_fkey;
ALTER TABLE facturas
  ADD CONSTRAINT facturas_venta_id_fkey
  FOREIGN KEY (venta_id) REFERENCES ventas(id);

ALTER TABLE comprobantes_fiscales DROP CONSTRAINT IF EXISTS comprobantes_fiscales_venta_id_fkey;
ALTER TABLE comprobantes_fiscales
  ADD CONSTRAINT comprobantes_fiscales_venta_id_fkey
  FOREIGN KEY (venta_id) REFERENCES ventas(id);

COMMIT;
