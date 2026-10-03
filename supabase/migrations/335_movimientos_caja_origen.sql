-- 335: movimientos_caja.origen
--
-- Problema: DELETE /api/caja/movimientos/[id] borraba cualquier fila, y la UI
-- muestra el boton de borrar en todas. Pero esta tabla tambien guarda filas
-- automaticas: el egreso de efectivo de una devolucion o nota de credito
-- (registrarEgresoCajaEfectivo), los gastos recurrentes materializados y el
-- viejo egreso de COGS. Borrar el egreso de una devolucion deja el reembolso
-- registrado pero saca la salida de efectivo: el arqueo muestra un sobrante
-- fantasma igual al monto devuelto.
--
-- Solucion: una columna que dice quien escribio la fila. El endpoint de borrado
-- bloquea las que no son MANUAL ni RECURRENTE.
--
-- Orden de despliegue: el codigo tolera la columna ausente (reintenta el insert
-- sin `origen` y detecta el origen por el prefijo del concepto), asi que esta
-- migracion puede aplicarse antes o despues del merge.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS y backfill acotado a origen = 'MANUAL'.

ALTER TABLE movimientos_caja
  ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'MANUAL';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'movimientos_caja_origen_check'
  ) THEN
    ALTER TABLE movimientos_caja
      ADD CONSTRAINT movimientos_caja_origen_check
      CHECK (origen IN ('MANUAL', 'DEVOLUCION', 'NOTA_CREDITO', 'RECURRENTE', 'COGS'));
  END IF;
END $$;

-- Backfill. Se matchea por prefijo de concepto ademas de la bandera: un
-- "Retiro de socio" manual tambien tiene afecta_rentabilidad = false y debe
-- seguir siendo MANUAL.
UPDATE movimientos_caja
   SET origen = 'RECURRENTE'
 WHERE origen = 'MANUAL' AND es_recurrente = true;

UPDATE movimientos_caja
   SET origen = 'DEVOLUCION'
 WHERE origen = 'MANUAL'
   AND tipo = 'EGRESO'
   AND afecta_rentabilidad = false
   AND concepto ~* '^\s*devoluci[oó]n\s';

UPDATE movimientos_caja
   SET origen = 'NOTA_CREDITO'
 WHERE origen = 'MANUAL'
   AND tipo = 'EGRESO'
   AND afecta_rentabilidad = false
   AND concepto ~* '^\s*nota de cr[eé]dito\s';

UPDATE movimientos_caja
   SET origen = 'COGS'
 WHERE origen = 'MANUAL'
   AND tipo = 'EGRESO'
   AND afecta_rentabilidad = false
   AND concepto ~* '^\s*costo de mercader';

COMMENT ON COLUMN movimientos_caja.origen IS
  'Quien escribio la fila: MANUAL (usuario desde caja), DEVOLUCION, NOTA_CREDITO, RECURRENTE o COGS (automaticas). El borrado desde caja bloquea DEVOLUCION, NOTA_CREDITO y COGS.';
