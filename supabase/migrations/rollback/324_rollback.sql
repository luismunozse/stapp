-- Rollback de la migracion 324.
--
-- Saca las cuatro columnas del informe tecnico. Se PIERDE el contenido de todo
-- informe ya emitido: veredicto, diagnostico, causa del dano y entidad
-- destinataria. Los PDFs que ya se enviaron siguen existiendo del lado del
-- cliente, pero la app no puede volver a dibujarlos.
--
-- Antes de correr esto, exportar:
--   SELECT id, numero_cotizacion, organization_id, veredicto,
--          diagnostico_tecnico, causa_dano, presentado_ante
--   FROM cotizaciones WHERE veredicto IS NOT NULL;
--
-- Ojo con las cotizaciones de cero items: no se borran -son documentos
-- emitidos- pero sin veredicto la UI las muestra como presupuestos vacios en
-- total cero. Anotar sus numeros antes de correr el rollback.
--
-- Los CHECK se van solos con las columnas; no hace falta DROP CONSTRAINT.

DROP INDEX IF EXISTS cotizaciones_presentado_ante_idx;

ALTER TABLE cotizaciones
  DROP COLUMN IF EXISTS veredicto,
  DROP COLUMN IF EXISTS diagnostico_tecnico,
  DROP COLUMN IF EXISTS causa_dano,
  DROP COLUMN IF EXISTS presentado_ante;
