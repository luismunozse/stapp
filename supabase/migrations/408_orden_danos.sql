-- 408: diagrama de daños en la recepción (tabla orden_danos, columnas de configuración, triggers y RPC).
--
-- Reglas que viven en la base (spec 2026-11-12-diagrama-danos-design.md):
--   1. Los pins 'recepcion' no admiten UPDATE ni DELETE (salvo el borrado en cascada de la orden).
--   2. Los pins 'recepcion' solo entran por registrar_estado_fisico_recepcion (variable de sesión
--      stapp.danos_recepcion), una sola vez y durante los 10 minutos siguientes a crear la orden.
--   3. Los pins 'diagnostico' se pueden borrar solo durante 10 minutos; nunca se editan.
--   4. No se insertan pins en órdenes entregadas o canceladas.
--   5. recepcion_sin_danos = true y pins 'recepcion' son excluyentes.
--   6. numero = max(numero) + 1 por orden, serializado con FOR UPDATE sobre la orden. Máximo 30 pins.
--
-- NOTA: ordenes_servicio no tiene created_at; la ventana de 10 minutos usa fecha_ingreso
-- (DEFAULT NOW(), ver 001_schema.sql y 068_mejoras_ordenes.sql).
-- Aditiva: tabla nueva y dos columnas con DEFAULT constante (sin reescritura de tabla en PG 11+).

-- ----------------------------------------------------------------------------
-- 1. Columnas de configuración
-- ----------------------------------------------------------------------------
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS danos_recepcion_obligatorio BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.ordenes_servicio
  ADD COLUMN IF NOT EXISTS recepcion_sin_danos BOOLEAN NOT NULL DEFAULT false;

-- ----------------------------------------------------------------------------
-- 2. Tabla
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orden_danos (
  id              TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  orden_id        TEXT NOT NULL REFERENCES ordenes_servicio(id) ON DELETE CASCADE,
  numero          INT NOT NULL,
  diagrama        TEXT NOT NULL,
  vista           TEXT NOT NULL CHECK (vista IN ('frente', 'dorso', 'lateral')),
  x               NUMERIC(5,4) NOT NULL CHECK (x >= 0 AND x <= 1),
  y               NUMERIC(5,4) NOT NULL CHECK (y >= 0 AND y <= 1),
  tipo            TEXT NOT NULL CHECK (tipo IN ('rayon', 'golpe', 'rotura', 'faltante', 'humedad', 'otro')),
  nota            TEXT CHECK (char_length(nota) <= 200),
  momento         TEXT NOT NULL CHECK (momento IN ('recepcion', 'diagnostico')),
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (orden_id, numero)
);

CREATE INDEX IF NOT EXISTS orden_danos_orden_idx ON public.orden_danos (orden_id);

ALTER TABLE public.orden_danos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS orden_danos_select ON public.orden_danos;
CREATE POLICY orden_danos_select ON public.orden_danos
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_organization_id());
DROP POLICY IF EXISTS orden_danos_all_service ON public.orden_danos;
CREATE POLICY orden_danos_all_service ON public.orden_danos
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.orden_danos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.orden_danos TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Triggers de orden_danos
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.orden_danos_before_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_estado TEXT;
  v_sin_danos BOOLEAN;
  v_org TEXT;
  v_total INT;
BEGIN
  -- Serializa a quienes agregan pins a la misma orden (numero y límite sin carreras).
  SELECT estado::text, recepcion_sin_danos, organization_id INTO v_estado, v_sin_danos, v_org
    FROM public.ordenes_servicio WHERE id = NEW.orden_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NEW; -- la FK a ordenes_servicio da el error
  END IF;

  -- Frontera de tenant: el pin pertenece a la organización de su orden.
  IF NEW.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'DANOS_ORDEN_NO_ENCONTRADA' USING ERRCODE = 'P0001';
  END IF;

  IF v_estado IN ('ENTREGADO', 'ENTREGADO_SIN_REPARACION', 'ENTREGADO_SIN_COBRO', 'CANCELADO') THEN
    RAISE EXCEPTION 'DANOS_ORDEN_CERRADA' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_total FROM public.orden_danos WHERE orden_id = NEW.orden_id;
  IF v_total >= 30 THEN
    RAISE EXCEPTION 'DANOS_LIMITE' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.momento = 'recepcion' THEN
    IF COALESCE(current_setting('stapp.danos_recepcion', true), '') <> 'on' THEN
      RAISE EXCEPTION 'DANOS_RECEPCION_INMUTABLE' USING ERRCODE = 'P0001';
    END IF;
    IF v_sin_danos THEN
      RAISE EXCEPTION 'DANOS_SIN_DANOS_CON_PINS' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Nadie elige created_at: de él depende la ventana de 10 minutos para borrar diagnóstico.
  NEW.created_at := now();
  NEW.numero := COALESCE((SELECT max(numero) FROM public.orden_danos WHERE orden_id = NEW.orden_id), 0) + 1;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS orden_danos_before_insert ON public.orden_danos;
CREATE TRIGGER orden_danos_before_insert
  BEFORE INSERT ON public.orden_danos
  FOR EACH ROW EXECUTE FUNCTION public.orden_danos_before_insert();

