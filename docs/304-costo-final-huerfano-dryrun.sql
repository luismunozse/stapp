-- =============================================================================
-- DRY-RUN: costo_final huérfano en órdenes anteriores a APROBADO
--
-- SOLO LECTURA. No modifica una sola fila. Correr en el SQL editor de Supabase
-- Studio y revisar los números ANTES de decidir si hace falta un backfill.
--
-- QUÉ BUSCA
--
-- Hasta la migración 303 la sincronización de servicios escribía siempre
-- costo_final, sin mirar el estado. Desde la 303, en RECIBIDO / EN_DIAGNOSTICO /
-- PRESUPUESTADO el campo vivo es `presupuesto`, así que esos costo_final quedaron
-- sin dueño: nada los actualiza y nada los borra.
--
-- La migración 304 los limpia sola, pero SOLO cuando la orden vuelve a tener
-- movimiento de líneas (necesita comparar contra la suma anterior para
-- distinguir el valor de la regla vieja de uno tipeado por una persona). Las
-- órdenes que ya se quedaron sin líneas no se curan solas: son las que este
-- dry-run cuenta.
--
-- POR QUÉ IMPORTA
--
-- Hoy ese número no mueve plata: get_deuda_cliente_sucursal (273) y el widget de
-- caja filtran estado IN ('REPARADO','ENTREGADO'). El riesgo es diferido — si la
-- orden avanza a REPARADO, ese costo_final pasa a ser lo que se le cobra al
-- cliente, con el precio de una línea que quizás ya no existe.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- (1) Universo: órdenes antes de APROBADO con costo_final cargado y sin cobros
-- ---------------------------------------------------------------------------
SELECT
  COUNT(*)                                              AS ordenes_afectadas,
  COUNT(DISTINCT o.organization_id)                     AS organizaciones,
  SUM(o.costo_final)                                    AS monto_total,
  MIN(o.costo_final)                                    AS monto_minimo,
  MAX(o.costo_final)                                    AS monto_maximo
FROM ordenes_servicio o
WHERE o.estado IN ('RECIBIDO', 'EN_DIAGNOSTICO', 'PRESUPUESTADO')
  AND o.costo_final IS NOT NULL
  AND COALESCE(o.total_cobrado, 0) = 0;

-- ---------------------------------------------------------------------------
-- (2) Desglose por estado y por si además tienen presupuesto cargado
--
-- Las que tienen presupuesto NULL son las más claras: el número quedó
-- únicamente en la columna equivocada. Las que tienen los dos cargados hay que
-- mirarlas de cerca — puede que alguien haya cargado el costo final a propósito.
-- ---------------------------------------------------------------------------
SELECT
  o.estado,
  CASE WHEN o.presupuesto IS NULL THEN 'sin presupuesto' ELSE 'con presupuesto' END AS tiene_presupuesto,
  COUNT(*)           AS ordenes,
  SUM(o.costo_final) AS monto
FROM ordenes_servicio o
WHERE o.estado IN ('RECIBIDO', 'EN_DIAGNOSTICO', 'PRESUPUESTADO')
  AND o.costo_final IS NOT NULL
  AND COALESCE(o.total_cobrado, 0) = 0
GROUP BY 1, 2
ORDER BY 1, 2;

-- ---------------------------------------------------------------------------
-- (3) Cuántas tienen todavía líneas de servicio
--
-- Las que SÍ tienen líneas se curan solas con la 304 en cuanto alguien agregue o
-- borre una. Las que tienen cero líneas son las que necesitarían el backfill.
-- ---------------------------------------------------------------------------
SELECT
  CASE WHEN COALESCE(s.lineas, 0) = 0 THEN 'sin lineas (no se cura sola)'
       ELSE 'con lineas (se cura al proximo movimiento)' END AS situacion,
  COUNT(*)           AS ordenes,
  SUM(o.costo_final) AS monto
FROM ordenes_servicio o
LEFT JOIN (
  SELECT orden_id, COUNT(*) AS lineas, SUM(cantidad * precio_unitario) AS suma
  FROM servicios_orden
  GROUP BY orden_id
) s ON s.orden_id = o.id
WHERE o.estado IN ('RECIBIDO', 'EN_DIAGNOSTICO', 'PRESUPUESTADO')
  AND o.costo_final IS NOT NULL
  AND COALESCE(o.total_cobrado, 0) = 0
GROUP BY 1
ORDER BY 1;

-- ---------------------------------------------------------------------------
-- (4) Cuántas tienen la huella de la regla vieja
--
-- costo_final que coincide con la suma de sus líneas actuales: casi con certeza
-- lo escribió la sincronización anterior a la 303, no una persona.
-- ---------------------------------------------------------------------------
SELECT
  CASE WHEN ABS(o.costo_final - COALESCE(s.suma, 0)) < 0.005
       THEN 'coincide con la suma de lineas (huella de la regla vieja)'
       ELSE 'no coincide (pudo cargarlo una persona)' END AS origen_probable,
  COUNT(*)           AS ordenes,
  SUM(o.costo_final) AS monto
FROM ordenes_servicio o
LEFT JOIN (
  SELECT orden_id, SUM(cantidad * precio_unitario) AS suma
  FROM servicios_orden
  GROUP BY orden_id
) s ON s.orden_id = o.id
WHERE o.estado IN ('RECIBIDO', 'EN_DIAGNOSTICO', 'PRESUPUESTADO')
  AND o.costo_final IS NOT NULL
  AND COALESCE(o.total_cobrado, 0) = 0
GROUP BY 1
ORDER BY 1;

-- ---------------------------------------------------------------------------
-- (5) El detalle, para mirar casos concretos antes de decidir
-- ---------------------------------------------------------------------------
SELECT
  o.numero_orden,
  o.estado,
  o.presupuesto,
  o.costo_final,
  COALESCE(s.lineas, 0) AS lineas_servicio,
  COALESCE(s.suma, 0)   AS suma_lineas,
  o.fecha_ingreso
FROM ordenes_servicio o
LEFT JOIN (
  SELECT orden_id, COUNT(*) AS lineas, SUM(cantidad * precio_unitario) AS suma
  FROM servicios_orden
  GROUP BY orden_id
) s ON s.orden_id = o.id
WHERE o.estado IN ('RECIBIDO', 'EN_DIAGNOSTICO', 'PRESUPUESTADO')
  AND o.costo_final IS NOT NULL
  AND COALESCE(o.total_cobrado, 0) = 0
ORDER BY o.costo_final DESC
LIMIT 50;
