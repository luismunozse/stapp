# Chatbot KB + Landing Accuracy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align Santi's knowledge base and the public landing with the platform's real, shipped features — remove overclaims, fix inaccurate numbers, surface real hidden features.

**Architecture:** Pure content edits to hardcoded strings/arrays (no logic, no schema, no new components). Approach A: in-place edits + enrich existing sections; no new top-level landing sections.

**Tech Stack:** Next.js App Router, TypeScript, React, Tailwind. No tests for marketing copy (project convention). Verification = `tsc --noEmit` + `npm run build` + visual review.

**Convention:** Spanish (Rioplatense, professional) copy — this is existing user-facing product copy in Spanish, so we extend it in Spanish. No tests added.

---

## File Structure

Modified files (all existing):
- `app/api/chatbot/route.ts` — KB string inside `buildContextPrompt()` (~L235–474).
- `components/landing/features.tsx` — `categories` array.
- `components/landing/comparison.tsx` — `rows` array.
- `components/landing/pricing-section.tsx` — `plans` array.
- `app/page.tsx` — `faqData` array.
- `components/landing/footer.tsx` — WhatsApp number.

`components/landing/hero.tsx`: VERIFIED no change needed — its subhead/benefits contain no inaccurate claims ("Asistente IA 24/7" is real; no "tiempo real" wording). Deliberately out of scope to avoid layout risk.

Execution order: Task 1 (KB) → Tasks 2–6 (landing files) → Task 7 (verify + commit gate). Each task commits independently.

---

## Task 1: Chatbot KB corrections + additions

**Files:**
- Modify: `app/api/chatbot/route.ts` (inside `buildContextPrompt()`)

Apply each edit as an exact find→replace. Strings are unique within the file.

- [ ] **Step 1: Remove kiosco "autoservicio" from the included-plan list**

Find:
```
- Modo kiosco para mostrar estado de reparaciones en el local
- Modo kiosco de autoservicio para que el cliente ingrese su equipo
```
Replace:
```
- Modo kiosco para mostrar estado de reparaciones en el local
```

- [ ] **Step 2: Fix the "17 reportes" line in the included-plan list**

Find:
```
- 17 reportes avanzados con analytics predictivos
```
Replace:
```
- Reportes avanzados (rentabilidad, performance de técnicos y vendedores, predicción de repuestos por consumo, fallas comunes y más)
```

- [ ] **Step 3: Soften "tiempo real" in the included-plan list**

Find:
```
- Actualización en tiempo real en todos los dispositivos
```
Replace:
```
- Sincronización en la nube: tus datos disponibles en todos tus dispositivos
```

- [ ] **Step 4: Remove the Supabase Realtime claim in the Órdenes description**

Find:
```
Actualización en tiempo real: los cambios en las órdenes se reflejan instantáneamente en todos los dispositivos conectados (Supabase Realtime). Problema reportado editable desde el detalle de la orden
```
Replace:
```
Los cambios en las órdenes quedan guardados al instante y disponibles al recargar desde cualquier dispositivo. Problema reportado editable desde el detalle de la orden
```

- [ ] **Step 5: Remove "firma digital" from the standalone cotización description**

Find:
```
El cliente los aprueba o rechaza online con firma digital desde un link único, sin necesidad de crear cuenta.
```
Replace:
```
El cliente los aprueba o rechaza online desde un link único, sin necesidad de crear cuenta.
```

- [ ] **Step 6: Fix the Firma Digital description (recepción/entrega, not presupuesto)**

Find:
```
- Firma Digital: captura de firma del cliente en la entrega, en la aprobación de presupuestos y en la orden de retiro. Respaldo legal ante cualquier reclamo
```
Replace:
```
- Firma Digital: captura de firma del cliente en la recepción del equipo, en la entrega y en la orden de retiro. Respaldo legal ante cualquier reclamo
```

- [ ] **Step 7: Fix the reportes section header (remove "17 reportes")**

Find:
```
5. REPORTES Y ANALYTICS (17 reportes):
```
Replace:
```
5. REPORTES Y ANALYTICS:
```

- [ ] **Step 8: Reframe "predicción de repuestos con IA"**

Find:
```
- Predicción de repuestos (análisis predictivo con IA)
```
Replace:
```
- Predicción de repuestos (estimación por consumo promedio histórico)
```

