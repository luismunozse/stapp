-- ============================================================================
-- 327: los movimientos de caja se anulan, no se borran
-- ============================================================================
-- Hoy DELETE /api/caja/movimientos/[id] hace un delete fisico. No queda quien
-- lo borro, ni cuando, ni cuanto decia. Y el unico freno es que la sesion este
-- CERRADA: un movimiento cargado sin caja abierta (que el POST permite, con
-- sesion_caja_id NULL) se puede borrar para siempre, meses despues, cambiando
-- la ganancia de un mes ya reportado sin dejar rastro.
--
-- Esta migracion agrega el par de columnas para anular en vez de borrar. El
-- borrado fisico se saca en la capa de aplicacion (la ruta pasa a UPDATE) y
-- todos los lectores de movimientos_caja filtran anulado = FALSE.
--
-- POR QUE NOT NULL DEFAULT FALSE
--
-- Las filas historicas quedan como "no anuladas", que es exactamente lo que
-- son. Ningun lector cambia de resultado al aplicar esta migracion: el filtro
-- anulado = FALSE las incluye a todas. Es 100% aditiva.
--
-- ORDEN DE DESPLIEGUE
--
-- Migracion primero, codigo despues. Si el codigo llegara antes, el filtro
-- .eq("anulado", false) contra una columna inexistente devuelve error y los
-- reportes quedarian en cero. Al reves no pasa nada: la columna existe y
-- nadie la lee todavia.
-- ============================================================================

ALTER TABLE movimientos_caja
  ADD COLUMN IF NOT EXISTS anulado BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS anulado_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS anulado_por TEXT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS anulado_motivo TEXT;

-- ============================================================================
-- origen_tipo / origen_id: de donde salio un movimiento automatico
-- ============================================================================
-- Hasta ahora todo movimiento de caja era manual o venia de un gasto
-- recurrente (marcado con es_recurrente). Con el pago de comisiones generando
-- su propio egreso hacen falta dos cosas que es_recurrente no da:
--
--   1. Saber que un egreso NO es un gasto operativo que el dueno cargo a mano,
--      para que el Estado de Resultados no lo reste de nuevo (la comision ya
--      se resta devengada, cuando el trabajo se hizo).
--   2. Poder encontrar el movimiento cuando se revierte el pago.
--
-- Generico a proposito: el mismo par sirve para el dia que el pago a
-- proveedores o la diferencia de arqueo generen movimientos propios.
--
-- Valores usados hoy:
--   'COMISION_TECNICO'  -> egreso por pagar comisiones de ordenes
--   'COMISION_VENDEDOR' -> egreso por pagar comisiones de ventas
--
-- origen_id es el id de la PERSONA que cobra (tecnico o vendedor), no el de
-- una orden: un pago cubre varias ordenes de una. Por eso el pago genera un
-- movimiento por beneficiario y no uno solo por el total — en la caja se lee
-- "Pago de comisiones a Juan Perez" y se puede filtrar por quien cobro.
--
-- Queda NULL en el caso raro de una orden con comision pero sin tecnico
-- asignado: la plata salio igual y el movimiento tiene que existir.

ALTER TABLE movimientos_caja
  ADD COLUMN IF NOT EXISTS origen_tipo TEXT,
  ADD COLUMN IF NOT EXISTS origen_id TEXT;

-- Los lectores de caja (arqueo, listado del dia, reportes) siempre filtran por
-- org + fecha + anulado = FALSE. El indice parcial cubre ese camino exacto y
-- no crece con las filas anuladas.
CREATE INDEX IF NOT EXISTS idx_movimientos_caja_org_fecha_vigentes
  ON movimientos_caja(organization_id, fecha DESC)
  WHERE anulado = FALSE;

CREATE INDEX IF NOT EXISTS idx_movimientos_caja_origen
  ON movimientos_caja(origen_tipo, origen_id)
  WHERE origen_tipo IS NOT NULL;

-- ============================================================================
-- Vuelta atras del pago de comisiones
-- ============================================================================
-- "Marcar comision como pagada" se puede revertir (DELETE en las mismas rutas).
-- Si el pago genero un egreso de caja, revertirlo tiene que anular ese egreso,
-- o la plata queda saliendo dos veces del arqueo.
--
-- Guardar el id del movimiento en cada orden/venta es lo que permite encontrarlo
-- sin adivinar por concepto y fecha. Un movimiento cubre N ordenes, asi que la
-- ruta de reversion solo anula el movimiento cuando ya no queda ninguna orden
-- pagada apuntandole.

ALTER TABLE ordenes_servicio
  ADD COLUMN IF NOT EXISTS comision_pago_movimiento_id TEXT;

ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS comision_pago_movimiento_id TEXT;

CREATE INDEX IF NOT EXISTS idx_ordenes_comision_pago_mov
  ON ordenes_servicio(comision_pago_movimiento_id)
  WHERE comision_pago_movimiento_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ventas_comision_pago_mov
  ON ventas(comision_pago_movimiento_id)
  WHERE comision_pago_movimiento_id IS NOT NULL;

COMMENT ON COLUMN movimientos_caja.anulado IS
  'Los movimientos de plata no se borran. Anular conserva la fila y registra quien y cuando (mig 327).';
COMMENT ON COLUMN movimientos_caja.origen_tipo IS
  'Origen del movimiento automatico: COMISION_TECNICO | COMISION_VENDEDOR. NULL = cargado a mano (mig 327).';
COMMENT ON COLUMN movimientos_caja.origen_id IS
  'A quien se le pago: users.id del tecnico o vendedor. NULL si no habia beneficiario asignado (mig 327).';
