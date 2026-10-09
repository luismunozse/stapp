-- Migration 342: bases de las notas de credito unificadas.
--
-- Spec: docs/superpowers/specs/2026-10-07-notas-de-credito-design.md
-- Plan: docs/superpowers/plans/2026-10-07-notas-credito-pr1-bases.md (PR1b)
--
-- Un documento ("Nota de credito", numerada NC-), dos motores: las ventas
-- siguen en devoluciones_venta y las ordenes en notas_credito. Esta migracion
-- solo prepara el esquema. Ningun flujo escribe todavia las columnas nuevas,
-- asi que todo lo que ya existe se comporta igual.
--
--   1. devoluciones_venta: modo (ITEMS/MONTO), motivo del catalogo y anulacion.
--   2. notas_credito: modo, reparto entre deuda y reintegro, idempotencia. Pasa
--      a ser SOLO de ordenes, y una orden con NC no se puede borrar.
--   3. items_nota_credito: repuesto de la orden y deposito.
--   4. Catalogo de motivos compartido, con TRABAJO_NO_REALIZADO.
--
-- Sin BEGIN/COMMIT: db-run.mjs envuelve el archivo en una transaccion y por
-- default la revierte. Un BEGIN aca haria que `npm run db:dry` lo ejecute tal
-- cual y lo COMMITEE.
--
-- Antes de aplicarla: pre-flight del plan (Tarea 2). El bloque 0 aborta si
-- quedan NC de ventas.

-- ── 0. Ninguna NC de venta ─────────────────────────────────────────────────
-- Solo pudieron crearse por API (el dialogo de NC esta unicamente en la
-- orden). El CHECK de la seccion 2 las rechazaria igual; asi el error dice
-- que pasa.
DO $$
DECLARE
  v_con_venta INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_con_venta FROM notas_credito WHERE venta_id IS NOT NULL;
  IF v_con_venta > 0 THEN
    RAISE EXCEPTION 'Abort: % nota(s) de credito con venta_id. Resolverlas antes de aplicar la 342.', v_con_venta;
  END IF;
END $$;

-- ── 1. devoluciones_venta ──────────────────────────────────────────────────
-- Las filas existentes quedan ITEMS (toda devolucion hasta hoy fue por items),
-- sin motivo de catalogo (`motivo` sigue como detalle libre) y activas.
-- Defaults constantes: no reescriben la tabla.
ALTER TABLE devoluciones_venta
  ADD COLUMN IF NOT EXISTS modo           TEXT NOT NULL DEFAULT 'ITEMS',
  ADD COLUMN IF NOT EXISTS motivo_nc      TEXT,
  ADD COLUMN IF NOT EXISTS anulada        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS anulada_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS anulada_por    TEXT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS anulada_motivo TEXT;

-- motivo_nc NULL pasa el CHECK: es el historial sin motivo de catalogo.
ALTER TABLE devoluciones_venta
  ADD CONSTRAINT devoluciones_venta_modo_check CHECK (modo IN ('ITEMS', 'MONTO')),
  ADD CONSTRAINT devoluciones_venta_motivo_nc_check CHECK (motivo_nc IN (
    'DEVOLUCION', 'AJUSTE_PRECIO', 'GARANTIA', 'ERROR_FACTURACION',
    'DESCUENTO_RETRO', 'TRABAJO_NO_REALIZADO', 'OTRO'
  ));

CREATE INDEX IF NOT EXISTS devoluciones_venta_venta_activa_idx
  ON devoluciones_venta (venta_id) WHERE anulada = false;

COMMENT ON COLUMN devoluciones_venta.modo IS
  'ITEMS: devuelve mercaderia (monto calculado). MONTO: credito por un importe, sin tocar stock. Migracion 342.';
COMMENT ON COLUMN devoluciones_venta.motivo_nc IS
  'Motivo del catalogo de notas de credito (mismo CHECK que notas_credito.motivo). NULL en el historial; motivo queda como detalle libre. Migracion 342.';
COMMENT ON COLUMN devoluciones_venta.anulada IS
  'NC anulada: queda visible y su numero no se reusa. Todo consumidor de devoluciones_venta tiene que excluirlas. Migracion 342.';