- [ ] **Step 9: Remove the "20+ plantillas" email count**

Find:
```
- Campañas de Email: sistema de email marketing con plantillas prediseñadas (20+ plantillas). Emails automáticos de ciclo de vida: bienvenida, engagement, recordatorios, recuperación de clientes inactivos. Seguimiento de envíos
```
Replace:
```
- Campañas de Email: sistema de email marketing con plantillas prediseñadas. Emails automáticos de ciclo de vida: bienvenida, tips de uso, recordatorios de vencimiento de prueba y recuperación de clientes inactivos. Seguimiento de envíos
```

- [ ] **Step 10: Make the WhatsApp description precise (provider Meta o Evolution, 50+ plantillas)**

Find:
```
- WhatsApp Business API (integración oficial con Meta): envío de notificaciones automáticas al cliente por WhatsApp. Plantillas listas: equipo listo para retirar, presupuesto disponible, seguimiento de reparación, confirmación de entrega. Historial completo de notificaciones por cliente
```
Replace:
```
- WhatsApp Business API: integración oficial con Meta (Cloud API) o servidor propio (Evolution), según la configuración de cada taller. Más de 50 plantillas configurables: equipo listo para retirar, presupuesto disponible, seguimiento de reparación, confirmación de entrega, cobranza y más. Historial completo de notificaciones por cliente
```

- [ ] **Step 11: Enrich the Inventario description**

Find:
```
- Control de Inventario: alertas automáticas de stock bajo, historial de precios, control de costos y márgenes en tiempo real. Código automático, categorización por tipo de dispositivo. Movimientos de stock con trazabilidad. Importación masiva desde Excel/CSV con plantillas descargables
```
Replace:
```
- Control de Inventario: alertas automáticas de stock bajo, historial de precios, control de costos y márgenes. Código automático, categorización por tipo de dispositivo. Multi-depósito con transferencias, variantes de producto, kits/combos, lotes con fecha de vencimiento, números de serie/IMEI, análisis ABC, reposición automática con orden de compra sugerida y conteos físicos. Movimientos de stock con trazabilidad. Importación masiva desde Excel/CSV con plantillas descargables
```

- [ ] **Step 12: Add comisiones to the Equipo de Trabajo description**

Find:
```
- Equipo de Trabajo: técnicos, vendedores y administradores con roles diferenciados y permisos específicos. Métricas de rendimiento individuales por técnico (órdenes completadas, tiempos) y por vendedor (ventas realizadas). Cada técnico solo ve sus órdenes asignadas
```
Replace:
```
- Equipo de Trabajo: técnicos, vendedores y administradores con roles diferenciados y permisos específicos. Métricas de rendimiento individuales por técnico (órdenes completadas, tiempos) y por vendedor (ventas realizadas). Comisiones por vendedor con liquidación. Cada técnico solo ve sus órdenes asignadas
```

- [ ] **Step 13: Add gastos recurrentes / estado de resultados to the Caja description**

Find:
```
- Caja: módulo de caja para registrar y controlar todos los movimientos de dinero del taller (ingresos por reparaciones, ventas, pagos parciales, etc.)
```
Replace:
```
- Caja y Finanzas: módulo de caja para registrar y controlar todos los movimientos de dinero del taller (ingresos por reparaciones, ventas, pagos parciales, etc.), con gastos por categoría, gastos recurrentes (alquiler, servicios, sueldos) y estado de resultados (P&L) mensual
```

- [ ] **Step 14: Add nota de crédito to the Punto de Venta description**

Find:
```
Ventas con garantía por producto, múltiples medios de pago, gestión de devoluciones, numeración automática y estados (completada, anulada).
```
Replace:
```
Ventas con garantía por producto, múltiples medios de pago, gestión de devoluciones con nota de crédito, numeración automática y estados (completada, anulada).
```

- [ ] **Step 15: Soften the second "tiempo real" claim (VENTAJAS COMPETITIVAS)**

Find:
```
- Actualización en tiempo real: todos los cambios se reflejan al instante en todos los dispositivos
```
Replace:
```
- Sincronización en la nube: tus datos disponibles en todos tus dispositivos
```

- [ ] **Step 16: Remove "Kiosco de autoservicio" from VENTAJAS COMPETITIVAS**

