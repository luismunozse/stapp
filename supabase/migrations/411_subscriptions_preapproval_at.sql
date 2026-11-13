-- 411: cuándo se autorizó la adhesión de débito automático vigente.
--
-- Problema: el barrido diario (cron subscription-sweep) pasa a PAST_DUE una
-- adhesión ACTIVE cuyo primer cobro nunca llegó. Para decidirlo contaba los
-- pagos exitosos de TODA la historia de la organización y medía los 12 días de
-- gracia desde subscriptions.created_at. La fila de suscripción es una por
-- organización y se reutiliza, así que:
--   * un pago viejo (otro plan, otra adhesión, un pago manual) dejaba la
--     adhesión nueva con el plan pago para siempre sin haber cobrado nunca;
--   * una organización vieja que adhiere hoy tenía la gracia ya vencida y se
--     podía bloquear esa misma noche, antes del primer cobro.
--
-- Cambio: columna con el momento de la autorización (la escribe el webhook de
-- MercadoPago al activar una adhesión nueva). El barrido mide la gracia desde
-- ahí y cuenta solo los pagos posteriores. Las filas existentes quedan en NULL
-- y el barrido cae a created_at, como hasta ahora.
--
-- Hay que aplicarla ANTES de desplegar el código: el webhook escribe la columna
-- y PostgREST rechaza el UPDATE entero si no existe.

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS mercadopago_preapproval_at timestamptz;

COMMENT ON COLUMN public.subscriptions.mercadopago_preapproval_at IS
  'Cuándo se autorizó la adhesión de débito automático vigente (mercadopago_preapproval_id). Desde ahí corre la gracia del primer cobro.';
