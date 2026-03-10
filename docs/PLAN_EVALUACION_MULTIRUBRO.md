# Plan de Evaluacion: Expansion Multi-Rubro + Rebranding de STApp

## Contexto

STApp es actualmente un SaaS de gestion para talleres de servicio tecnico, posicionado hacia reparacion de dispositivos electronicos (celulares, computadoras, tablets, consolas). La vision es expandirlo para servir a tecnicos de 100+ rubros (plomeria, electricidad, mecanica, refrigeracion, carpinteria, etc.) y hacer un rebranding acorde.

**Esto NO es un plan de implementacion todavia** — es un plan de trabajo para evaluar si conviene hacerlo, como, y con que alcance.

---

## Diagnostico del Estado Actual

### Lo que ya es generico (no necesita cambios)
- Ordenes de servicio (flujo de estados)
- Clientes (individuales y empresas)
- Facturacion y pagos parciales
- Cotizaciones standalone
- POS / Ventas
- Garantias y reclamos
- Reportes (12 reportes, todos industry-agnostic)
- Sistema de roles (ADMIN/TECNICO/VENDEDOR)
- Multi-tenant con RLS
- Notificaciones WhatsApp (templates genericos)

### Lo que esta atado a electronica (~65-75 archivos)

| Area | Impacto | Archivos |
|------|---------|----------|
| DB ENUM `tipo_dispositivo` (CELULAR, COMPUTADORA...) | ALTO | migrations/001_schema.sql, types/ |
| Defaults en formularios (default: "CELULAR") | ALTO | components/ordenes/orden-form.tsx |
| Labels UI: "IMEI", "Dispositivo", "Repuesto" | ALTO | ~110 archivos con "dispositivo", ~55 con "repuesto" |
| Sample data onboarding (Pantalla iPhone, Bateria Samsung) | MEDIO | lib/onboarding/sample-data.ts |
| Landing page ("reparacion de celulares") | ALTO | app/page.tsx, components/landing/* |
| Blog y use cases (hardcoded electronics) | MEDIO | lib/blog-data.ts, lib/use-cases-data.ts |
| SEO metadata ("software reparacion celulares") | MEDIO | app/page.tsx, manifest.json |
| Chatbot "Santi" (contexto de electronica) | BAJO | app/api/chatbot/route.ts |
| Capacitor config (ar.com.stapp.app) | BAJO | capacitor.config.ts |

---

## Plan de Trabajo: Evaluacion en 4 Fases

### FASE 1: Investigacion de Mercado (sin tocar codigo)

**Objetivo:** Validar si hay demanda real de otros rubros.

- [ ] **1.1** Definir lista de 10-15 rubros target prioritarios (ej: mecanica automotriz, refrigeracion, electricidad, plomeria, cerrajeria, electrodomesticos, computacion ya existente, audio/video, impresoras, drones, bicicletas, maquinaria industrial)
- [ ] **1.2** Investigar competencia por rubro — que usan los tecnicos de cada rubro hoy? Hay software especifico o usan Excel/papel?
- [ ] **1.3** Entrevistar 5-10 tecnicos de rubros diferentes (no electronicos) — preguntarles:
  - Que flujo de trabajo tienen?
  - Que datos registran de cada trabajo?
  - Que terminologia usan? ("orden de trabajo" vs "presupuesto" vs "ticket")
  - Que les falta de las herramientas actuales?
- [ ] **1.4** Analizar datos propios: de los usuarios actuales de STApp, hay alguno que NO sea de electronica? Que % abandona en onboarding?
- [ ] **1.5** Estimar TAM (Total Addressable Market) por rubro en Latam

**Entregable:** Documento con hallazgos y ranking de rubros por potencial.

---

### FASE 2: Analisis Tecnico de Factibilidad

**Objetivo:** Medir esfuerzo real de la generalizacion.

- [ ] **2.1** Mapear todos los cambios necesarios en DB:
  - Reemplazar ENUM `tipo_dispositivo` por tabla dinamica configurable por org
  - Evaluar migracion de datos existentes
  - Evaluar si `metadata JSONB` actual es suficiente o necesita estructura
- [ ] **2.2** Mapear cambios en UI:
  - Inventariar los ~65-75 archivos que necesitan cambios
  - Clasificar en: cambio de label solamente vs cambio de logica
  - Estimar horas de desarrollo por categoria
- [ ] **2.3** Disenar sistema de "plantillas de rubro":
  - Que incluye una plantilla? (campos, checklists, terminologia, sample data, categorias inventario)
  - Como se almacena? (tabla `rubro_templates` con JSONB?)
  - Se selecciona en onboarding o es configurable despues?
- [ ] **2.4** Evaluar impacto en features existentes:
  - Checklists: ya soportan config por tipo, solo generalizar
  - PDF generation: revisar si hay texto hardcoded
  - Reportes: ya son genericos, OK
  - CSV import/export: revisar mapeo de campos
- [ ] **2.5** Estimar timeline total de desarrollo

**Entregable:** Documento tecnico con estimacion de esfuerzo (S/M/L/XL por area).

---

### FASE 3: Estrategia de Rebranding

**Objetivo:** Definir nueva identidad si se decide avanzar.

- [ ] **3.1** Evaluar si "STApp" sigue funcionando como nombre:
  - "ST" = Servicio Tecnico — sigue siendo relevante para todos los rubros?
  - Alternativa: mantener nombre pero cambiar el posicionamiento
  - Alternativa: nombre nuevo que comunique "gestion para oficios/tecnicos"
- [ ] **3.2** Definir nuevo tagline/posicionamiento:
  - Actual: "Software de Gestion para Servicio Tecnico | Reparacion de Celulares"
  - Propuesto: algo como "La plataforma de gestion para tecnicos y oficios"
- [ ] **3.3** Inventariar assets a cambiar:
  - Dominio: stapp.com.ar — se mantiene? se agrega otro?
  - Logo: componente `stapp-logo.tsx`
  - Manifest PWA: name, short_name, description
  - Capacitor: appId, appName
  - App stores: descripcion, screenshots, keywords
  - Redes sociales, landing page, blog
- [ ] **3.4** Plan de migracion de marca:
  - Redireccion de dominios si cambia
  - Comunicacion a usuarios existentes
  - Timeline de transicion (gradual vs big bang)
- [ ] **3.5** Evaluar impacto SEO:
  - Actualmente posicionado para "software reparacion celulares"
  - Riesgo de perder posicionamiento actual
  - Estrategia: paginas de rubro especificas (/para-mecanicos, /para-electricistas)

**Entregable:** Brief de rebranding con opciones y recomendaciones.

---

### FASE 4: Decision Go/No-Go

**Objetivo:** Tomar la decision informada.

- [ ] **4.1** Consolidar hallazgos de fases 1-3
- [ ] **4.2** Evaluar con matriz de decision:

| Criterio | Peso | Evaluar |
|----------|------|---------|
| Demanda validada de otros rubros | 30% | Fase 1 |
| Esfuerzo tecnico vs capacidad del equipo | 25% | Fase 2 |
| Riesgo de perder foco/usuarios actuales | 20% | Fase 1 + 3 |
| Potencial de crecimiento de mercado | 15% | Fase 1 |
| Complejidad del rebranding | 10% | Fase 3 |

- [ ] **4.3** Definir escenarios:
  - **A: Full multi-rubro** — generalizacion completa + rebranding
  - **B: Expansion gradual** — agregar 3-5 rubros cercanos (electrodomesticos, computacion, impresoras) sin rebranding fuerte
  - **C: No cambiar** — mantener foco en electronica, mejorar profundidad
- [ ] **4.4** Si Go → crear roadmap de implementacion con sprints
- [ ] **4.5** Si No-Go → documentar razones y re-evaluar en 6 meses

**Entregable:** Documento de decision con escenario elegido y roadmap.

---

## Archivos Clave de Referencia

| Archivo | Relevancia |
|---------|-----------|
| `supabase/migrations/001_schema.sql` | Schema principal, ENUM tipo_dispositivo |
| `supabase/migrations/049_tipos_dispositivo.sql` | Config JSONB por tipo |
| `supabase/migrations/050_checklists.sql` | Templates de checklist |
| `types/index.ts` | Tipos TypeScript core |
| `components/ordenes/orden-form.tsx` | Formulario de ordenes (default CELULAR) |
| `components/configuracion/tipo-config-editor.tsx` | Editor de config por tipo |
| `lib/onboarding/sample-data.ts` | Datos de ejemplo |
| `lib/onboarding/checklist-presets.ts` | Presets de checklist |
| `lib/plan-limits.ts` | Limites de planes |
| `app/page.tsx` | Landing page principal |
| `components/landing/*` | Componentes de landing |
| `public/manifest.json` | PWA manifest |
| `capacitor.config.ts` | Config mobile |

---

## Recomendacion Preliminar

Basado en el analisis tecnico, la arquitectura de STApp ya tiene las bases para multi-rubro (JSONB configs, metadata extensible, checklists dinamicos). El esfuerzo principal es:

1. **Generalizar terminologia** (~65-75 archivos, mayormente labels)
2. **Crear sistema de plantillas por rubro** (feature nueva)
3. **Reescribir landing/marketing** (contenido, no codigo)
4. **Migracion de DB** (ENUM → tabla dinamica)

El escenario **B (expansion gradual)** parece el mas pragmatico: expandir a rubros cercanos primero, validar con usuarios reales, y luego decidir si hacer rebranding completo.