Find:
```
- Kiosco de autoservicio para que el cliente ingrese su equipo solo
```
Replace (delete the line entirely — remove the whole line including its trailing newline so no blank line remains).

- [ ] **Step 17: Add new feature sections before CONTACTO**

Find:
```
CONTACTO:
- WhatsApp: +54 9 11 6962-5733
```
Replace:
```
SUCURSALES Y MULTI-MONEDA:
- Multi-sucursal: gestioná varias sucursales con órdenes, ventas, caja, depósitos y usuarios por sucursal. La cantidad de sucursales depende del plan (Free 1, Profesional hasta 3, planes superiores ilimitado).
- Multi-moneda: soporta 11 monedas (ARS, USD, MXN, CLP, COP, PEN, UYU, BRL, BOB, PYG, EUR). Cotización del dólar actualizada automáticamente.

CATÁLOGO ONLINE Y E-COMMERCE:
- Catálogo público por organización con link propio, cupones de descuento, recuperación de carritos abandonados y cotización online desde el catálogo. Checkout con MercadoPago.

AGENDA Y TURNOS:
- Gestión de turnos con disponibilidad y recordatorios automáticos al cliente.

INTEGRACIONES Y API:
- Webhooks salientes configurables con reintentos.
- API REST v1 (clientes, inventario, órdenes) con API keys.
- Notificaciones push web y nativas.

CONTACTO:
- WhatsApp: +54 9 11 6962-5733
```

- [ ] **Step 18: Verify the template literal still compiles**

Run: `npx tsc --noEmit 2>&1 | grep -v "\.next/"`
Expected: no errors referencing `app/api/chatbot/route.ts` (the `buildContextPrompt` template string is intact, all `${prices...}` interpolations untouched).

- [ ] **Step 19: Commit**

```bash
git add app/api/chatbot/route.ts
git commit -m "fix(chatbot): KB refleja features reales (sin overclaims) y suma multi-sucursal/catalogo/API"
```

---

## Task 2: Landing — features.tsx

**Files:**
- Modify: `components/landing/features.tsx` (`categories` array)

- [ ] **Step 1: Órdenes — remove "estados en tiempo real"**

Find:
```
          "El corazón de tu taller. Creá una orden en menos de 1 minuto con estados en tiempo real, checklists personalizados y seguimiento completo.",
```
Replace:
```
          "El corazón de tu taller. Creá una orden en menos de 1 minuto con estados claros, checklists personalizados y seguimiento completo.",
```

- [ ] **Step 2: Cotizaciones — remove "con firma digital"**

Find:
```
          "Creá presupuestos profesionales con descuentos, impuestos y condiciones. Tu cliente los aprueba online con firma digital desde un link, sin necesidad de cuenta.",
```
Replace:
```
          "Creá presupuestos profesionales con descuentos, impuestos y condiciones. Tu cliente los aprueba o rechaza online desde un link, sin necesidad de cuenta.",
```

- [ ] **Step 3: Portal de Seguimiento — remove "en tiempo real"**

Find:
```
          "Tu cliente sigue su reparación en tiempo real desde un link, sin crear cuenta. Ve el estado, fotos, garantía y descarga el comprobante en PDF.",
```
Replace:
```
          "Tu cliente sigue su reparación desde un link, sin crear cuenta. Ve el estado actualizado, fotos, garantía y descarga el comprobante en PDF.",
```

- [ ] **Step 4: Inventario — enrich + drop "en tiempo real"**

Find:
```
          "Alertas de stock bajo, historial de precios, costos y márgenes en tiempo real. Importá tu inventario desde Excel o CSV en minutos.",
```
Replace:
```
          "Multi-depósito, variantes, series/IMEI, lotes con vencimiento y análisis ABC. Alertas de stock bajo, historial de precios y reposición sugerida. Importá tu inventario desde Excel o CSV en minutos.",
```

- [ ] **Step 5: Add "Multi-sucursal" item to the Administración tab**

