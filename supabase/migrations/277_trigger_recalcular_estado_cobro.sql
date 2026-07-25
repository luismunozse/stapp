-- 277: Trigger de integridad para estado_cobro / total_cobrado
--
-- PROBLEMA
-- costo_final se escribe desde ~10 lugares y solo uno (app/api/ordenes/route.ts:464)
-- llama a recalcular_estado_cobro. Los otros dejan estado_cobro y total_cobrado
-- desactualizados:
--   - app/api/ordenes/[id]/route.ts:282 (PUT genérico)
--   - lib/cotizacion-aprobar-orden.ts:82
--   - app/api/public/ordenes/[token]/approve-budget/route.ts:64  <-- endpoint público
--   - app/api/public/ordenes/[token]/reject-budget/route.ts:41
--   - app/api/cotizaciones/route.ts:454
--   - app/api/cotizaciones/[id]/route.ts:84, 122, 141, 507, 634, 649
--   - app/api/cotizaciones/[id]/enviar/route.ts:155 (auto-transición a PRESUPUESTADO al enviar)
--
-- IMPACTO
--   - 273_deuda_solo_ordenes_cobrables.sql:56 filtra estado_cobro IN ('PENDIENTE','PARCIAL'),
--     así que una orden que quedó en COBRADO con saldo real desaparece de la deuda del cliente.
--   - app/api/comisiones/route.ts:57 filtra estado_cobro = 'COBRADO', así que esa misma
--     orden sí computa comisión, calculada sobre un ingreso que nunca entró.
--
-- SOLUCIÓN
-- La regla se mueve al motor. recalcular_estado_cobro (068_mejoras_ordenes.sql:100) ya es
-- idempotente y puro: deriva todo de cobros_orden + costo_final + descuento_cobro. No se
-- introduce una fuente de verdad nueva; se hace cumplir la que ya existe.
--
-- POR QUÉ NO HAY RECURSIÓN
-- El UPDATE anidado dentro de recalcular_estado_cobro (068:127-130) fija únicamente
-- total_cobrado y estado_cobro. En PostgreSQL, AFTER UPDATE OF <cols> dispara cuando la
-- columna aparece en la lista SET del statement; ninguna de las dos columnas del UPDATE OF
-- está ahí. La cláusula WHEN actúa como segunda guarda.
--
-- PRIVILEGIOS
-- Sin SECURITY DEFINER, igual que recalcular_estado_cobro (068:132). Todas las escrituras
-- de la app pasan por service_role.
--
-- ALCANCE
-- Esta migración NO modifica ninguna fila existente. La corrección de datos históricos
-- es la migración 278, y depende de revisar antes docs/dry-run-backfill-estado-cobro.sql.

CREATE OR REPLACE FUNCTION trg_recalcular_estado_cobro()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM recalcular_estado_cobro(NEW.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trg_recalcular_estado_cobro() IS
  'Mantiene estado_cobro y total_cobrado sincronizados ante cambios de costo_final o descuento_cobro. Ver migración 277.';

DROP TRIGGER IF EXISTS ordenes_recalcular_cobro ON ordenes_servicio;

CREATE TRIGGER ordenes_recalcular_cobro
  AFTER UPDATE OF costo_final, descuento_cobro ON ordenes_servicio
  FOR EACH ROW
  WHEN (
    OLD.costo_final     IS DISTINCT FROM NEW.costo_final OR
    OLD.descuento_cobro IS DISTINCT FROM NEW.descuento_cobro
  )
  EXECUTE FUNCTION trg_recalcular_estado_cobro();
