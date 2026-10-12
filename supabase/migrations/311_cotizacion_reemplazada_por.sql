-- Migration 311: una cotizacion puede quedar reemplazada por su revision.
--
-- Aceptar una cotizacion guarda la firma del cliente y reserva stock contra
-- esos items (migracion 246). Por eso una aceptada no se edita: la firma
-- quedaria describiendo un documento distinto del que firma. Para corregirla
-- se emite una revision, que es otra cotizacion, y la original queda congelada
-- apuntando a ella.
--
-- NULL = vigente. Con valor = fue reemplazada por esa revision.
--
-- No se usa un estado 'REEMPLAZADA' a proposito: esa fila FUE aceptada y
-- firmada, y eso es un hecho historico que pisar el estado borraria.

ALTER TABLE cotizaciones
  ADD COLUMN IF NOT EXISTS reemplazada_por TEXT REFERENCES cotizaciones(id),
  -- La otra punta: de que cotizacion nacio esta revision. Se escribe al crearla
  -- (Task 4) y se lee al enviarla (Task 5) para saber a quien marcar.
  ADD COLUMN IF NOT EXISTS revision_de TEXT REFERENCES cotizaciones(id);

-- El presupuesto de una orden filtra por esta columna en cada recalculo.
CREATE INDEX IF NOT EXISTS cotizaciones_reemplazada_por_idx
  ON cotizaciones(reemplazada_por)
  WHERE reemplazada_por IS NOT NULL;
