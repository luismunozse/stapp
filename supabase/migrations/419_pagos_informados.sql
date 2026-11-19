-- 419: pagos informados por el cliente desde la página de seguimiento.
--
-- Cuando la orden está reparada y tiene saldo, el cliente puede avisar desde
-- /seguimiento/[token] que pagó (transferencia o Mercado Pago, con comprobante)
-- o que va a pagar en efectivo al retirar. Eso NO es un cobro: queda PENDIENTE
-- hasta que el taller lo confirma (y recién ahí se registra el cobro por el
-- mismo camino que el botón "Cobrar": registrar_cobros_orden_atomica) o lo
-- rechaza.
--
-- El comprobante va al bucket privado comprobantes-gastos, bajo
-- <organization_id>/pagos-informados/<orden_id>/: la baja de cuenta ya purga
-- ese bucket por el prefijo de la organización.
--
-- Aditiva: tabla nueva. Solo service_role (RLS activo y sin políticas), igual
-- que el resto de las tablas que se leen y escriben desde las rutas.

SET LOCAL lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS public.pagos_informados (
  id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id   TEXT        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  orden_id          TEXT        NOT NULL REFERENCES public.ordenes_servicio(id) ON DELETE CASCADE,
  metodo            TEXT        NOT NULL CHECK (metodo IN ('TRANSFERENCIA', 'MERCADOPAGO', 'EFECTIVO')),
  monto             NUMERIC(14, 2) NOT NULL CHECK (monto > 0),
  comprobante_path  TEXT,
  nota              TEXT        CHECK (nota IS NULL OR char_length(nota) <= 300),
  estado            TEXT        NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'CONFIRMADO', 'RECHAZADO')),
  motivo_rechazo    TEXT        CHECK (motivo_rechazo IS NULL OR char_length(motivo_rechazo) <= 300),
  resuelto_por      TEXT        REFERENCES public.users(id) ON DELETE SET NULL,
  resuelto_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Transferencia y Mercado Pago siempre llegan con comprobante.
  CONSTRAINT pagos_informados_comprobante_check
    CHECK (metodo = 'EFECTIVO' OR comprobante_path IS NOT NULL)
);

-- Un solo aviso pendiente por orden: el cliente no puede apilar avisos
-- mientras el taller no resolvió el anterior (y dos envíos simultáneos chocan acá).
CREATE UNIQUE INDEX IF NOT EXISTS pagos_informados_orden_pendiente_uniq
  ON public.pagos_informados (orden_id) WHERE estado = 'PENDIENTE';

CREATE INDEX IF NOT EXISTS pagos_informados_orden_idx
  ON public.pagos_informados (orden_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pagos_informados_org_pendiente_idx
  ON public.pagos_informados (organization_id) WHERE estado = 'PENDIENTE';

ALTER TABLE public.pagos_informados ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pagos_informados FROM anon, authenticated;

COMMENT ON TABLE public.pagos_informados IS
  'Pagos que el cliente avisa desde el seguimiento público. No son cobros: '
  'el taller los confirma (y ahí se registra el cobro) o los rechaza. Solo service_role.';

NOTIFY pgrst, 'reload schema';
