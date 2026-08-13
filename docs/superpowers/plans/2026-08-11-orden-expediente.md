# Orden "Expediente" Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `generateOrdenPDF` as the approved "Expediente" design (dirección D): RECEPCIÓN sheet with client part + cut line + business stub, and ENTREGA sheet as a full case file — with logo, Archivo/Plex Mono type, state timeline, work breakdown, warranty box and attribution.

**Architecture:** Data layer first (route joins + `OrdenPDFData` extension), then the two sheets. The mockup file `docs/superpowers/mockups/2026-08-11-orden-maximal.html` is the DESIGN SOURCE OF TRUTH — implementers read it before drawing anything. pdf-lib stays; new fonts embed as static TTFs like Inter does today. Branch `feat/orden-expediente` chains on `feat/remito-contable-datos` (PR #290 chain) because both touch `lib/pdf.ts`.

**Tech Stack:** pdf-lib, `lib/pdf-style.ts` (`MONO`, `TYPE`, helpers), NEW fonts (Archivo + Archivo Condensed + IBM Plex Mono, SIL OFL), vitest + `extractPdfText` (multi-page), env-gated sample generator.

**Spec:** `docs/superpowers/specs/2026-08-11-orden-expediente-redesign-design.md` (commit alongside this plan on the D branch)

## Global Constraints

- Design target: `docs/superpowers/mockups/2026-08-11-orden-maximal.html` — Hoja 1 = ENTREGA, Hoja 2 = RECEPCIÓN with ✂ cut line. Match structure and hierarchy; exact mm values may adapt to pdf-lib metrics, proportions may not.
- THIS DOCUMENT ONLY may use solid `MONO.ink` fills with white text (money band, estado tag, timeline active step) — supersedes the totalBg-only rule locally. Other generators keep their rules.
- Fonts: Archivo (Regular/Bold/Black + Condensed Bold/Black for big numbers), IBM Plex Mono (Regular) as static TTFs in `lib/fonts/`, embedded per the existing Inter pattern (`loadFonts`/`embedCustomFonts` — extend, don't break other generators that keep Inter).
- Access code (PIN/pattern) renders ONLY on the business stub — REMOVED from the client part (security improvement; the plan's tests assert its absence from the soloCliente variant).
- `soloCliente: true` (WhatsApp share) = client part only, no stub, no cut line.
- Behavior preserved: dynamic height crop, photo page appended as today, `notas_internas` NEVER rendered, terminología labels respected, QR to seguimiento.
- Every string single-drawText; MONO palette (+ the local ink-fill exception); vitest one file at a time; full suite plain `npx vitest run`.
- Conventional commits; no attribution; bash syntax. Shared tree: `git log --oneline -3` before each commit; unrelated commit on top → STOP and report.
- Data on sheets per state: non-terminal estados → RECEPCIÓN sheet; `ENTREGADO`/`ENTREGADO_SIN_REPARACION`/`ENTREGADO_SIN_COBRO` → ENTREGA sheet. Blocks with absent data are omitted (same conditional discipline as the remito).

## File Structure

- Add: `lib/fonts/Archivo-{Regular,Bold,Black}.ttf`, `lib/fonts/ArchivoCondensed-{Bold,Black}.ttf` (family "Archivo_Condensed" statics), `lib/fonts/IBMPlexMono-Regular.ttf`.
- Modify: `lib/pdf.ts` (font loader + `OrdenPDFData` + `generateOrdenPDF` full rewrite of layout code; other generators untouched).
- Modify: `app/api/ordenes/[id]/pdf/route.ts` (+ same additions to `app/api/public/ordenes/[token]/pdf/route.ts` ONLY for fields it already exposes publicly — no new data leaks to the public route).
- Modify/extend: `__tests__/lib/orden-pdf.test.ts`, `__tests__/lib/orden-fixture.ts`, `__tests__/pdf-samples.test.ts`, `__tests__/api/ordenes-recepcion-null.test.ts` (route mock additions).

---

### Task D1: Fonts + shared scaffolding

**Files:** `lib/fonts/*` (new TTFs), `lib/pdf.ts` (loader), `__tests__/lib/pdf-style.test.ts` or new `__tests__/lib/pdf-fonts.test.ts`

- [ ] Download the static TTFs (Google Fonts GitHub releases; SIL OFL — no attribution needed in-app) and place them in `lib/fonts/`. Verify each embeds: unit test creating a doc, embedding all six faces, drawing a glyph string with each, asserting save succeeds and buffer size sane.
- [ ] Extend the font loader following the existing Inter pattern (lazy `loadFonts()` cache) with a separate `loadExpedienteFonts()`/extension so other generators' Inter path is untouched.
- [ ] Commit `feat(pdf): embed Archivo and Plex Mono fonts for the orden expediente`.

### Task D2: Data layer — `OrdenPDFData` extension + route joins

**Files:** `lib/pdf.ts` (interface only), `app/api/ordenes/[id]/pdf/route.ts`, `__tests__/api/ordenes-recepcion-null.test.ts` (or a new route test file following its mock pattern)

**Produces (exact optional fields, Tasks D3/D4 consume):** `codigoOrden`, `diagnostico`, `costoFinal`, `totalCobrado`, `estadoCobro`, `descuentoCobro`, `motivoSinCobro`, `telefonoContacto`, `metadataCampos?: Array<{label: string; valor: string}>` (flattened from `metadata` JSONB via the tipo's config), `esReingreso`, `ordenOrigenNumero?`, `fechaCompletado`, `cliente.{dni,cuit,razonSocial,tipoCliente}`, `emailEmpresa`, `sucursal?: {nombre, direccion?, telefono?}`, `tecnicoNombre?`, `recibidoPorNombre?`, `trabajos?: Array<{nombre, cantidad, importe}>` (repuestos_orden precio_venta_unitario; cost fields NEVER), `garantia?: {dias, fechaVencimiento, notas?}`, `cobros?: Array<{fecha, metodo, referencia?, monto}>` (non-anulado), `timeline?: Array<{estado, fecha}>` (orden_tiempos_estado inicio per estado, first occurrence), checklist items gain `categoria?`.

- [ ] Tests first (route mock: org/orden rows with the new data → pdfData carries the mapped fields; absent rows → fields undefined). Route: zero-cost maps + new joins (sucursales, users ×2 via separate lookups or a joined select, repuestos_orden, garantias, cobros_orden filtered anulado, orden_tiempos_estado ordered by inicio, checklist select gains categoria). Public route: only diagnostico/codigoOrden/timeline (already public on seguimiento) — nothing else.
- [ ] `npx tsc --noEmit` + touched test files. Commit `feat(pdf): feed the orden expediente data layer`.

### Task D3: RECEPCIÓN sheet (client part + ✂ + business stub)

**Files:** `lib/pdf.ts` (`generateOrdenPDF` — replaces the current client-copy page + copia-local page + their merge), tests.

- [ ] Read the mockup's Hoja 2 first. Implement: client part (logo box 15mm, org+sucursal header, `#numero` + `codigoOrden` + estado tag, 7-step timeline with only completed states dated, cliente with DNI/CUIT + razón social, equipo + metadataCampos line, falla, accesorios + fotos-count, money3 band (presupuesto/seña+método/saldo with ink-fill last cell), prometida line, QR + track + firma cliente + "Recibió {recibidoPorNombre}"), cut line with labels, business stub (dense grid: cliente/tel, equipo/IMEI, access code + pattern ONLY HERE, compact checklist with damage notes, notas de mostrador + técnico, presupuesto/seña, prometida). `soloCliente` → client part only.
- [ ] Tests: extend orden-pdf.test.ts — new content present (codigoOrden, DNI, recibidoPor, "TALÓN" heading), access code ABSENT from soloCliente variant text, PRESENT in full output; existing assertions updated where labels changed (each change listed in the report).
- [ ] Commit `feat(pdf): rebuild orden recepcion sheet as expediente with cut line`.

### Task D4: ENTREGA sheet (full expediente)

**Files:** `lib/pdf.ts` (replaces the current entrega page path), tests.

- [ ] Read the mockup's Hoja 1. Implement: full header + dated timeline, cliente/equipo cells, falla + diagnóstico side by side, accesorios/código(stub-only rule does not apply here? — NO: entrega sheet is client-facing; access code does NOT render), fotos counts, trabajo realizado table + totals (presupuesto, subtotal, descuento, TOTAL FINAL `costoFinal`, SALDO band from `totalCobrado` — ink fill), pagos table, checklist by categoria, garantía box (only when `garantia` present), attribution row + 3 signatures, terms. `motivoSinCobro` renders as a labeled line when present (ENTREGADO_SIN_COBRO / SIN_REPARACION cases).
- [ ] Tests: ENTREGADO fixture with trabajos/garantía/cobros/timeline → all present in text; totals arithmetic asserted via formatted strings; garantía absent → box absent.
- [ ] Commit `feat(pdf): rebuild orden entrega sheet as full expediente`.

### Task D5: Samples + suite + USER VISUAL GATE + PR

- [ ] Enrich `buildOrdenFixture` + samples: `{TAG}-orden.pdf` (recepción, all conditional data), `{TAG}-orden-entregada.pdf` (full expediente), `{TAG}-orden-solocliente.pdf`. Regenerate, rasterize, eyeball against the mockups side by side.
- [ ] Full suite green. Commit samples.
- [ ] USER VISUAL GATE (blocking): present the PDFs vs mockups. Apply feedback.
- [ ] Push + PR targeting `feat/remito-contable-datos` (chain note + merge order + branch-deletion gotcha in body).
