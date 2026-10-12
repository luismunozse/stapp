-- =============================================================================
-- DRY-RUN: pagos de suscripción duplicados y períodos inflados
--
-- SOLO LECTURA. No modifica una sola fila. Correr en el SQL editor de Supabase
-- Studio y revisar los números ANTES de aplicar la migración 305.
--
-- QUÉ PASÓ
--
-- `subscription_payments` no tiene ninguna restricción sobre provider_payment_id.
-- El webhook de MercadoPago chequea duplicados con un SELECT y después inserta
-- (app/api/mercadopago/webhook/route.ts:344). MercadoPago manda varias
-- notificaciones del mismo pago casi simultáneas: las tres leen antes de que
-- ninguna commitee, ninguna encuentra nada, y las tres insertan.
--
-- Caso real (Romemaq, 19/08/2026): tres filas con el mismo provider_payment_id
-- 174586824094, creadas en 460 milisegundos.
--
-- POR QUÉ CUESTA PLATA
--
-- No es solo ruido en el historial. Cuando la notificación duplicada llega
-- después de que la suscripción ya quedó ACTIVE, el cálculo del período
-- (webhook/route.ts:441-447) arranca desde current_period_end en vez de hoy, y
-- APILA otro mes. Se cobró uno, se entregaron dos.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- (1) Grupos duplicados: mismo proveedor, mismo id de pago, más de una fila
-- ---------------------------------------------------------------------------
SELECT
  o.nombre                        AS organizacion,
  sp.payment_provider,
  sp.provider_payment_id,
  COUNT(*)                        AS filas,
  COUNT(*) - 1                    AS filas_de_mas,
  MAX(sp.amount)                  AS monto,
  MIN(sp.created_at)              AS primera,
  MAX(sp.created_at)              AS ultima,
  MAX(sp.created_at) - MIN(sp.created_at) AS ventana
FROM subscription_payments sp
JOIN organizations o ON o.id = sp.organization_id
WHERE sp.provider_payment_id IS NOT NULL
GROUP BY o.nombre, sp.payment_provider, sp.provider_payment_id
HAVING COUNT(*) > 1
ORDER BY filas DESC, ultima DESC;

-- ---------------------------------------------------------------------------
-- (2) Resumen del daño
--
-- `filas_de_mas` es cuánto infla el historial y el MRR.
-- `meses_regalados` cuenta solo las filas duplicadas que ADEMÁS apilaron
-- período (su period_start difiere del de la fila que se conserva).
-- ---------------------------------------------------------------------------
WITH grupos AS (
  SELECT
    sp.*,
    ROW_NUMBER() OVER (
      PARTITION BY sp.payment_provider, sp.provider_payment_id
      ORDER BY sp.created_at ASC
    ) AS orden,
    FIRST_VALUE(sp.period_start) OVER (
      PARTITION BY sp.payment_provider, sp.provider_payment_id
      ORDER BY sp.created_at ASC
    ) AS period_start_conservado
  FROM subscription_payments sp
  WHERE sp.provider_payment_id IS NOT NULL
    AND (sp.payment_provider, sp.provider_payment_id) IN (
      SELECT payment_provider, provider_payment_id
      FROM subscription_payments
      WHERE provider_payment_id IS NOT NULL
      GROUP BY payment_provider, provider_payment_id
      HAVING COUNT(*) > 1
    )
)
SELECT
  COUNT(*) FILTER (WHERE orden > 1)                       AS filas_a_borrar,
  COUNT(DISTINCT organization_id)                          AS organizaciones,
  SUM(amount) FILTER (WHERE orden > 1)                     AS monto_inflado_en_reportes,
  COUNT(*) FILTER (
    WHERE orden > 1 AND period_start IS DISTINCT FROM period_start_conservado
  )                                                        AS meses_regalados
FROM grupos;

-- ---------------------------------------------------------------------------
-- (3) Suscripciones que la migración 305 va a corregir
--
-- Solo se tocan aquellas cuyo período ACTUAL coincide exactamente con el de una
-- fila duplicada que se va a borrar. Si una organización pagó de nuevo después
-- del incidente, su período viene de ese pago legítimo, no coincide, y queda
-- intacta.
-- ---------------------------------------------------------------------------
WITH grupos AS (
  SELECT
    sp.*,
    ROW_NUMBER() OVER (
      PARTITION BY sp.payment_provider, sp.provider_payment_id
      ORDER BY sp.created_at ASC
    ) AS orden
  FROM subscription_payments sp
  WHERE sp.provider_payment_id IS NOT NULL
),
conservada AS (
  SELECT organization_id, payment_provider, provider_payment_id, period_start, period_end
  FROM grupos WHERE orden = 1
),
duplicada AS (
  SELECT organization_id, payment_provider, provider_payment_id, period_start, period_end
  FROM grupos WHERE orden > 1
)
SELECT
  o.nombre                    AS organizacion,
  s.status,
  s.current_period_start      AS desde_actual,
  s.current_period_end        AS hasta_actual,
  c.period_start              AS desde_corregido,
  c.period_end                AS hasta_corregido,
  s.current_period_end - c.period_end AS tiempo_que_se_recorta
FROM subscriptions s
JOIN organizations o ON o.id = s.organization_id
JOIN duplicada d
  ON d.organization_id = s.organization_id
 AND s.current_period_start = d.period_start
 AND s.current_period_end   = d.period_end
JOIN conservada c
  ON c.organization_id = d.organization_id
 AND c.payment_provider = d.payment_provider
 AND c.provider_payment_id = d.provider_payment_id
ORDER BY tiempo_que_se_recorta DESC;

-- ---------------------------------------------------------------------------
-- (4) A quiénes hay que avisarles ANTES
--
-- Estas son las organizaciones a las que se les va a adelantar la fecha de
-- vencimiento. No hicieron nada mal: les tocó un bug nuestro. Merecen el aviso
-- antes de ver la fecha cambiada.
-- ---------------------------------------------------------------------------
WITH grupos AS (
  SELECT
    sp.*,
    ROW_NUMBER() OVER (
      PARTITION BY sp.payment_provider, sp.provider_payment_id
      ORDER BY sp.created_at ASC
    ) AS orden
  FROM subscription_payments sp
  WHERE sp.provider_payment_id IS NOT NULL
)
SELECT DISTINCT
  o.nombre,
  o.email,
  o.telefono,
  s.current_period_end AS vencimiento_que_ve_hoy
FROM subscriptions s
JOIN organizations o ON o.id = s.organization_id
JOIN grupos d
  ON d.organization_id = s.organization_id
 AND d.orden > 1
 AND s.current_period_start = d.period_start
 AND s.current_period_end   = d.period_end
ORDER BY o.nombre;