Find:
```
      {
        name: "Sistema de Garantías",
        description:
          "Garantías vigentes, vencimientos, reclamos pendientes y reingresos vinculados a la orden original. Todo trazable, sin perder nada.",
        icon: ShieldCheck,
        color: "bg-red-500",
      },
    ],
  },
  {
    id: "ventas",
```
Replace:
```
      {
        name: "Sistema de Garantías",
        description:
          "Garantías vigentes, vencimientos, reclamos pendientes y reingresos vinculados a la orden original. Todo trazable, sin perder nada.",
        icon: ShieldCheck,
        color: "bg-red-500",
      },
      {
        name: "Multi-sucursal y Multi-moneda",
        description:
          "Gestioná varias sucursales con órdenes, ventas, caja y stock por local. Trabajá en cualquiera de las 11 monedas soportadas (ARS, USD y más).",
        icon: Settings,
        color: "bg-cyan-600",
      },
    ],
  },
  {
    id: "ventas",
```

- [ ] **Step 6: Add "Catálogo Online" item to the Ventas tab**

Find:
```
      {
        name: "Modo Kiosco",
        description:
          "Mostrá el estado de las reparaciones en una pantalla en tu local. Tu cliente ve el avance sin preguntar. Personalizable y sin login.",
        icon: Monitor,
        color: "bg-sky-500",
      },
    ],
  },
  {
    id: "finanzas",
```
Replace:
```
      {
        name: "Modo Kiosco",
        description:
          "Mostrá el estado de las reparaciones en una pantalla en tu local. Tu cliente ve el avance sin preguntar. Personalizable y sin login.",
        icon: Monitor,
        color: "bg-sky-500",
      },
      {
        name: "Catálogo Online",
        description:
          "Publicá tu catálogo con link propio, cupones de descuento y checkout con MercadoPago. Recuperá carritos abandonados automáticamente.",
        icon: Link2,
        color: "bg-fuchsia-500",
      },
    ],
  },
  {
    id: "finanzas",
```

- [ ] **Step 7: Productividad — rename "15+ Reportes Avanzados" to "Reportes Avanzados"**

Find:
```
        name: "15+ Reportes Avanzados",
```
Replace:
```
        name: "Reportes Avanzados",
```

- [ ] **Step 8: Add "Integraciones y API" item to the Productividad tab**

Find:
```
      {
        name: "App Móvil + Offline",
        description:
          "App nativa para Android, PWA para cualquier dispositivo y modo offline que sincroniza cuando volvés a tener conexión.",
        icon: Smartphone,
        color: "bg-pink-500",
      },
    ],
  },
  {
    id: "soporte",
```
Replace:
```
      {
        name: "App Móvil + Offline",
        description:
          "App nativa para Android, PWA para cualquier dispositivo y modo offline que sincroniza cuando volvés a tener conexión.",
        icon: Smartphone,
        color: "bg-pink-500",
      },
      {
        name: "Integraciones y API",
        description:
          "Webhooks salientes, API REST v1 y API keys para conectar STApp con tus otras herramientas.",
        icon: Zap,
        color: "bg-slate-500",
      },
    ],
  },
  {
    id: "soporte",
```

- [ ] **Step 9: Soporte — fix Firma Digital (recepción/entrega, not presupuesto)**

Find:
```
          "Capturá la firma del cliente en la entrega y en la aprobación de presupuestos. Ante cualquier reclamo, tenés el respaldo legal.",
```
Replace:
```
          "Capturá la firma del cliente en la recepción y en la entrega del equipo. Ante cualquier reclamo, tenés el respaldo legal.",
```

- [ ] **Step 10: Commit**

```bash
git add components/landing/features.tsx
git commit -m "feat(landing): features sin overclaims + multi-sucursal/catalogo/API e inventario avanzado"
```

---

## Task 3: Landing — comparison.tsx

**Files:**
- Modify: `components/landing/comparison.tsx` (`rows` array)

- [ ] **Step 1: Órdenes de trabajo — drop "en tiempo real"**

Find:
```
    feature: "Órdenes de trabajo",
    stapp: "Digitales con estados en tiempo real",
```
Replace:
```
    feature: "Órdenes de trabajo",
    stapp: "Digitales con estados y seguimiento",
```

- [ ] **Step 2: Seguimiento para clientes — drop "en tiempo real"**

Find:
```
    feature: "Seguimiento para clientes",
    stapp: "Link público en tiempo real",
```
Replace:
```
    feature: "Seguimiento para clientes",
    stapp: "Link público con estado actualizado",
```