CREATE OR REPLACE FUNCTION public.orden_danos_before_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Única excepción: el ON DELETE SET NULL de users(id) pone created_by en NULL y nada más.
  IF NEW.created_by IS NULL AND OLD.created_by IS NOT NULL
     AND (to_jsonb(NEW) - 'created_by') = (to_jsonb(OLD) - 'created_by') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'DANOS_RECEPCION_INMUTABLE' USING ERRCODE = 'P0001';
END $$;

DROP TRIGGER IF EXISTS orden_danos_before_update ON public.orden_danos;
CREATE TRIGGER orden_danos_before_update
  BEFORE UPDATE ON public.orden_danos
  FOR EACH ROW EXECUTE FUNCTION public.orden_danos_before_update();

CREATE OR REPLACE FUNCTION public.orden_danos_before_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Borrado en cascada: la orden (o la organización, si su borrado llega primero a esta tabla)
  -- ya no existe, todo pasa.
  IF NOT EXISTS (SELECT 1 FROM public.ordenes_servicio WHERE id = OLD.orden_id)
     OR NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = OLD.organization_id) THEN
    RETURN OLD;
  END IF;

  IF OLD.momento = 'recepcion' THEN
    RAISE EXCEPTION 'DANOS_RECEPCION_INMUTABLE' USING ERRCODE = 'P0001';
  END IF;

  IF now() - OLD.created_at >= interval '10 minutes' THEN
    RAISE EXCEPTION 'DANOS_DIAGNOSTICO_FUERA_DE_VENTANA' USING ERRCODE = 'P0001';
  END IF;

  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS orden_danos_before_delete ON public.orden_danos;
CREATE TRIGGER orden_danos_before_delete
  BEFORE DELETE ON public.orden_danos
  FOR EACH ROW EXECUTE FUNCTION public.orden_danos_before_delete();

-- ----------------------------------------------------------------------------
-- 4. Trigger en ordenes_servicio: sin daños y con pins son excluyentes
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ordenes_servicio_sin_danos_check()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.recepcion_sin_danos AND NOT OLD.recepcion_sin_danos
     AND EXISTS (SELECT 1 FROM public.orden_danos WHERE orden_id = NEW.id AND momento = 'recepcion') THEN
    RAISE EXCEPTION 'DANOS_SIN_DANOS_CON_PINS' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ordenes_servicio_sin_danos_check ON public.ordenes_servicio;
CREATE TRIGGER ordenes_servicio_sin_danos_check
  BEFORE UPDATE OF recepcion_sin_danos ON public.ordenes_servicio
  FOR EACH ROW EXECUTE FUNCTION public.ordenes_servicio_sin_danos_check();

-- ----------------------------------------------------------------------------
-- 5. RPC atómico de recepción
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_estado_fisico_recepcion(
  p_orden_id TEXT,
  p_organization_id TEXT,
  p_danos JSONB,
  p_sin_danos BOOLEAN,
  p_user_id TEXT
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ingreso TIMESTAMPTZ;
  v_sin_danos BOOLEAN;
  v_danos JSONB := COALESCE(p_danos, '[]'::jsonb);
  v_insertados INT := 0;
BEGIN
  SELECT fecha_ingreso, recepcion_sin_danos INTO v_ingreso, v_sin_danos
    FROM ordenes_servicio
   WHERE id = p_orden_id AND organization_id = p_organization_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DANOS_ORDEN_NO_ENCONTRADA' USING ERRCODE = 'P0001';
  END IF;

  IF v_sin_danos OR EXISTS (SELECT 1 FROM orden_danos WHERE orden_id = p_orden_id AND momento = 'recepcion') THEN
    RAISE EXCEPTION 'DANOS_RECEPCION_YA_REGISTRADA' USING ERRCODE = 'P0001';
  END IF;

  IF v_ingreso IS NULL OR v_ingreso <= now() - interval '10 minutes' THEN
    RAISE EXCEPTION 'DANOS_RECEPCION_FUERA_DE_VENTANA' USING ERRCODE = 'P0001';
  END IF;

  IF p_sin_danos AND jsonb_array_length(v_danos) > 0 THEN
    RAISE EXCEPTION 'DANOS_SIN_DANOS_CON_PINS' USING ERRCODE = 'P0001';
  END IF;

  IF p_sin_danos THEN
    UPDATE ordenes_servicio SET recepcion_sin_danos = true WHERE id = p_orden_id;
    RETURN 0;
  END IF;

  PERFORM set_config('stapp.danos_recepcion', 'on', true);

  INSERT INTO orden_danos (organization_id, orden_id, diagrama, vista, x, y, tipo, nota, momento, created_by)
  SELECT p_organization_id, p_orden_id, e.el->>'diagrama', e.el->>'vista', (e.el->>'x')::numeric, (e.el->>'y')::numeric,
         e.el->>'tipo', NULLIF(btrim(e.el->>'nota'), ''), 'recepcion', p_user_id
    FROM jsonb_array_elements(v_danos) WITH ORDINALITY AS e(el, ord)
   ORDER BY e.ord;
  GET DIAGNOSTICS v_insertados = ROW_COUNT;

  -- Cierra la puerta: otro INSERT en esta misma transacción vuelve a quedar bloqueado.
  PERFORM set_config('stapp.danos_recepcion', 'off', true);
  RETURN v_insertados;
END $$;

REVOKE EXECUTE ON FUNCTION public.registrar_estado_fisico_recepcion(TEXT, TEXT, JSONB, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_estado_fisico_recepcion(TEXT, TEXT, JSONB, BOOLEAN, TEXT) TO service_role;
