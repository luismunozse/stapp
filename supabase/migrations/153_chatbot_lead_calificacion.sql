-- ========================================
-- CHATBOT: Calificación de leads (score + contexto)
-- ========================================
-- Agrega campos extraídos por el chatbot vía LLM (Gemini JSON mode):
--   - score: 0-100, qué tan calificado está el lead
--   - cantidad_tecnicos, ciudad, sistema_actual, urgencia, resumen
-- Trigger: auto-promover a CALIFICADO cuando score >= 70 (no degrada estados manuales).

-- ========================================
-- COLUMNAS NUEVAS EN leads
-- ========================================

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS score INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cantidad_tecnicos INTEGER,
  ADD COLUMN IF NOT EXISTS ciudad TEXT,
  ADD COLUMN IF NOT EXISTS sistema_actual TEXT,
  ADD COLUMN IF NOT EXISTS urgencia TEXT,
  ADD COLUMN IF NOT EXISTS resumen_conversacion TEXT;

ALTER TABLE leads
  ADD CONSTRAINT leads_score_range CHECK (score >= 0 AND score <= 100);

ALTER TABLE leads
  ADD CONSTRAINT leads_urgencia_enum CHECK (
    urgencia IS NULL OR urgencia IN ('alta', 'media', 'baja')
  );

ALTER TABLE leads
  ADD CONSTRAINT leads_cantidad_tecnicos_positiva CHECK (
    cantidad_tecnicos IS NULL OR cantidad_tecnicos >= 0
  );

-- ========================================
-- ÍNDICES
-- ========================================

CREATE INDEX IF NOT EXISTS idx_leads_score ON leads(score DESC);
CREATE INDEX IF NOT EXISTS idx_leads_urgencia ON leads(urgencia) WHERE urgencia IS NOT NULL;

-- ========================================
-- TRIGGER: auto-promover a CALIFICADO según score
-- ========================================
-- Solo promueve si el estado actual es NUEVO (no degrada gestión manual).

CREATE OR REPLACE FUNCTION auto_calificar_lead_por_score()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.score >= 70 AND NEW.estado = 'NUEVO' THEN
    NEW.estado := 'CALIFICADO';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_auto_calificar_lead ON leads;

CREATE TRIGGER trigger_auto_calificar_lead
  BEFORE INSERT OR UPDATE OF score ON leads
  FOR EACH ROW
  EXECUTE FUNCTION auto_calificar_lead_por_score();

-- ========================================
-- COMENTARIOS
-- ========================================

COMMENT ON COLUMN leads.score IS 'Calificación 0-100 calculada por LLM según señales de la conversación.';
COMMENT ON COLUMN leads.cantidad_tecnicos IS 'Cantidad de técnicos del taller mencionada por el lead.';
COMMENT ON COLUMN leads.ciudad IS 'Ciudad/provincia mencionada por el lead.';
COMMENT ON COLUMN leads.sistema_actual IS 'Sistema de gestión que usa hoy (excel, papel, software X, ninguno).';
COMMENT ON COLUMN leads.urgencia IS 'Urgencia declarada: alta | media | baja.';
COMMENT ON COLUMN leads.resumen_conversacion IS 'Resumen breve generado por LLM para el equipo comercial.';
