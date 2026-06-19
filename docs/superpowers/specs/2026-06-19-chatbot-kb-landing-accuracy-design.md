# Chatbot KB + Landing — Accuracy & Completeness — Design

**Date:** 2026-06-19
**Approach:** A (in-place edits + enrich existing sections; no new top-level landing sections)
**Goal:** Make Santi's knowledge base and the public landing reflect the platform's REAL features — remove overclaims, correct inaccurate numbers, and surface real features currently hidden.

---

## Background

A ground-truth codebase audit (routes, API, components, migrations, hooks) was cross-checked against:
- The chatbot KB string in `app/api/chatbot/route.ts` → `buildContextPrompt()` (lines ~235–474).
- The landing components under `components/landing/` + FAQ data in `app/page.tsx`.

Two classes of problems found: **overclaims** (stated features that don't exist or are misrepresented) and **underclaims** (real, shipped features not mentioned). Guiding principle: honesty over inflated conversion (no fabricated capabilities, no fake social proof).

---

## Part 1 — Chatbot KB (`app/api/chatbot/route.ts`, `buildContextPrompt`)

### 1.1 Corrections (overclaims → accurate)

| Claim today | Reality (evidence) | Fix |
|---|---|---|
| "2 modos kiosco: estado + autoservicio" (L273, L318, L383) | Only 1 mode: status display with `display_mode: grid \| grouped`. No self-service route/component. `app/kiosco/[token]/`, `components/kiosco/kiosk-display.tsx` | Describe a single status-display kiosk with grid/grouped views. Remove "autoservicio". |
| "17 reportes avanzados con analytics predictivos" (L274, L320) + "Predicción de repuestos (análisis predictivo con IA)" (L337) | 10 tabs in `ReportesAvanzadosView`; 20 report endpoints total. `prediccion-repuestos` is a deterministic avg-consumption rule (`stock / (usoMensual/4.33)`), NOT ML/AI. | State "reportes avanzados" without a fixed inflated number; describe the real categories. Reframe predicción as "basada en consumo promedio histórico", remove "con IA". |
| "Actualización en tiempo real ... Supabase Realtime" (L287, L293, L394) | Realtime hooks exist (`hooks/use-realtime-*.ts`) but are NOT imported anywhere — dead code. No active subscription. | Remove "tiempo real / Realtime" push claims. Reframe: cambios se reflejan al recargar/navegar; sincronización en todos los dispositivos vía la nube. |
| Cotización "aprueba online con firma digital" (L297, L300, L381) | Standalone cotización approval is click-only (`components/seguimiento/cotizacion-approval.tsx`). Firma digital exists in order recepción/entrega (mig 018/027/061), not cotización. | Cotización: aprobación/rechazo online por link (sin firma). Firma digital: recepción y entrega de órdenes. |
| "20+ plantillas" email (L342) | ~10 lifecycle types fired by cron + transactional + manual campaigns. | "Emails de ciclo de vida automáticos (bienvenida, tips, recordatorios de trial, recuperación), notificaciones transaccionales y campañas manuales". No inflated count. |
| "App nativa para Android (APK descargable)" stated flatly (L285, L356, L389) | Only debug APK confirmed locally; production signed APK in storage not confirmed. Download endpoint is conditional. iOS = waitlist only. | "PWA instalable en cualquier dispositivo + app Android (cuando esté publicada, descarga desde la web). iOS en lista de espera." Keep honest/conditional. |

### 1.2 Additions (real features currently missing from KB)

Add concise, accurate entries for:
- **Multi-sucursal**: gestión por sucursal (órdenes/ventas/caja/depósitos/usuarios). Límites por plan (Free/Emprendedor 1, Profesional 3, PRO ilimitado).
- **Multi-moneda**: 11 monedas soportadas (`lib/currency.ts`), no solo ARS/USD. Cotización del dólar en tiempo real (API externa).
- **Inventario avanzado**: multi-depósito + transferencias, variantes de producto, kits/bundles (ensamblado/desarmado atómico), lotes con fecha de vencimiento, series/IMEI, análisis ABC, reposición automática con OC sugerida, conteos físicos, historial de precios, búsqueda full-text.
- **Catálogo público (e-commerce)**: catálogo por organización, cupones de descuento, recuperación de carritos abandonados, cotización pública, checkout con MercadoPago.
- **Agenda / turnos**: gestión de turnos con disponibilidad y recordatorios automáticos.
- **Integraciones / desarrolladores**: webhooks salientes (con reintentos), API REST v1 (clientes/inventario/órdenes), API keys.
- **Finanzas extra**: comisiones de vendedores + liquidación, gastos recurrentes, estado de resultados (PnL mensual), notas de crédito en devoluciones.
- **Proveedores**: órdenes de compra, comparativa de precios entre proveedores, ajuste masivo de precios, importación de lista de precios.
- **WhatsApp (precisión)**: integración real — provider Meta Cloud API oficial o Evolution (self-hosted) según config de la org; 50+ plantillas configurables por estado/evento.
- **Notificaciones push**: web (VAPID) y nativas (Capacitor/FCM).

### 1.3 Constraints
- Keep the AFIP honesty rule intact (no factura electrónica AFIP; documentos no fiscales) — already correct (L474).
- Keep lead-capture strategy section unchanged (L412+).
- Keep tone/persona instructions unchanged.
- Net length: KB will grow; keep entries terse to avoid bloating token cost per chat call.

---

## Part 2 — Landing (in-place, Approach A)

### 2.1 `components/landing/features.tsx`
- **Servicio Técnico → Órdenes**: "estados en tiempo real" → "estados actualizados / seguimiento completo".
- **Servicio Técnico → Cotizaciones**: "aprueba online con firma digital" → "aprueba o rechaza online desde un link, sin crear cuenta".
- **Administración → Control de Inventario**: enrich description to mention multi-depósito, variantes, series/IMEI, lotes con vencimiento, análisis ABC y reposición sugerida (keep concise).
- **Add feature items** (within existing tabs, no new sections):
  - Multi-sucursal + multi-moneda (Administración or Finanzas tab).
  - Catálogo online / tienda (Ventas tab).
  - Integraciones y API (Productividad or Soporte tab).
- **Productividad → Reportes**: keep "Reportes avanzados"; do not imply AI for predicción (current wording lists it as a feature name, acceptable — verify no "IA" label is added).

### 2.2 `components/landing/comparison.tsx`
- Row "Órdenes de trabajo" STApp cell: "Digitales con estados en tiempo real" → "Digitales con estados y seguimiento".
- Row "Cotizaciones online" STApp cell: "Aprobación con firma digital" → "Aprobación/rechazo online".
- Add rows: **Multi-sucursal** (STApp: incluido / Excel: No / Papel: No), **Catálogo online** (STApp: tienda + MercadoPago / Excel: No / Papel: No), **Integraciones / API** (STApp: webhooks + API REST / Excel: No / Papel: No).

### 2.3 `components/landing/hero.tsx`
- `benefits` array: keep accurate; replace/add one to surface **Multi-sucursal** (e.g. swap a redundant benefit). Keep "Asistente IA 24/7" (Santi is real).
- Scrub any "tiempo real" phrasing in subhead/benefits (subhead currently has none — verify).

### 2.4 `components/landing/pricing-section.tsx`
- Profesional features: "15+ reportes avanzados" → "Reportes avanzados" (drop the inflated count). Apply the same de-numbered wording consistently in `features.tsx` ("15+ Reportes Avanzados") and `comparison.tsx` ("15+ reportes avanzados").
- Add a sucursales line per plan if it fits the existing card layout (Free: 1 sucursal; Profesional: hasta 3) — only if non-disruptive to layout.
- Verify Free plan limits in copy (15 órdenes/mes, 1 técnico, 30 clientes) still match plan config — leave as is if correct.

### 2.5 FAQ — `app/page.tsx` (`faqData`)
- Add: **"¿Puedo manejar varias sucursales?"** → yes, con límites por plan.
- Add: **"¿STApp tiene API o integraciones?"** → webhooks salientes + API REST v1 + API keys.
- Keep Q3 iOS "coming soon" (honest). No realtime FAQ.

### 2.6 `components/landing/footer.tsx`
- Fix WhatsApp support number `5491100000000` → `5491169625733` (match floating button) and its `wa.me` link.

### 2.7 Out of scope (explicit)
- No new top-level landing sections (that is Approach B / phase 2).
- No testimonials (section stays empty by honesty rule).
- Do not assert a published production Android APK; the download component is already conditional — leave its logic untouched.
- Do not change pricing values (DB-driven) or plan structure.

---

## Verification

- No unit tests for marketing copy or KB string (no infra; consistent with project convention).
- `npx tsc --noEmit` must pass (exclude stale `.next/` generated files if dev server left artifacts).
- `npm run build` must succeed (run with dev server stopped).
- Manual visual review of landing sections after build.
- KB: confirm `buildContextPrompt()` still returns a single valid template string (no broken interpolation of `prices`).

## Risks
- KB string is large; careless edits can break template literal interpolation (`${...}`) → build error. Mitigate: edit in small, contiguous blocks.
- Landing copy arrays are hardcoded; adding items must match existing TypeScript shapes (icon, title, description). Follow existing item structure exactly.

## Files touched
- `app/api/chatbot/route.ts` (KB only)
- `components/landing/features.tsx`
- `components/landing/comparison.tsx`
- `components/landing/hero.tsx`
- `components/landing/pricing-section.tsx`
- `components/landing/footer.tsx`
- `app/page.tsx` (faqData)