-- ── 2. notas_credito ───────────────────────────────────────────────────────
-- modo DEFAULT 'MONTO': el dialogo actual de la orden nunca manda items, asi
-- que toda NC que cree crear_nota_credito hasta que se reescriba es por monto.
-- Las historicas con items se corrigen abajo.
ALTER TABLE notas_credito
  ADD COLUMN IF NOT EXISTS modo                 TEXT NOT NULL DEFAULT 'MONTO',
  ADD COLUMN IF NOT EXISTS monto_aplicado_deuda DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS idempotency_key      TEXT;

-- Reintegro = lo que no bajo deuda. Generada para que nunca se desfase: las NC
-- historicas y las del RPC actual (que no conoce el reparto) muestran el monto
-- entero como reintegro, que es lo que fueron.
ALTER TABLE notas_credito
  ADD COLUMN IF NOT EXISTS monto_reembolso DECIMAL(12,2)
    GENERATED ALWAYS AS (monto - monto_aplicado_deuda) STORED;

UPDATE notas_credito nc
SET modo = 'ITEMS'
WHERE EXISTS (SELECT 1 FROM items_nota_credito i WHERE i.nota_credito_id = nc.id);

ALTER TABLE notas_credito
  ADD CONSTRAINT notas_credito_modo_check CHECK (modo IN ('ITEMS', 'MONTO')),
  ADD CONSTRAINT notas_credito_aplicado_check
    CHECK (monto_aplicado_deuda >= 0 AND monto_aplicado_deuda <= monto);

CREATE UNIQUE INDEX IF NOT EXISTS notas_credito_idempotency_key_unique
  ON notas_credito (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Catalogo de motivos: el de la 186 mas TRABAJO_NO_REALIZADO. Sin IF EXISTS a
-- proposito: si el nombre no es el del pre-flight, la migracion falla en vez de
-- dejar el CHECK viejo vivo al lado del nuevo.
ALTER TABLE notas_credito DROP CONSTRAINT notas_credito_motivo_check;
ALTER TABLE notas_credito ADD CONSTRAINT notas_credito_motivo_check CHECK (motivo IN (
  'DEVOLUCION', 'AJUSTE_PRECIO', 'GARANTIA', 'ERROR_FACTURACION',
  'DESCUENTO_RETRO', 'TRABAJO_NO_REALIZADO', 'OTRO'
));

-- Solo de ordenes. Reemplaza el "venta XOR orden" de la 186: lo que se
-- acredita sobre una venta es una devolucion (devoluciones_venta).
ALTER TABLE notas_credito DROP CONSTRAINT notas_credito_check;
ALTER TABLE notas_credito ADD CONSTRAINT notas_credito_solo_ordenes
  CHECK (orden_id IS NOT NULL AND venta_id IS NULL);

-- Una orden con NC no se borra. Con SET NULL el borrado ya fallaba (violaba el
-- CHECK de arriba) con un error que no decia por que. Borrar el taller entero
-- sigue andando: la cascada desde organizations se lleva las NC en la misma
-- sentencia (probe 17).
ALTER TABLE notas_credito DROP CONSTRAINT notas_credito_orden_id_fkey;
ALTER TABLE notas_credito ADD CONSTRAINT notas_credito_orden_id_fkey
  FOREIGN KEY (orden_id) REFERENCES ordenes_servicio(id) ON DELETE RESTRICT;

COMMENT ON COLUMN notas_credito.monto_aplicado_deuda IS
  'Parte del monto que bajo el pendiente de la orden (pendiente_orden). Migracion 342.';
COMMENT ON COLUMN notas_credito.monto_reembolso IS
  'Generada: monto - monto_aplicado_deuda, lo que se le devolvio al cliente. Migracion 342.';
COMMENT ON COLUMN notas_credito.venta_id IS
  'Solo historial: desde la 342 las NC de ventas viven en devoluciones_venta (CHECK notas_credito_solo_ordenes).';

-- ── 3. items_nota_credito ──────────────────────────────────────────────────
ALTER TABLE items_nota_credito
  ADD COLUMN IF NOT EXISTS repuesto_orden_id TEXT REFERENCES repuestos_orden(id),
  ADD COLUMN IF NOT EXISTS deposito_id       TEXT REFERENCES depositos(id);

COMMENT ON COLUMN items_nota_credito.item_venta_id IS
  'Solo historial: desde la 342 las NC son de ordenes (repuesto_orden_id).';
