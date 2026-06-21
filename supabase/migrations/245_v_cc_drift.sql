-- Migration 245: vista de reconciliación de cuenta corriente (v_cc_drift)
-- ============================================================
-- Bug F (auditoría cuenta corriente): varios flujos (entrega, devolución, fiado)
-- toleran fallos de CC de forma no-fatal y solo loguean a consola → el ledger
-- puede quedar descuadrado sin que nadie se entere.
--
-- Esta vista DETECTA el drift comparando el estado de los documentos contra el
-- ledger, sin importar la causa (falla no-fatal, SQL directo, código futuro).
-- Es pull-based: consultarla periódicamente (cron/dashboard superadmin) y
-- resolver a mano lo que aparezca. No modifica los flujos de plata.
--
-- Cada fila: tipo_drift + cliente + referencia + valor_documento vs valor_ledger
-- + diferencia. Todas las comparaciones de tipos usan ::text para no depender de
-- si la columna es enum o text. Tolerancia de 0.01 para ruido de redondeo.
--
-- NOTA: aplicar a mano en el SQL editor de Supabase (sin runner CLI).

CREATE OR REPLACE VIEW v_cc_drift AS

-- 1. SALDO_DESCUADRADO: el saldo denormalizado (clientes.saldo_cuenta) no coincide
--    con la suma de los movimientos del ledger. Invariante canónico: toda
--    operación de CC actualiza ambos atómicamente; si divergen, algo escribió uno
--    sin el otro (o una falla parcial de un flujo no atómico).
SELECT
  'SALDO_DESCUADRADO'::text                    AS tipo_drift,
  c.organization_id,
  c.id                                         AS cliente_id,
  c.nombre                                     AS cliente_nombre,
  NULL::text                                   AS referencia_tipo,
  NULL::text                                   AS referencia_id,
  COALESCE(c.saldo_cuenta, 0)                  AS valor_documento,
  COALESCE(cc.suma, 0)                         AS valor_ledger,
  COALESCE(c.saldo_cuenta, 0) - COALESCE(cc.suma, 0) AS diferencia
FROM clientes c
LEFT JOIN (
  SELECT cliente_id, SUM(monto) AS suma
  FROM cuenta_corriente
  GROUP BY cliente_id
) cc ON cc.cliente_id = c.id
WHERE ABS(COALESCE(c.saldo_cuenta, 0) - COALESCE(cc.suma, 0)) > 0.01

UNION ALL

-- 2. ORDEN_ENTREGADA_SIN_CARGO: orden entregada con saldo pendiente pero sin
--    movimiento CARGO en el ledger → el fiado nunca se registró (típicamente un
--    cargar_deuda_cuenta_corriente que falló de forma no-fatal en la entrega).
SELECT
  'ORDEN_ENTREGADA_SIN_CARGO'::text,
  o.organization_id,
  o.cliente_id,
  cl.nombre,
  'ORDEN'::text,
  o.id,
  (COALESCE(o.costo_final, 0) - COALESCE(o.descuento_cobro, 0) - COALESCE(o.total_cobrado, 0)) AS valor_documento,
  0::numeric AS valor_ledger,
  (COALESCE(o.costo_final, 0) - COALESCE(o.descuento_cobro, 0) - COALESCE(o.total_cobrado, 0)) AS diferencia
FROM ordenes_servicio o
LEFT JOIN clientes cl ON cl.id = o.cliente_id
WHERE o.estado::text IN ('ENTREGADO', 'ENTREGADO_SIN_REPARACION')
  AND o.cliente_id IS NOT NULL
  AND (COALESCE(o.costo_final, 0) - COALESCE(o.descuento_cobro, 0) - COALESCE(o.total_cobrado, 0)) > 0.01
  AND NOT EXISTS (
    SELECT 1 FROM cuenta_corriente cc
    WHERE cc.referencia_tipo = 'ORDEN' AND cc.referencia_id = o.id AND cc.tipo::text = 'CARGO'
  )

UNION ALL

-- 3. VENTA_PENDIENTE_SIN_CARGO: venta no anulada con saldo pendiente pero sin
--    CARGO en el ledger → el fiado de la venta no se registró.
SELECT
  'VENTA_PENDIENTE_SIN_CARGO'::text,
  v.organization_id,
  v.cliente_id,
  cl.nombre,
  'VENTA'::text,
  v.id,
  (COALESCE(v.total, 0) - COALESCE(v.monto_abonado, 0)) AS valor_documento,
  0::numeric AS valor_ledger,
  (COALESCE(v.total, 0) - COALESCE(v.monto_abonado, 0)) AS diferencia
FROM ventas v
LEFT JOIN clientes cl ON cl.id = v.cliente_id
WHERE v.estado::text <> 'ANULADA'
  AND v.cliente_id IS NOT NULL
  AND (COALESCE(v.total, 0) - COALESCE(v.monto_abonado, 0)) > 0.01
  AND NOT EXISTS (
    SELECT 1 FROM cuenta_corriente cc
    WHERE cc.referencia_tipo = 'VENTA' AND cc.referencia_id = v.id AND cc.tipo::text = 'CARGO'
  )

UNION ALL

-- 4. DEVOLUCION_CC_SIN_CREDITO: devolución completada con reembolso a cuenta
--    corriente pero sin movimiento DEVOLUCION en el ledger → el crédito al cliente
--    nunca se aplicó (devolver_cuenta_corriente que falló de forma no-fatal).
--    Granularidad por venta: si hubo varias devoluciones a CC sobre la misma venta
--    y existe al menos un DEVOLUCION, no se marca (conservador: evita falsos
--    positivos a costa de posibles falsos negativos).
SELECT
  'DEVOLUCION_CC_SIN_CREDITO'::text,
  dv.organization_id,
  v.cliente_id,
  cl.nombre,
  'VENTA'::text,
  dv.venta_id,
  dv.monto_devolucion AS valor_documento,
  0::numeric AS valor_ledger,
  dv.monto_devolucion AS diferencia
FROM devoluciones_venta dv
JOIN ventas v ON v.id = dv.venta_id
LEFT JOIN clientes cl ON cl.id = v.cliente_id
WHERE dv.estado::text = 'COMPLETADA'
  AND dv.metodo_reembolso::text = 'CUENTA_CORRIENTE'
  AND v.cliente_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM cuenta_corriente cc
    WHERE cc.referencia_tipo = 'VENTA' AND cc.referencia_id = dv.venta_id AND cc.tipo::text = 'DEVOLUCION'
  );

COMMENT ON VIEW v_cc_drift IS
  'Reconciliación de cuenta corriente: detecta drift entre documentos y ledger. '
  'tipo_drift: SALDO_DESCUADRADO (saldo_cuenta vs suma de movimientos), '
  'ORDEN_ENTREGADA_SIN_CARGO, VENTA_PENDIENTE_SIN_CARGO, DEVOLUCION_CC_SIN_CREDITO. '
  'Pull-based: consultar por organization_id. Migración 245 (bug F auditoría CC).';
