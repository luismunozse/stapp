-- ============================================================================
-- 323: el contador de tecnicos tiene que ver los cambios de rol
-- ============================================================================
-- `organization_usage.tecnicos_count` es el numero contra el que se enforza el
-- limite de tecnicos del plan (lib/subscriptions.ts). No es un COUNT(*) vivo:
-- es un contador cacheado que mantiene un trigger sobre `users`.
--
-- Ese trigger nunca vio los UPDATE. Quedo registrado en la 006 como:
--
--   CREATE TRIGGER trigger_tecnicos_count
--     AFTER INSERT OR DELETE ON users
--
-- y `update_tecnicos_count()` solo tiene ramas para TG_OP = 'INSERT' y
-- 'DELETE'. El gemelo de vendedores, en cambio, se rehizo en la 015 como
-- AFTER INSERT OR UPDATE OR DELETE y su funcion SI tiene la rama UPDATE, con
-- el chequeo de limite incluido. La asimetria no fue una decision: fue que
-- vendedores se escribio despues.
--
-- Mientras cambiar de rol fue imposible desde la app, no se notaba. Dejo de
-- serlo: `/api/superadmin/users/[userId]/change-role` cambia el rol de un
-- usuario existente, y la pantalla de "Roles y permisos" que viene atras de
-- esta migracion lo va a poner en manos del ADMIN de cada taller.
--
-- Con el trigger ciego a los UPDATE, cada cambio de rol desincroniza el
-- contador de la realidad, y para los dos lados:
--
--   * VENDEDOR -> TECNICO no incrementa. El taller termina con mas tecnicos
--     que los que su plan permite, sin que nada lo frene: en Free el limite
--     es 1 (lib/subscriptions.ts), y el cambio de rol es la puerta de atras.
--
--   * TECNICO -> VENDEDOR no decrementa. Queda un tecnico fantasma contado
--     para siempre, y el taller no puede dar de alta a uno real aunque tenga
--     el cupo libre. Este es el lado que se cobra en soporte.
--
-- El fix es hacer que `update_tecnicos_count()` sea el espejo exacto de
-- `update_vendedores_count()`, que ya resolvio esto bien, y volver a
-- registrar el trigger incluyendo UPDATE.
--
-- Ojo con lo que esta migracion NO hace: no corrige los contadores que YA
-- estan desincronizados. Arreglar el trigger solo endereza lo que viene.
-- El resync de lo existente va aparte y a mano, porque puede cambiar quien
-- esta sobre el limite de su plan:
--
--   supabase/migrations/backfill/323_auditoria_contadores_usuarios.sql  (leer)
--   supabase/migrations/backfill/323_backfill_contadores_usuarios.sql   (escribir)
--
-- Correr la auditoria ANTES del backfill. Un taller cuyo contador estaba bajo
-- por un cambio de rol viejo puede quedar, al resincronizarlo, por encima del
-- limite de su plan: no es un bug nuevo, es la verdad apareciendo, pero es
-- una conversacion comercial y no una sorpresa a las tres de la manana.
-- ============================================================================

-- Espejo de update_vendedores_count() (167_atomic_plan_limit_enforcement.sql).
-- Las ramas INSERT y DELETE quedan como estaban; lo unico nuevo es UPDATE.
CREATE OR REPLACE FUNCTION update_tecnicos_count()
RETURNS TRIGGER AS $$
DECLARE
  v_new_count INTEGER;
  v_limit INTEGER;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.rol = 'TECNICO' THEN
    INSERT INTO organization_usage (organization_id, tecnicos_count)
    VALUES (NEW.organization_id, 1)
    ON CONFLICT (organization_id)
    DO UPDATE SET tecnicos_count = organization_usage.tecnicos_count + 1
    RETURNING tecnicos_count INTO v_new_count;

    v_limit := get_plan_limit(NEW.organization_id, 'tecnicos');
    IF v_limit IS NOT NULL AND v_new_count > v_limit THEN
      RAISE EXCEPTION 'PLAN_LIMIT_EXCEEDED:tecnicos:%:%', v_new_count, v_limit
        USING ERRCODE = 'P0001';
    END IF;

  ELSIF TG_OP = 'DELETE' AND OLD.rol = 'TECNICO' THEN
    UPDATE organization_usage
    SET tecnicos_count = GREATEST(0, tecnicos_count - 1)
    WHERE organization_id = OLD.organization_id;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Entrar al rol cuenta y, como en el alta, tiene que respetar el limite
    -- del plan: si no, cambiar de rol es la puerta de atras para saltearlo.
    IF OLD.rol != 'TECNICO' AND NEW.rol = 'TECNICO' THEN
      -- INSERT ... ON CONFLICT y no UPDATE a secas: una organizacion puede no
      -- tener todavia su fila en organization_usage (la rama DELETE de arriba
      -- es un no-op silencioso en ese caso, y asi estaba). Si no existe, un
      -- UPDATE pelado no contaria este tecnico nunca.
      INSERT INTO organization_usage (organization_id, tecnicos_count)
      VALUES (NEW.organization_id, 1)
      ON CONFLICT (organization_id)
      DO UPDATE SET tecnicos_count = organization_usage.tecnicos_count + 1
      RETURNING tecnicos_count INTO v_new_count;

      v_limit := get_plan_limit(NEW.organization_id, 'tecnicos');
      IF v_limit IS NOT NULL AND v_new_count > v_limit THEN
        RAISE EXCEPTION 'PLAN_LIMIT_EXCEEDED:tecnicos:%:%', v_new_count, v_limit
          USING ERRCODE = 'P0001';
      END IF;

    ELSIF OLD.rol = 'TECNICO' AND NEW.rol != 'TECNICO' THEN
      UPDATE organization_usage
      SET tecnicos_count = GREATEST(0, tecnicos_count - 1)
      WHERE organization_id = OLD.organization_id;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- El trigger de la 006 quedo como AFTER INSERT OR DELETE. Reemplazar la
-- funcion no alcanza: hay que volver a registrarlo para que llegue a correr
-- en un UPDATE. Mismo DROP + CREATE que hizo la 015 con el de vendedores.
--
-- Pasa a dispararse en CADA update de `users` (cambio de nombre, de password,
-- de activo). El costo es la comparacion OLD.rol / NEW.rol del ELSIF: sin
-- transicion de rol no toca organization_usage ni llama a get_plan_limit.
DROP TRIGGER IF EXISTS trigger_tecnicos_count ON users;

CREATE TRIGGER trigger_tecnicos_count
  AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION update_tecnicos_count();
