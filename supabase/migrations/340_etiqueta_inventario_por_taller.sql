-- 340: medio y tamaño de las etiquetas de INVENTARIO por taller.
--
-- Hasta ahora el medio (térmica/hoja) y el tamaño vivían en el localStorage de
-- cada navegador (stapp:etiqueta-inventario): cada PC del taller había que
-- configurarla a mano. Pasan a la organización, como ya pasó con la etiqueta de
-- órdenes (339), pero en columnas PROPIAS: son dos configuraciones distintas.
--
-- NULL = sin configurar; el cliente cae al localStorage, luego al tamaño de la
-- etiqueta de órdenes y por último a térmica 50x30.
-- Los valores permitidos son PrintMedium y LabelSizeKey de
-- lib/labels/build-labels-html.ts (hay un test que verifica que coincidan).
-- La combinación hoja + rollo (58mm/80mm) la valida la API, no la base.
--
-- Aditiva y re-ejecutable. Columnas nullable sin DEFAULT: no reescribe la tabla.
-- RLS: sin cambios. organizations ya tiene sus políticas por fila y las columnas
-- las heredan; el acceso de la app es por supabaseAdmin desde
-- /api/configuracion/etiqueta-inventario, acotado a la org de la sesión.
-- Sin BEGIN/COMMIT (db-run.mjs hace dry-run en una transacción propia).

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS etiqueta_inventario_medio text;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS etiqueta_inventario_tamano text;

ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS organizations_etiqueta_inventario_medio_check;

ALTER TABLE organizations
  ADD CONSTRAINT organizations_etiqueta_inventario_medio_check
  CHECK (etiqueta_inventario_medio IS NULL OR etiqueta_inventario_medio IN ('thermal', 'sheet'));

ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS organizations_etiqueta_inventario_tamano_check;

ALTER TABLE organizations
  ADD CONSTRAINT organizations_etiqueta_inventario_tamano_check
  CHECK (etiqueta_inventario_tamano IS NULL OR etiqueta_inventario_tamano IN ('40x25', '38x25', '40x30', '50x30', '50x40', '60x40', '58mm', '80mm'));
