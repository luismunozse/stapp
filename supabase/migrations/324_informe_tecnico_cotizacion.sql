-- ============================================================================
-- 324: informe tecnico para aseguradoras sobre la cotizacion
-- ============================================================================
-- Contexto: los talleres que trabajan con seguros necesitan emitir un documento
-- que acredite que un tecnico reviso el equipo y dictamino si tiene reparacion.
-- Hasta ahora una cotizacion exigia al menos un item, asi que un equipo
-- irreparable no tenia documento posible y el flujo entero quedaba trabado.
--
-- POR QUE NO HAY TABLA NUEVA NI TIPO NUEVO
-- El informe es una cotizacion sin items, no otra entidad. Comparte numeracion,
-- cliente, orden, envio por mail, link publico y PDF: una tabla aparte
-- duplicaria las seis cosas. Y `tipo` (ORDEN|PRESUPUESTO, migracion 126)
-- responde otra pregunta -si el documento cuelga de una orden o vuela solo- que
-- es ortogonal al veredicto. Un informe irreparable puede ser cualquiera de los
-- dos, asi que meter 'INFORME' ahi mezclaria dos ejes.
--
-- POR QUE diagnostico_tecnico Y NO diagnostico
-- Ya existe un `diagnostico` adentro de equipo_snapshot->condiciones, pero se
-- guarda SOLO para tipo PRESUPUESTO: en una cotizacion colgada de una orden ese
-- JSONB es null. Son dos campos distintos y el nombre corto ya estaba tomado.
--
-- POR QUE LA REGLA "SIN ITEMS EXIGE VEREDICTO" NO ES UN CHECK
-- Depende del conteo de items_cotizacion, que es otra tabla. Expresarlo aca
-- pediria triggers en las dos puntas, con el riesgo de orden de operaciones
-- dentro de la misma transaccion. Se enforcea en la capa de API.
-- ============================================================================

ALTER TABLE cotizaciones
  ADD COLUMN IF NOT EXISTS veredicto TEXT,
  ADD COLUMN IF NOT EXISTS diagnostico_tecnico TEXT,
  ADD COLUMN IF NOT EXISTS causa_dano TEXT,
  ADD COLUMN IF NOT EXISTS presentado_ante TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cotizaciones_veredicto_check'
      AND conrelid = 'cotizaciones'::regclass
  ) THEN
    ALTER TABLE cotizaciones
      ADD CONSTRAINT cotizaciones_veredicto_check
      CHECK (veredicto IS NULL OR veredicto IN ('REPARABLE', 'IRREPARABLE', 'SIN_FALLA'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cotizaciones_causa_dano_check'
      AND conrelid = 'cotizaciones'::regclass
  ) THEN
    ALTER TABLE cotizaciones
      ADD CONSTRAINT cotizaciones_causa_dano_check
      CHECK (causa_dano IS NULL OR causa_dano IN
        ('CAIDA', 'LIQUIDO', 'SOBRETENSION', 'DESGASTE', 'USO_INDEBIDO', 'FALLA_FABRICA', 'DESCONOCIDA'));
  END IF;
END $$;

COMMENT ON COLUMN cotizaciones.veredicto IS
  'Dictamen del tecnico: REPARABLE | IRREPARABLE | SIN_FALLA. NULL en toda cotizacion anterior a esta migracion y en las que no lo cargan. Con cero items pasa a ser obligatorio, pero esa regla vive en la API y no aca.';

COMMENT ON COLUMN cotizaciones.diagnostico_tecnico IS
  'Diagnostico que se imprime en el informe. Es una copia CONGELADA: se precarga de ordenes_servicio.diagnostico al crear el documento y no se vuelve a sincronizar, porque un documento presentado ante una aseguradora no puede cambiar solo. Distinto de equipo_snapshot->condiciones->diagnostico, que es PRESUPUESTO-only.';

COMMENT ON COLUMN cotizaciones.causa_dano IS
  'Causa probable del dano. La aseguradora la usa para decidir si cubre.';

COMMENT ON COLUMN cotizaciones.presentado_ante IS
  'Entidad ante la cual se presenta el documento: aseguradora, ART, juzgado. Texto libre a proposito. El autocompletado sale de un DISTINCT por organizacion, no de una tabla de entidades.';

-- Alimenta el autocompletado de presentado_ante sin escanear la tabla entera.
CREATE INDEX IF NOT EXISTS cotizaciones_presentado_ante_idx
  ON cotizaciones (organization_id, presentado_ante)
  WHERE presentado_ante IS NOT NULL AND deleted_at IS NULL;