- [ ] **Step 3: Cotizaciones online — remove firma digital**

Find:
```
    feature: "Cotizaciones online",
    stapp: "Aprobación con firma digital",
```
Replace:
```
    feature: "Cotizaciones online",
    stapp: "Aprobación/rechazo online",
```

- [ ] **Step 4: Reportes — de-number**

Find:
```
    feature: "Reportes",
    stapp: "15+ reportes avanzados",
```
Replace:
```
    feature: "Reportes",
    stapp: "Reportes avanzados",
```

- [ ] **Step 5: Dashboard analítico — drop "en tiempo real"**

Find:
```
    feature: "Dashboard analítico",
    stapp: "KPIs en tiempo real",
```
Replace:
```
    feature: "Dashboard analítico",
    stapp: "KPIs actualizados",
```

- [ ] **Step 6: Add three new rows (Multi-sucursal, Catálogo online, Integraciones/API) before the closing `] as const`**

Find:
```
  {
    feature: "Asistente IA integrado",
    stapp: "Santi, disponible 24/7",
    excel: "No disponible",
    papel: "No disponible",
    stappLevel: "full",
    excelLevel: "none",
    papelLevel: "none",
  },
] as const
```
Replace:
```
  {
    feature: "Asistente IA integrado",
    stapp: "Santi, disponible 24/7",
    excel: "No disponible",
    papel: "No disponible",
    stappLevel: "full",
    excelLevel: "none",
    papelLevel: "none",
  },
  {
    feature: "Multi-sucursal",
    stapp: "Varias sucursales y monedas",
    excel: "No disponible",
    papel: "No disponible",
    stappLevel: "full",
    excelLevel: "none",
    papelLevel: "none",
  },
  {
    feature: "Catálogo online",
    stapp: "Tienda con MercadoPago",
    excel: "No disponible",
    papel: "No disponible",
    stappLevel: "full",
    excelLevel: "none",
    papelLevel: "none",
  },
  {
    feature: "Integraciones / API",
    stapp: "Webhooks y API REST",
    excel: "No disponible",
    papel: "No disponible",
    stappLevel: "full",
    excelLevel: "none",
    papelLevel: "none",
  },
] as const
```

- [ ] **Step 7: Commit**

```bash
git add components/landing/comparison.tsx
git commit -m "feat(landing): tabla comparativa sin overclaims + filas multi-sucursal/catalogo/API"
```

---

## Task 4: Landing — pricing-section.tsx

**Files:**
- Modify: `components/landing/pricing-section.tsx` (`plans` array)

- [ ] **Step 1: Free plan — add "1 sucursal" to the included list**

Find:
```
      { text: "Hasta 30 clientes", included: true },
      { text: "Inventario básico", included: true },
```
Replace:
```
      { text: "Hasta 30 clientes", included: true },
      { text: "1 sucursal", included: true },
      { text: "Inventario básico", included: true },
```

- [ ] **Step 2: Profesional plan — de-number reportes**

Find:
```
      { text: "15+ reportes avanzados", included: true },
```
Replace:
```
      { text: "Reportes avanzados", included: true },
```

- [ ] **Step 3: Profesional plan — add multi-sucursal and catálogo**

Find:
```
      { text: "Modo kiosco para tu local", included: true },
      { text: "Reportes avanzados", included: true },
```
Replace:
```
      { text: "Modo kiosco para tu local", included: true },
      { text: "Multi-sucursal (hasta 3)", included: true },
      { text: "Catálogo online + cupones", included: true },
      { text: "Reportes avanzados", included: true },
```

- [ ] **Step 4: Commit**

```bash
git add components/landing/pricing-section.tsx
git commit -m "feat(landing): pricing — reportes sin numero inflado + multi-sucursal/catalogo"
```

---

## Task 5: Landing — FAQ (app/page.tsx)

**Files:**
- Modify: `app/page.tsx` (`faqData` array)

- [ ] **Step 1: Soften the Android APK claim in the "¿Necesito instalar algo?" answer**

Find:
```
      "No, STApp es una aplicación web que funciona directamente en tu navegador desde cualquier dispositivo. Solo necesitas conexión a internet. Además, podés descargar la app nativa para Android (APK), instalarla como PWA en cualquier dispositivo, y próximamente estará disponible también en iOS.",
```
Replace:
```
      "No, STApp es una aplicación web que funciona directamente en tu navegador desde cualquier dispositivo. Solo necesitás conexión a internet. También podés instalarla como PWA en tu celular y usar la app para Android; la versión para iOS está en camino.",
```

