-- ========================================
-- ALERTAS PROACTIVAS DE STOCK BAJO
-- ========================================
-- Genera notificaciones in-app cuando el stock de un item cruza su umbral
-- (punto_reorden ?? stock_minimo ?? organizations.umbral_stock_bajo).
--
-- Anti-spam: usa inventario.stock_alert_sent_at como cooldown (24h). Se
-- limpia cuando el stock vuelve a superar el umbral, rearmando la alerta.
--
-- Dispara solo en disminuciones (stock_posterior < stock_anterior) — evita
-- avisar al crear el item por primera vez o en re-stock.

-- 1. Toggle por organización
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS notif_stock_bajo BOOLEAN NOT NULL DEFAULT true;

-- 2. Marca de cooldown por item
ALTER TABLE inventario
  ADD COLUMN IF NOT EXISTS stock_alert_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS inventario_stock_alert_sent_idx
  ON inventario(stock_alert_sent_at)
  WHERE stock_alert_sent_at IS NOT NULL;

-- 3. Trigger function: evalúa umbral y genera notificaciones para ADMINs
CREATE OR REPLACE FUNCTION notify_stock_bajo_on_movimiento()
RETURNS TRIGGER AS $$
DECLARE
  v_item RECORD;
  v_org RECORD;
  v_threshold INTEGER;
  v_should_notify BOOLEAN := false;
  v_title TEXT;
  v_body TEXT;
  v_action_url TEXT;
BEGIN
  -- Solo disminuciones reales de stock
  IF NEW.stock_posterior >= NEW.stock_anterior THEN
    RETURN NEW;
  END IF;

  -- Item + umbrales
  SELECT
    i.id, i.nombre, i.codigo, i.stock_minimo, i.punto_reorden,
    i.organization_id, i.stock_alert_sent_at, i.deleted_at
  INTO v_item
  FROM inventario i
  WHERE i.id = NEW.inventario_id;

  IF NOT FOUND OR v_item.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Toggle de organización + umbral global
  SELECT notif_stock_bajo, umbral_stock_bajo
  INTO v_org
  FROM organizations
  WHERE id = v_item.organization_id;

  IF NOT FOUND OR NOT COALESCE(v_org.notif_stock_bajo, true) THEN
    RETURN NEW;
  END IF;

  v_threshold := COALESCE(v_item.punto_reorden, v_item.stock_minimo, v_org.umbral_stock_bajo, 5);

  -- Rearm: si subió por encima del umbral, limpiar marca para próximo cruce
  IF NEW.stock_posterior > v_threshold THEN
    IF v_item.stock_alert_sent_at IS NOT NULL THEN
      UPDATE inventario SET stock_alert_sent_at = NULL WHERE id = v_item.id;
    END IF;
    RETURN NEW;
  END IF;

  -- Cooldown 24h: evita inundar el bell cuando hay muchas ventas seguidas
  v_should_notify := v_item.stock_alert_sent_at IS NULL
    OR v_item.stock_alert_sent_at < NOW() - INTERVAL '24 hours';

  IF NOT v_should_notify THEN
    RETURN NEW;
  END IF;

  -- Contenido: distinguir SIN_STOCK vs BAJO para urgencia visual
  IF NEW.stock_posterior = 0 THEN
    v_title := 'Sin stock: ' || v_item.nombre;
    v_body  := 'Código ' || v_item.codigo || ' quedó en 0. Reponer urgente.';
  ELSE
    v_title := 'Stock bajo: ' || v_item.nombre;
    v_body  := 'Quedan ' || NEW.stock_posterior || ' uds (umbral ' || v_threshold || '). Código ' || v_item.codigo || '.';
  END IF;

  v_action_url := '/inventario?bajoStock=true';

  -- Notificar a ADMIN de la organización
  INSERT INTO user_notifications (
    organization_id, user_id, title, body, type, icon, action_url
  )
  SELECT
    v_item.organization_id,
    u.id,
    v_title,
    v_body,
    'INVENTARIO_BAJO',
    'package',
    v_action_url
  FROM users u
  WHERE u.organization_id = v_item.organization_id
    AND u.rol = 'ADMIN'
    AND u.activo = true;

  -- Marcar cooldown
  UPDATE inventario SET stock_alert_sent_at = NOW() WHERE id = v_item.id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Nunca romper la operación principal por fallo del aviso
  RAISE WARNING 'notify_stock_bajo_on_movimiento error: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Trigger
DROP TRIGGER IF EXISTS movimientos_inv_notify_stock_bajo ON movimientos_inventario;
CREATE TRIGGER movimientos_inv_notify_stock_bajo
  AFTER INSERT ON movimientos_inventario
  FOR EACH ROW
  EXECUTE FUNCTION notify_stock_bajo_on_movimiento();
