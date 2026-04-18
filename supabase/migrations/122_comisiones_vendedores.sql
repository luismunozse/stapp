-- ========================================
-- Comisiones por vendedor
-- ========================================
-- Análogo a 119_comisiones_tecnicos.sql pero para ventas.
-- El vendedor tiene un % de comisión por defecto (users.porcentaje_comision,
-- ya existente desde 119 — es compartido para ambos roles).
-- Al crear una venta, un trigger copia ese % al snapshot de la venta.
-- La comisión se calcula sobre el TOTAL de la venta (no sobre la ganancia):
-- es el modelo más habitual en retail de talleres y no depende de que
-- costo_unitario_snapshot esté poblado (ventas previas a 090 no lo tienen).
-- Se "devenga" cuando la venta está COMPLETADA; se liquida marcando
-- comision_pagada = true con fecha_pago_comision.
-- ========================================

ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS porcentaje_comision DECIMAL(5,2)
    CHECK (porcentaje_comision IS NULL OR (porcentaje_comision >= 0 AND porcentaje_comision <= 100)),
  ADD COLUMN IF NOT EXISTS comision_pagada BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS fecha_pago_comision TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS comision_pago_notas TEXT;

CREATE INDEX IF NOT EXISTS ventas_comision_pagada_idx
  ON ventas(organization_id, vendedor_id, comision_pagada, created_at);

-- ========================================
-- Trigger: snapshot automático al crear la venta
-- ========================================
-- Si el INSERT no trae porcentaje_comision (NULL), se copia del vendedor
-- asignado. Si el caller lo setea explícitamente, se respeta ese valor.
CREATE OR REPLACE FUNCTION snapshot_porcentaje_comision_venta()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.porcentaje_comision IS NULL AND NEW.vendedor_id IS NOT NULL THEN
    SELECT porcentaje_comision
      INTO NEW.porcentaje_comision
      FROM users
      WHERE id = NEW.vendedor_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ventas_snapshot_comision ON ventas;
CREATE TRIGGER ventas_snapshot_comision
  BEFORE INSERT ON ventas
  FOR EACH ROW
  EXECUTE FUNCTION snapshot_porcentaje_comision_venta();

-- ========================================
-- Vista: comisiones calculadas por venta
-- ========================================
-- monto_comision = total * porcentaje_comision / 100
-- Solo expone ventas COMPLETADA (ANULADA no devenga comisión).
CREATE OR REPLACE VIEW v_comisiones_ventas AS
SELECT
  v.id AS venta_id,
  v.organization_id,
  v.vendedor_id,
  v.numero_venta,
  v.cliente_nombre,
  v.estado,
  v.created_at,
  v.total,
  COALESCE(v.porcentaje_comision, 0)::DECIMAL(5,2) AS porcentaje_comision,
  ROUND(
    v.total * COALESCE(v.porcentaje_comision, 0) / 100,
    2
  )::DECIMAL(10,2) AS monto_comision,
  v.comision_pagada,
  v.fecha_pago_comision,
  v.comision_pago_notas
FROM ventas v
WHERE v.estado = 'COMPLETADA';

COMMENT ON COLUMN ventas.porcentaje_comision IS 'Snapshot del % del vendedor al momento de la venta (seteado por trigger). NULL en ventas previas a esta migración.';
COMMENT ON COLUMN ventas.comision_pagada IS 'Marca si la comisión de esta venta ya fue liquidada al vendedor';
COMMENT ON VIEW v_comisiones_ventas IS 'Comisiones devengadas por venta. Solo ventas COMPLETADA. Cálculo: total * % / 100';
