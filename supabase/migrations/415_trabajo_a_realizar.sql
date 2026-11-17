-- 415: "Trabajo a realizar" en la orden.
--
-- Texto corto que se carga al recibir el equipo ("Cambio de batería iPhone 13") y que la hoja de
-- recepción muestra junto al monto, en lugar de la etiqueta genérica "Presupuesto estimado".
-- Pedido de un cliente: entregar un solo papel que diga qué se va a hacer y cuánto sale.
--
-- Aditiva: columna nullable sin default (sin reescritura de tabla).

ALTER TABLE public.ordenes_servicio
  ADD COLUMN IF NOT EXISTS trabajo_a_realizar TEXT
  CHECK (trabajo_a_realizar IS NULL OR char_length(trabajo_a_realizar) <= 200);