- [ ] **Step 2: Add two FAQ entries (multi-sucursal, API) before the closing of `faqData`**

Find:
```
  {
    question: "¿Puedo captar leads y darles seguimiento?",
    answer:
      "Sí. STApp incluye un módulo de captación de leads donde podés registrar consultas y potenciales clientes. Hacé seguimiento de cada lead hasta convertirlo en una orden de trabajo real, sin que se te escape ninguna oportunidad.",
  },
]
```
Replace:
```
  {
    question: "¿Puedo captar leads y darles seguimiento?",
    answer:
      "Sí. STApp incluye un módulo de captación de leads donde podés registrar consultas y potenciales clientes. Hacé seguimiento de cada lead hasta convertirlo en una orden de trabajo real, sin que se te escape ninguna oportunidad.",
  },
  {
    question: "¿Puedo manejar varias sucursales?",
    answer:
      "Sí. STApp es multi-sucursal: gestionás órdenes, ventas, caja, depósitos y usuarios por sucursal. La cantidad de sucursales depende de tu plan (el plan Free incluye 1 y el Profesional hasta 3). Además soporta múltiples monedas.",
  },
  {
    question: "¿STApp tiene API o integraciones?",
    answer:
      "Sí. STApp ofrece una API REST (v1) para clientes, inventario y órdenes con API keys, además de webhooks salientes configurables para conectar STApp con tus otras herramientas y notificarte de eventos al instante.",
  },
]
```

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat(landing): FAQ — APK honesto + sucursales y API"
```

---

## Task 6: Landing — footer WhatsApp number

**Files:**
- Modify: `components/landing/footer.tsx`

- [ ] **Step 1: Fix the placeholder WhatsApp number**

Replace every occurrence of `5491100000000` with `5491169625733` (the real support number, matching the floating button).

Run (to confirm location first): `rg -n "5491100000000" components/landing/footer.tsx`
Then apply the replacement to each match.

- [ ] **Step 2: Verify no stale placeholder remains**

Run: `rg -n "5491100000000" components/landing/footer.tsx`
Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add components/landing/footer.tsx
git commit -m "fix(landing): footer usa el numero real de WhatsApp"
```

---

## Task 7: Verify build + final review

**Files:** none (verification only)

- [ ] **Step 1: Stop any dev server** (it locks `.next`)

If a dev server is running, stop it before building (Windows: find the `next dev` node process and kill it).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v "\.next/"`
Expected: exit clean (no errors in edited files).

- [ ] **Step 3: Production build**

Run: `rm -rf .next && npm run build`
Expected: `exit 0`, build completes.

- [ ] **Step 4: Spot-check copy**

Grep for residual overclaims that should be gone:
```
rg -n "autoservicio|17 reportes|análisis predictivo con IA|con firma digital|Supabase Realtime|20\+ plantillas|5491100000000" app/api/chatbot/route.ts components/landing/ app/page.tsx
```
Expected: no matches (each was removed/reworded). Note: `predicción de repuestos` as a feature name is allowed; `con IA` next to it is not.

---

## Self-Review

- **Spec coverage:** Part 1 KB → Task 1 (Steps 1–17 cover kiosco, reportes count, IA, realtime, cotización firma, email count, Android, + additions multi-sucursal/multi-moneda/inventario/catálogo/agenda/integraciones/comisiones/gastos/notas-crédito/WhatsApp providers). Part 2 landing → features (T2), comparison (T3), pricing (T4), FAQ (T5), footer (T6). Hero → explicitly verified no-change. Verification → T7.
- **Placeholders:** none — every step has exact find/replace strings.
- **Type consistency:** new array items match existing shapes — features `{name, description, icon, color}` (icons `Settings`, `Link2`, `Zap` already imported in `features.tsx`); comparison rows include all 7 keys + valid `*Level` literals (`full`/`none`); pricing `{text, included}`; faqData `{question, answer}`. No new imports required.
- **Out of scope honored:** no new sections, no testimonials, Android download logic untouched, pricing values (DB) untouched.
