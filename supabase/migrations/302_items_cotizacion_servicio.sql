-- 302: vincular una línea de cotización con el servicio del catálogo
--
-- CONTEXTO
--
-- La migración 300 creó el catálogo `servicios` y lo conectó a las órdenes vía
-- `servicios_orden`. Las cotizaciones quedaron afuera: una línea de servicio se
-- podía tipear a mano, pero no había forma de saber de qué servicio del catálogo
-- salió.
--
-- Esta columna espeja `items_cotizacion.inventario_id` (migración 108): mismo
-- tipo, misma nulabilidad, misma acción de borrado. Es trazabilidad, no cálculo.
-- Ni el subtotal, ni el IVA, ni el total la leen.
--
-- ON DELETE SET NULL: borrar un servicio del catálogo no debe romper ni mutar
-- cotizaciones históricas. `descripcion` y `precio_unitario` ya son snapshot de
-- la línea, así que la cotización sigue diciendo lo mismo que decía.
--
-- Una línea NUNCA lleva inventario_id y servicio_id a la vez, pero no se agrega
-- un CHECK XOR: las filas anteriores a esta migración tienen ambos en NULL (ítem
-- libre), que es un estado válido y seguirá siéndolo.

ALTER TABLE items_cotizacion
  ADD COLUMN IF NOT EXISTS servicio_id TEXT REFERENCES servicios(id) ON DELETE SET NULL;

COMMENT ON COLUMN items_cotizacion.servicio_id IS
  'Servicio del catalogo del que salio esta linea. NULL en items libres y en los productos de inventario. Solo trazabilidad: no participa de ningun calculo.';

CREATE INDEX IF NOT EXISTS items_cotizacion_servicio_idx
  ON items_cotizacion(servicio_id) WHERE servicio_id IS NOT NULL;
