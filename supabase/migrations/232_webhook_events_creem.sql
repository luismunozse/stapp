-- Permitir 'CREEM' como provider en el log de webhooks.
-- El CHECK original (094) solo aceptaba MERCADOPAGO/REBILL, así que los eventos
-- de Creem fallaban al insertarse en webhook_events: beginWebhookEvent traga el
-- error y sigue, por eso el pago se registraba pero el evento no quedaba auditado.
ALTER TABLE webhook_events DROP CONSTRAINT IF EXISTS webhook_events_provider_check;
ALTER TABLE webhook_events ADD CONSTRAINT webhook_events_provider_check
  CHECK (provider IN ('MERCADOPAGO', 'REBILL', 'CREEM'));
