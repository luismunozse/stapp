-- 339: tamaño de etiqueta térmica por taller.
--
-- Hasta ahora el tamaño (60x40, 58mm, ...) vivía en el localStorage de cada
-- navegador: cada PC del taller había que configurarla a mano. Pasa a la
-- organización para configurarlo una vez y que lo usen todos los equipos.
--
-- NULL = sin configurar; el cliente cae al localStorage legado y luego a 60x40.
-- Los valores permitidos son LABEL_SIZES de lib/etiqueta-tamano.ts.
--
-- Aditiva y re-ejecutable. Columna nullable sin DEFAULT: no reescribe la tabla.
-- RLS: sin cambios. organizations ya tiene sus políticas por fila y la columna
-- las hereda; el acceso de la app es por supabaseAdmin desde
-- /api/configuracion/etiqueta, acotado a la org de la sesión.
-- Sin BEGIN/COMMIT (db-run.mjs hace dry-run en una transacción propia).

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS etiqueta_tamano text;

ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS organizations_etiqueta_tamano_check;

ALTER TABLE organizations
  ADD CONSTRAINT organizations_etiqueta_tamano_check
  CHECK (etiqueta_tamano IS NULL OR etiqueta_tamano IN ('40x30', '50x30', '50x40', '60x40', '58mm', '80mm'));
