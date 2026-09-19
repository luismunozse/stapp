-- ============================================================================
-- 328 · AUDITORIA (solo lectura): ordenes entregadas sin CARGO en cuenta corriente
-- ============================================================================
-- Correr ESTO ANTES del backfill. No modifica nada.
--
-- Muestra, por cada orden que el backfill va a tocar: cuanto se va a cargar,
-- a que cliente, con que fecha y a que sucursal queda atribuido. Si algo de
-- esto no cierra, NO correr el backfill.
--
-- La ultima columna es la que mas importa: una orden sin sucursal_id genera un
-- CARGO sin sucursal, y get_deuda_cliente_sucursal filtra por sucursal cuando
-- se le pasa una. Ver la nota en el backfill.
-- ============================================================================

SELECT
  o.organization_id,
  cl.nombre                                                  AS cliente,
  o.codigo_orden,
  COALESCE(o.fecha_entrega, o.fecha_completado)              AS se_entrego,
  o.costo_final,
  COALESCE(o.descuento_cobro, 0)                             AS descuento,
  COALESCE(o.total_cobrado, 0)                               AS ya_cobrado,
  (COALESCE(o.costo_final,0)
   - COALESCE(o.descuento_cobro,0)
   - COALESCE(o.total_cobrado,0))                            AS se_va_a_cargar,
  COALESCE((
    SELECT SUM(cc.monto) FROM cuenta_corriente cc
    WHERE cc.referencia_tipo = 'ORDEN' AND cc.referencia_id = o.id AND cc.tipo = 'PAGO'
  ), 0)                                                      AS pagos_ya_imputados,
  cl.saldo_cuenta                                            AS saldo_actual_del_cliente,
  o.sucursal_id,
  CASE WHEN o.sucursal_id IS NULL
       THEN 'OJO: sin sucursal'
       ELSE 'ok' END                                         AS chequeo_sucursal
FROM ordenes_servicio o
JOIN clientes cl ON cl.id = o.cliente_id
WHERE o.estado::text IN ('ENTREGADO', 'ENTREGADO_SIN_REPARACION')
  AND o.cliente_id IS NOT NULL
  AND (COALESCE(o.costo_final,0)
       - COALESCE(o.descuento_cobro,0)
       - COALESCE(o.total_cobrado,0)) > 0.01
  AND NOT EXISTS (
    SELECT 1 FROM cuenta_corriente cc
    WHERE cc.referencia_tipo = 'ORDEN' AND cc.referencia_id = o.id AND cc.tipo = 'CARGO')
ORDER BY o.organization_id, cl.nombre, se_entrego;
