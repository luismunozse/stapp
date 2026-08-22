-- 305: un pago del proveedor = una fila. Y reparacion de los periodos inflados.
--
-- EL BUG
--
-- subscription_payments no tenia ninguna restriccion sobre provider_payment_id:
-- la 006 creo un INDEX comun (006_saas_schema.sql:125), no un UNIQUE. El webhook
-- de MercadoPago chequea duplicados con un SELECT y despues inserta
-- (app/api/mercadopago/webhook/route.ts:344). MercadoPago manda varias
-- notificaciones del mismo pago casi simultaneas: las tres leen antes de que
-- ninguna commitee, ninguna encuentra nada, y las tres insertan.
--
-- Caso real que lo destapo (Romemaq, 19/08/2026): tres filas con el mismo
-- provider_payment_id 174586824094, creadas en 460 milisegundos.
--
-- Es la misma clase de carrera que la migracion 301 arreglo en los servicios, y
-- se cierra igual: la regla va en el motor, no repetida en cada llamador.
--
-- POR QUE NO ES SOLO RUIDO
--
-- Cuando la notificacion duplicada llega despues de que la suscripcion ya quedo
-- ACTIVE, el calculo del periodo (webhook/route.ts:441-447) arranca desde
-- current_period_end en vez de hoy y APILA otro mes. El upsert lo gana el ultimo
-- que commitea, asi que la suscripcion queda con el periodo inflado. Se cobro un
-- mes y se entregaron dos.
--
-- ORDEN DE ESTE ARCHIVO (no reordenar)
--
--   (1) Reparar las suscripciones. Necesita que las filas duplicadas TODAVIA
--       existan para poder identificar cual periodo salio de un duplicado.
--   (2) Borrar las filas duplicadas.
--   (3) Crear el UNIQUE, que solo puede existir una vez limpios los datos.
--
-- ANTES DE APLICAR: correr docs/305-pagos-duplicados-dryrun.sql y avisarle a las
-- organizaciones de su consulta (4). Se les adelanta la fecha de vencimiento y
-- no hicieron nada mal.

-- ============================================================
-- (1) Reparar los periodos inflados
-- ============================================================
--
-- Se corrige SOLO la suscripcion cuyo periodo actual coincide EXACTAMENTE con el
-- de una fila duplicada que se va a borrar. Si la organizacion pago de nuevo
-- despues del incidente, su periodo viene de ese pago legitimo, no coincide, y
-- queda intacta. Sin ese predicado estariamos pisando cobros posteriores.
WITH grupos AS (
  SELECT
    sp.id,
    sp.organization_id,
    sp.payment_provider,
    sp.provider_payment_id,
    sp.period_start,
    sp.period_end,
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
UPDATE subscriptions s
SET current_period_start = c.period_start,
    current_period_end   = c.period_end
FROM duplicada d
JOIN conservada c
  ON c.organization_id     = d.organization_id
 AND c.payment_provider    = d.payment_provider
 AND c.provider_payment_id = d.provider_payment_id
WHERE s.organization_id      = d.organization_id
  AND s.current_period_start = d.period_start
  AND s.current_period_end   = d.period_end
  AND c.period_start IS NOT NULL
  AND c.period_end   IS NOT NULL;

-- ============================================================
-- (2) Borrar las filas duplicadas, conservando la primera
-- ============================================================
--
-- Se conserva la de created_at mas antiguo: es la que gano la carrera y la que
-- tiene el periodo correcto (arranca en la fecha del pago, no apilado).
DELETE FROM subscription_payments sp
USING (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY payment_provider, provider_payment_id
      ORDER BY created_at ASC
    ) AS orden
  FROM subscription_payments
  WHERE provider_payment_id IS NOT NULL
) g
WHERE sp.id = g.id
  AND g.orden > 1;

-- ============================================================
-- (3) La restriccion que hace imposible la carrera
-- ============================================================
--
-- Parcial porque provider_payment_id es nullable: los pagos MANUAL cargados a
-- mano no traen id del proveedor y no deben chocar entre si.
--
-- Por (payment_provider, provider_payment_id) y no solo por el id: son espacios
-- de identificadores independientes (MercadoPago, Creem, Rebill) y nada impide
-- que dos proveedores emitan el mismo numero.
CREATE UNIQUE INDEX IF NOT EXISTS subscription_payments_provider_payment_uniq
  ON subscription_payments (payment_provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

COMMENT ON INDEX subscription_payments_provider_payment_uniq IS
  'Un pago del proveedor = una fila. El chequeo por SELECT del webhook no alcanza: MercadoPago manda notificaciones concurrentes del mismo pago y todas leen antes de que alguna commitee (ver migracion 305).';
