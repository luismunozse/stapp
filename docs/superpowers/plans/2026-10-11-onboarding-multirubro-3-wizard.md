# Rubro-aware onboarding, PR 3 (Wizard and UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the phone-shop onboarding wizard with a rubro-aware one that sends shops with a real device straight to their first order, lets the rest run a full practice order in under two minutes, and marks that practice order everywhere it shows up.

**Architecture:** `app/(dashboard)/onboarding/page.tsx` becomes a server data source. A colocated loader reads the org, the owner, the active tipos, the real-order count and the practice, and passes them as props to a client shell in `components/onboarding/wizard/`, which has one file per step. The practice talks only to PR 1's `/api/onboarding/practica`. The rubro change talks only to PR 2's `PUT /api/onboarding/rubro`, then refreshes the server props and the root `CurrencyProvider`. Orders, the order detail and clients read PR 1's `esPractica` flag. A practice order gets its own read-only detail component, so no money or stock action can ever render for it.

**Tech Stack:** Next.js App Router (server component page + client components), React 19, TypeScript strict, Tailwind 3 + tailwindcss-animate, shadcn/Radix UI (`Dialog`), SWR, lucide-react, vitest 4 + Testing Library + jsdom.

**Spec:** `docs/superpowers/specs/2026-10-11-onboarding-multirubro-design.md` (sections "User flow", "UI", "Error handling", "Testing"). PR 1 (server) and PR 2 (rubro endpoint) are planned separately and merge before this one.

## Decisions needed before apply

Each one has a default, so the plan can run as written.

1. **Review size (Decision needed).** The estimate is about 1,600 production lines added and 540 removed (the old wizard), plus about 1,800 test lines. That is far over the 400-line budget. Proposed chained split at task boundaries:
   - **3a**, Tasks 1–3: practice surfaces in orders and clients. About 260 production and 340 test lines. Needs only PR 1.
   - **3b**, Tasks 4–7: pure helpers, the `CurrencyProvider` reload, the practice step and the rubro selector. Nothing is wired to a page yet.
   - **3c**, Tasks 8–10: the shell, the steps, the page and the loader, and the deletion of the old wizard.

   The alternative is one PR with `size:exception`.
2. **Gender agreement (Decision needed; default: helper).** The spec copy "¿Tenés un {equipo}…" and "Sí, tengo uno" is wrong for relojería ("Pieza") and for many genérico terms derived from free text ("Máquina de café"). Default: a pure `articuloIndefinido()` heuristic picks "un"/"una" and "uno"/"una" (Task 4). Alternative: a plural, article-free wording.
3. **Non-ADMIN on `/onboarding` (default: redirect to `/dashboard`).** Today the page renders for any role, and every request the wizard makes answers 403.
4. **"TODOS" tipo (default: hidden in the practice form).** "Todos los dispositivos" is the electrónica catch-all bucket, not a device someone brings in. It is shown only when it is the only active tipo.

## Global Constraints

- **Strict TDD.** For every behavior: write the failing test, run it and see it fail, write the minimal code, run it and see it pass, commit.
- **Commits.** Conventional commits in English, small work units. NO `Co-Authored-By` and no AI attribution of any kind (user rule; it overrides any harness default).
- **Definition of done.** It includes `npx tsc --noEmit`. Lint with `npx eslint <dirs>`. Never use `npm run lint`: it walks every worktree and never finishes.
- **`rg`.** Always pass an explicit path (or `-` for stdin). Never a bare `rg "pattern"`: the repo root holds `.env*` and the implicit walk trips the deny rule. Never read `.env*` files.
- **Timezones.** Every `toLocale*String` call passes `timeZone`. This plan adds none. Money uses `formatCurrencyValue(amount, moneda)` and `CURRENCIES[moneda].symbol` from `lib/currency.ts`. Never hardcode `$` or `es-AR`.
- **Copy.**
  - Every UI string is Spanish with Rioplatense voseo, and sounds like STApp.
  - No internal jargon in user-facing text: no "es_practica", no "seed", no "pack", no "camino".
  - Code, identifiers, comments and test names follow the file they live in. New files: English comments.
- **Contract with PR 1 and PR 2.** Consume these names exactly. Never rename them, never re-implement them here.
  - `lib/onboarding/practica-shared.ts`: `PracticaOrden`, `PracticaEstado`, `PRACTICA_PROBLEMAS_GENERICOS`.
  - `lib/onboarding/practica.ts`: `getPracticaOrden`.
  - `/api/onboarding/practica`: GET, POST, PATCH, DELETE.
  - `POST /api/onboarding/complete` with optional `{ camino }`.
  - `PUT /api/onboarding/rubro`.
- **Practice is read-only outside the wizard.** No UI path may offer a state change, cobro, seña, parts, cotización, factura, print or generic delete for an order with `esPractica`.
- **Navigation after a POST happens in `finally`, exactly once.** A failed request never leaves a CTA doing nothing.
- **Radix Select echo gotcha.** Never use Radix `Select` in the wizard: it can echo an empty value when set while closed. Use native `<select>` or the existing radio-card `RubroPicker`.
- **Lists.** `DataTable` row clicks do not stop propagation. Every button inside a row calls `e.stopPropagation()`.
- **Manual check.** A full pass on the Vercel preview with a real inbox happens before merge (Task 12, needs the user).

## Review Focus

These are the five inputs most likely to bite a real shop that the spec implies but does not spell out. Each has a test in the task that owns the code.

1. **Feminine vocabulary term** (relojería "Pieza", genérico "Máquina de café"). The question and its "Sí" button must agree: "¿Tenés una pieza para cargar ahora?" / "Sí, tengo una". Tests: Task 4 (helper table) and Task 8 (question step).
2. **The practice changes under the wizard.** It can be advanced from another tab, or deleted from the orders list or by a rubro change. PATCH then answers 409 or 404. The wizard re-reads `GET /api/onboarding/practica` and continues from the real state; it never shows a dead-end error. Test: Task 6.
3. **Double tap on a completion CTA on a slow phone.** "Sí, tengo uno", "Cargar mi primera orden real" and "Omitir" must send exactly one `POST /api/onboarding/complete` and one `router.push`. Test: Task 8.
4. **Money typed the es-AR way in "¿Cuánto cobrarías?".** "15.000" must give 15000 and "1500,50" must give 1500.5, never 15 or 1500. Test: Task 6.
5. **Vocabulary on the next screen after a rubro change.** `/ordenes?nueva=1` reads terminology from the root `CurrencyProvider` (`components/providers.tsx:53`), which fetches it once per session. After a rubro change it must reload, or the order form keeps saying "Artefacto". Tests: Task 5 (`refreshConfig`) and Task 8 (the shell calls it).

---

## Facts this plan relies on (verified 2026-10-11)

| Fact | Where |
|---|---|
| The page renders `<OnboardingWizard />` with no props and checks only `auth()` | `app/(dashboard)/onboarding/page.tsx:5-9` |
| The old wizard: STEPS at 33-39, the #443 single save at 121-166, the logo validation at 88-118, the #445 completion at 209-222, the client step at 364-442 (sample data at 413-428) | `components/onboarding/onboarding-wizard.tsx` |
| The old wizard calls `GET /api/onboarding/progress` on mount, which creates the `onboarding_progress` row. Only the register route creates it otherwise | `components/onboarding/onboarding-wizard.tsx:62-68`, `app/api/onboarding/progress/route.ts:16-24`, `app/api/auth/register/route.ts:287-289` |
| Order list and detail responses are mapped by `formatOrden`. The clients list is mapped by `formatCliente` over the view `v_clientes_resumen`, so the flag is camelCase `esPractica` | `lib/db-utils.ts:64-190`, `app/api/ordenes/route.ts:268`, `app/api/ordenes/[id]/route.ts:158`, `app/api/clientes/route.ts:93-99` |
| `v_clientes_resumen` froze the `c.*` expansion. A new `clientes` column is invisible until the view is recreated | `supabase/migrations/294_precios_mayoristas_clientes.sql:42-57` |
| The signup's `RubroPicker` is already a shared component: a radio-card group plus the genérico text input. It is reusable as is, with no Radix Select | `components/registro/rubro-picker.tsx`, used at `app/(auth)/registro/page.tsx:397-403` |
| Rubro validation (genérico needs a text) | `lib/rubros/seleccion.ts:13-39` |
| Pack terms are "Artefacto", "Vehículo", "Rodado", "Pieza" (feminine), and `{}` for electrónica and genérico. Genérico derives the term from free text | `lib/rubros/packs/*.ts`, `lib/rubros/detalle.ts:81-118` |
| `CurrencyProvider` fetches terminology once per `organizationId` and has no reload | `contexts/currency-context.tsx:49-87` |
| Money parsing for es-AR input | `lib/parse-money.ts:20-39` |
| The order detail has about 15 action surfaces (header buttons, dropdown, estado card, costos card, comisión, tabs, garantía, 4 dialogs). All its hooks run before the `if (!orden)` return | `components/ordenes/orden-detail.tsx:103-577` |
| The list action cell already stops propagation, and `DataTable` guards interactive targets. Buttons still stop propagation themselves | `components/ordenes/ordenes-list.tsx:531`, `components/ui/data-table.tsx:305-308` |
| `Button` already has a focus ring, `active:scale-[0.98]` and `ease-[var(--ease-out)]`. `Input` is `text-base` on mobile (no iOS zoom). Global `prefers-reduced-motion` is handled | `components/ui/button.tsx:7`, `components/ui/input.tsx:13`, `app/globals.css:366-379` |
| `ease-snappy` sets the animation timing too (tailwindcss-animate) | `tailwind.config.ts:135-138` |
| Test command: `npx vitest run <path-or-filter>`. Global mocks for `@/lib/auth` and `@/lib/supabase` | `package.json:11`, `vitest.setup.ts:48-88` |

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `types/index.ts` (modify) | `esPractica?: boolean` on `Cliente` and `OrdenServicio`, if PR 1 did not add it | 1 |
| `components/onboarding/practica-badge.tsx` (create) | The "Práctica" pill, plus the optional "se borra…" note | 1 |
| `components/onboarding/use-borrar-practica.ts` (create) | Confirm, then `DELETE /api/onboarding/practica`, then a callback | 1 |
| `components/ordenes/ordenes-list.tsx` (modify) | Badge, "Borrar práctica", no bulk checkbox or trash for the practice | 1 |
| `components/ordenes/orden-mobile-card.tsx` (modify) | The same on mobile cards | 1 |
| `components/onboarding/ver-lo-que-ve-tu-cliente.tsx` (create) | New-tab link to `/seguimiento/{publicToken}` | 2 |
| `components/ordenes/practica-orden-detail.tsx` (create) | Read-only practice order view | 2 |
| `components/ordenes/orden-detail.tsx` (modify) | Early return to `PracticaOrdenDetail` | 2 |
| `components/clientes/clientes-list.tsx`, `components/clientes/cliente-mobile-card.tsx` (modify) | Practice client badge | 3 |
| `lib/terminologia.ts` (modify) | `articuloIndefinido()` | 4 |
| `components/onboarding/wizard/types.ts` (create) | Wizard props and step types | 4 |
| `components/onboarding/wizard/wizard-state.ts` (create) | Pure resume, label and suggestion logic | 4 |
| `contexts/currency-context.tsx` (modify) | `refreshConfig()` | 5 |
| `components/onboarding/wizard/practica-api.ts` (create) | Typed calls to `/api/onboarding/practica` | 6 |
| `components/onboarding/wizard/chips.tsx` (create) | Suggestion chips that fill an input | 6 |
| `components/onboarding/wizard/practica-recibir.tsx` (create) | The "Recibir" form | 6 |
| `components/onboarding/wizard/practica-step.tsx` (create) | Tracker, sub-step switch, reparar, entregar, errors and resync | 6 |
| `components/onboarding/wizard/rubro-selector.tsx` (create) | "Tu rubro: X · Cambiar", plus the dialog | 7 |
| `components/onboarding/wizard/negocio-step.tsx` (create) | Name, logo (#443 behavior) and rubro | 8 |
| `components/onboarding/wizard/pregunta-step.tsx` (create) | "¿Tenés un {equipo}…?" | 8 |
| `components/onboarding/wizard/onboarding-wizard.tsx` (create) | Shell: steps, welcome, focus, completion, Omitir | 8, 9 |
| `components/onboarding/wizard/listo-step.tsx` (create) | Final step | 9 |
| `app/(dashboard)/onboarding/wizard-props.ts` (create) | Server loader that builds `OnboardingWizardProps` | 10 |
| `app/(dashboard)/onboarding/page.tsx` (modify) | Auth, ADMIN gate, loader, wizard | 10 |
| `components/onboarding/onboarding-wizard.tsx` (delete) | The old wizard: sample data and "Primer cliente" | 10 |

## Interfaces (whole PR)

```ts
// ---- Consumed from PR 1 (exact names) -------------------------------------
// lib/onboarding/practica-shared.ts (client-safe)
export type PracticaEstado = "RECIBIDO" | "REPARADO" | "ENTREGADO_SIN_COBRO"
export interface PracticaOrden { id: string; estado: PracticaEstado; publicToken: string; tipoDispositivo: string; dispositivo: string; problemaReportado: string; costoFinal: number | null }
export const PRACTICA_PROBLEMAS_GENERICOS: readonly ["No enciende", "Funciona con fallas", "Hace ruido", "Mantenimiento"]
// lib/onboarding/practica.ts (server)
export async function getPracticaOrden(organizationId: string, client?): Promise<PracticaOrden | null>
// HTTP
// GET    /api/onboarding/practica                      -> 200 { practica: PracticaOrden | null }
// POST   /api/onboarding/practica { tipoDispositivo, dispositivo, problemaReportado } -> 201 { practica }
// PATCH  /api/onboarding/practica { accion: "reparar", costoFinal } | { accion: "entregar" } -> 200 { practica }; 404 none; 409 wrong state
// DELETE /api/onboarding/practica                      -> 200 { ok: true }
// POST   /api/onboarding/complete  optional body { camino?: "real" | "omitido" }
// Response flags (camelCase, because rows are mapped by formatOrden / formatCliente):
//   GET /api/ordenes            data[].esPractica: boolean
//   GET /api/ordenes/[id]       esPractica: boolean
//   GET /api/clientes           data[].esPractica: boolean   (needs v_clientes_resumen recreated by PR 1)

// ---- Consumed from PR 2 ----------------------------------------------------
// PUT /api/onboarding/rubro { rubro: string; rubroDetalle?: string | null }
//   -> 200 { rubro; rubroDetalle; tiposActivos: number }   (tiposActivos is ignored: router.refresh() re-reads the tipos)
//   Same rubro (curated: same id; genérico: same trimmed rubroDetalle) short-circuits server-side without
//   deleting the practice; RubroSelector mirrors that rule and sends no request in that case.
//   -> 409 { error } when real orders exist

// ---- Produced by this PR ---------------------------------------------------
// types/index.ts
interface Cliente { /* … */ esPractica?: boolean }
interface OrdenServicio { /* … */ esPractica?: boolean }

// components/onboarding/wizard/types.ts
export interface TipoPractica { codigo: string; nombre: string; marcas: string[]; problemasComunes: string[] }
export interface RubroVigente { rubro: string; rubroDetalle: string | null }
export type CaminoCompletar = "real" | "omitido"
export type PasoWizard = "bienvenida" | "negocio" | "pregunta" | "practica" | "listo"
export type SubPasoPractica = "recibir" | "reparar" | "entregar" | "terminada"
export interface OnboardingWizardProps {
  nombreNegocio: string          // organizations.nombre_mostrar || organizations.nombre || ""
  logoUrl: string | null         // organizations.logo_url
  rubro: string                  // getRubro(organizations.rubro).id (unknown -> "generico")
  rubroDetalle: string | null    // organizations.rubro_detalle
  ownerNombre: string            // users.nombre by session.user.id, fallback session.user.name
  ownerEmail: string             // users.email, fallback session.user.email
  tipos: TipoPractica[]          // active tipos_dispositivo by `orden`; "TODOS" dropped unless alone
  terminologia: Terminologia     // resolveTerminologia(organizations.terminologia)
  moneda: CurrencyCode           // organizations.moneda, DEFAULT_CURRENCY when unknown
  ordenesRealesCount: number     // count(ordenes_servicio) where es_practica = false
  practica: PracticaOrden | null // getPracticaOrden(organizationId)
}

// lib/terminologia.ts
export function articuloIndefinido(termino: string): "un" | "una"
// contexts/currency-context.tsx
useCurrency().refreshConfig: () => void
// components/onboarding/wizard/wizard-state.ts
export const PASOS: { key: PasoWizard; titulo: string }[]
export function subPasoPractica(practica: PracticaOrden | null): SubPasoPractica
export function pasoInicial(practica: PracticaOrden | null): PasoWizard
export function etiquetaRubro(rubro: string, rubroDetalle: string | null): string
export function problemasParaPractica(tipo: TipoPractica | undefined): string[]
export function marcasParaPractica(tipo: TipoPractica | undefined): string[]
// components/onboarding/wizard/practica-api.ts
export interface NuevaPractica { tipoDispositivo: string; dispositivo: string; problemaReportado: string }
export type ResultadoPractica = { ok: true; practica: PracticaOrden | null } | { ok: false; status: number; error: string }
export const practicaApi: { leer(): Promise<ResultadoPractica>; crear(b: NuevaPractica): Promise<ResultadoPractica>; reparar(costoFinal: number): Promise<ResultadoPractica>; entregar(): Promise<ResultadoPractica> }
// components (props)
PracticaStep({ practica, tipos, terminologia, ownerEmail, moneda, onPracticaChange(p), onAtras() })
RubroSelector({ rubro, rubroDetalle, bloqueado, onGuardado(r: RubroVigente), onBloqueado() })
NegocioStep({ nombre, onNombreChange, logoFile, logoPreview, onLogoChange(file, preview), rubro: RubroVigente, rubroBloqueado, onRubroGuardado, onRubroBloqueado, actualizando, onAtras, onGuardado })
PreguntaStep({ terminologia, completando, onSi, onPracticar, onAtras })
ListoStep({ practica, completando, onCompletar(destino) })
OnboardingWizard(props: OnboardingWizardProps)
PracticaBadge({ conAviso?: boolean; className?: string })
useBorrarPractica(onBorrada: () => void): { borrar(): Promise<void>; borrando: boolean }
VerLoQueVeTuCliente({ publicToken: string; className?: string })
PracticaOrdenDetail({ orden: OrdenServicio; isAdmin: boolean })
OrdenMobileCard new optional props: onBorrarPractica?: () => void; borrandoPractica?: boolean
// app/(dashboard)/onboarding/wizard-props.ts
export function tiposParaPractica(rows: { codigo: string; nombre: string; config: { marcas?: unknown; problemasComunes?: unknown } | null }[]): TipoPractica[]
export async function loadOnboardingWizardProps(p: { organizationId: string; userId: string; fallbackNombre: string; fallbackEmail: string }): Promise<OnboardingWizardProps>
```

## UI states (applies to every task that renders UI)

| State | Rule |
|---|---|
| Loading | The button that started the request shows `Loader2` (spinning) plus a verb in gerund ("Guardando…", "Cargando…", "Entregando…"). Every button of that step that could start a second request is disabled. Forms wrap inputs in `<fieldset disabled>`. The rubro dialog cannot be dismissed while saving. After a rubro change, "Siguiente" shows "Actualizando…" until `router.refresh()` lands (`useTransition`). |
| Error | An inline `role="alert"` box (`border-destructive/30 bg-destructive/10 text-destructive`) right under the control that failed. Practice errors add a "Reintentar" button that repeats the exact request. "Omitir y entrar al panel" stays enabled. Never a toast inside the wizard. |
| Disabled | Submit buttons stay disabled until the input is valid, with a helper line that says what is missing. "Cambiar rubro" disabled keeps a visible one-line reason linked with `aria-describedby`. |
| Focus | All controls use the existing `focus-visible:ring-2 ring-ring ring-offset-2`. On every step or sub-step change, focus moves to the new title (`data-paso-titulo`, `tabIndex={-1}`), never on first mount. Radix `Dialog` traps focus and returns it to "Cambiar rubro". The tracker and the step dots use `<ol>` with `aria-current="step"`. Chips are `<button type="button" aria-pressed>` inside `role="group"` with an `aria-label`. |
| Motion | The step content enters with `animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-snappy` (onboarding is seen once, so a small delight is fine). Colors use `transition-colors duration-200`. Never `transition-all`. Hover styles on chips are gated with `[@media(hover:hover)]:hover:`. Reduced motion is already global. |
| Mobile (360 px) | 16 px side gutter (`px-4`). The card is full width. Button rows are `flex flex-col gap-2 sm:flex-row-reverse sm:justify-between`: primary on top and full width on phones, right-aligned on desktop. Long CTAs use `h-auto min-h-11 whitespace-normal py-3`. Chips wrap, with `min-h-9` and `[@media(pointer:coarse)]:min-h-11` touch targets. The dialog gets `w-[calc(100%-2rem)]`. No horizontal scroll. |

---

## Task 0: Preconditions and workspace (no code, no commit)

**Files:** none.

**Interfaces:**
- Consumes: the PR 1 and PR 2 contract above.
- Produces: an isolated worktree on `feat/onboarding-wizard` off `origin/main`.

- [ ] **Step 1: Confirm that PR 1 and PR 2 are merged**

Run (from `C:\Users\LUIS\Desktop\stapp`): `git fetch origin` and then `git log origin/main --oneline -30`.

Expected: both merge commits (server foundation, then rubro endpoint) are listed. If not: STOP and report to the orchestrator.

- [ ] **Step 2: Create an isolated worktree with working node_modules**

The main clone is shared between agents and its `node_modules` is broken (memory `stapp-node-modules-clon-roto`). Run from `C:\Users\LUIS\Desktop\stapp`:

```bash
git worktree add .worktrees/onboarding-wizard -b feat/onboarding-wizard origin/main
cmd //c mklink /J .worktrees\\onboarding-wizard\\node_modules .claude\\worktrees\\wa-destino\\node_modules
test -e .worktrees/onboarding-wizard/node_modules/.bin/vitest && echo ok
```

Expected: `ok`. Never `rm -rf` the junction. Every later command runs from `C:\Users\LUIS\Desktop\stapp\.worktrees\onboarding-wizard`.

- [ ] **Step 3: Verify the contract exists exactly as named**

Run each one and compare it with the expected result:

```bash
rg -n "export const PRACTICA_PROBLEMAS_GENERICOS|export interface PracticaOrden|export type PracticaEstado" lib/onboarding/practica-shared.ts   # 3 hits
rg -n "export async function getPracticaOrden" lib/onboarding/practica.ts                                                                 # 1 hit
rg -n "export async function (GET|POST|PATCH|DELETE)" app/api/onboarding/practica/route.ts                                                # 4 hits
rg -n "export async function PUT" app/api/onboarding/rubro/route.ts                                                                       # 1 hit
rg -n "camino" app/api/onboarding/complete/route.ts                                                                                       # >= 1 hit
rg -n "esPractica" lib/db-utils.ts                                                                                                         # 2 hits: formatOrden and formatCliente
rg -n -l "es_practica" supabase/migrations                                                                                                 # PR 1's migration
rg -n "esPractica" types/index.ts                                                                                                          # 0 or 2 hits (Task 1 Step 3 adds them when 0)
```

Then check two things by reading the files:

- **The clients view.** Open the migration that the `-l` search found and confirm it recreates the view: `rg -n "CREATE VIEW v_clientes_resumen" <that file>` gives 1 hit. Without it, `esPractica` never reaches the clients list (`294_precios_mayoristas_clientes.sql:42-45`).
- **The `camino` write.** Open `app/api/onboarding/complete/route.ts` and confirm `camino` is written with an `upsert(..., { onConflict: "organization_id" })`, or that the route creates the row. Today only the register route and the old wizard's `GET /api/onboarding/progress` create `onboarding_progress`, and the new wizard no longer calls that GET.

If any check fails: STOP and report the exact gap to the orchestrator. Do not implement PR 1 or PR 2 pieces on this branch.

- [ ] **Step 4: Baseline: the suites this PR touches pass before any change**

Run: `npx vitest run __tests__/components/onboarding-wizard-logo.test.tsx __tests__/components/onboarding-wizard-primera-orden.test.tsx __tests__/components/ordenes-list-nueva-param.test.tsx __tests__/lib/terminologia.test.ts __tests__/lib/terminologia-cableado.test.ts`

Expected: all PASS. If something fails before you change anything, report it. Do not fix it under this plan.

---

## Task 1: Practice order in the orders list

**Files:**
- Modify: `types/index.ts:98-118` (`Cliente`), `types/index.ts:120-174` (`OrdenServicio`)
- Create: `components/onboarding/practica-badge.tsx`
- Create: `components/onboarding/use-borrar-practica.ts`
- Modify: `components/ordenes/ordenes-list.tsx:31,115,163-169,326-328,428-451,530-560,1059-1067`
- Modify: `components/ordenes/orden-mobile-card.tsx`
- Test: `__tests__/components/ordenes-list-practica.test.tsx`

**Interfaces:**
- Consumes: `GET /api/ordenes` → `data[].esPractica`; `DELETE /api/onboarding/practica`.
- Produces: `PracticaBadge({ conAviso?, className? })`, `useBorrarPractica(onBorrada)`, `OrdenServicio.esPractica?`, `Cliente.esPractica?`, `OrdenMobileCard` props `onBorrarPractica?`, `borrandoPractica?`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/ordenes-list-practica.test.tsx`:

```tsx
/**
 * The onboarding practice order shows up in the orders list with a badge and
 * its own "Borrar práctica" action. It is never selectable for bulk state
 * changes or cobros, and the generic trash button is not offered for it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"
import { OrdenesList } from "@/components/ordenes/ordenes-list"

const push = vi.fn()
const confirm = vi.fn()
const showError = vi.fn()
let role = "ADMIN"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/ordenes",
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role } } }),
}))

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}`, formatDate: (d: string) => d }),
}))

vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ showError, showSuccess: vi.fn(), confirm }),
}))

vi.mock("@/components/ordenes/orden-form", () => ({
  OrdenForm: () => null,
}))

const PRACTICA = {
  id: "prac-1",
  numeroOrden: 0,
  codigoOrden: "PRACTICA",
  estado: "RECIBIDO",
  dispositivo: "Gafa HGF-357",
  tipoDispositivo: "HELADERA",
  fechaIngreso: "2026-10-11",
  esPractica: true,
  cliente: { id: "cli-prac", nombre: "Ana Pérez", telefono: "" },
}
const REAL = { ...PRACTICA, id: "real-1", numeroOrden: 1, codigoOrden: "HEL0001", esPractica: false }

function stubFetch(ordenes: unknown[]) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/onboarding/practica" && init?.method === "DELETE") {
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    }
    if (url.startsWith("/api/ordenes?")) {
      return { ok: true, status: 200, json: async () => ({ data: ordenes, total: ordenes.length }) }
    }
    return { ok: true, status: 200, json: async () => [] }
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

function listCalls(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/ordenes?")).length
}

function renderList() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <OrdenesList />
    </SWRConfig>
  )
}

// jsdom ignores the `hidden sm:block` / `sm:hidden` classes, so the desktop
// table and the mobile cards both render: every practice control shows twice.
describe("OrdenesList — practice order", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    role = "ADMIN"
    confirm.mockResolvedValue(true)
  })

  it("shows the practice badge with the deletion notice", async () => {
    stubFetch([PRACTICA])
    renderList()

    expect(await screen.findAllByText("Práctica")).toHaveLength(2)
    expect(screen.getAllByText(/se borra cuando cargues tu primera orden real/)).toHaveLength(2)
  })

  it("does not badge a real order", async () => {
    stubFetch([REAL])
    renderList()

    await screen.findAllByText("HEL0001")
    expect(screen.queryByText("Práctica")).not.toBeInTheDocument()
  })

  it("Borrar práctica deletes through the practice endpoint without opening the order", async () => {
    const fetchMock = stubFetch([PRACTICA])
    renderList()
    const [boton] = await screen.findAllByRole("button", { name: /Borrar práctica/i })
    const antes = listCalls(fetchMock)

    fireEvent.click(boton)

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/onboarding/practica", { method: "DELETE" })
    )
    expect(push).not.toHaveBeenCalled()
    await waitFor(() => expect(listCalls(fetchMock)).toBeGreaterThan(antes))
  })

  it("does nothing when the confirmation is cancelled", async () => {
    confirm.mockResolvedValue(false)
    const fetchMock = stubFetch([PRACTICA])
    renderList()
    const [boton] = await screen.findAllByRole("button", { name: /Borrar práctica/i })

    fireEvent.click(boton)

    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false)
  })

  it("offers no bulk checkbox and no generic delete for the practice order", async () => {
    stubFetch([PRACTICA, REAL])
    renderList()
    await screen.findAllByText("HEL0001")

    // Only the real order keeps its row checkbox (desktop table).
    expect(screen.getAllByRole("checkbox")).toHaveLength(1)
    // The desktop trash button is labelled "Eliminar"; only the real order has it.
    expect(screen.getAllByRole("button", { name: "Eliminar" })).toHaveLength(1)
  })

  it("hides Borrar práctica from non-admin roles", async () => {
    role = "VENDEDOR"
    stubFetch([PRACTICA])
    renderList()
    await screen.findAllByText("Práctica")

    expect(screen.queryByRole("button", { name: /Borrar práctica/i })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test and check that it fails**

Run: `npx vitest run __tests__/components/ordenes-list-practica.test.tsx`

Expected: FAIL. `findAllByText("Práctica")` times out, and there is no "Borrar práctica" button.

- [ ] **Step 3: Write the minimal implementation**

3a. In `types/index.ts`, skip this if Task 0 Step 3 found `esPractica` already. Add to `Cliente`, after `ultimaVisita?: string | null`:

```ts
  /** Onboarding practice client (clientes.es_practica). */
  esPractica?: boolean
```

Add to `OrdenServicio`, after `esReingreso?: boolean`:

```ts
  /** Onboarding practice order (ordenes_servicio.es_practica): read-only everywhere. */
  esPractica?: boolean
```

3b. Create `components/onboarding/practica-badge.tsx`:

```tsx
import { GraduationCap } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface PracticaBadgeProps {
  /** Adds "· se borra cuando cargues tu primera orden real" next to the pill. */
  conAviso?: boolean
  className?: string
}

export function PracticaBadge({ conAviso = false, className }: PracticaBadgeProps) {
  return (
    <div className={cn("inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5", className)}>
      <Badge variant="infoSoft" showIcon icon={GraduationCap}>
        Práctica
      </Badge>
      {conAviso && (
        <span className="text-xs text-muted-foreground">
          · se borra cuando cargues tu primera orden real
        </span>
      )}
    </div>
  )
}
```

3c. Create `components/onboarding/use-borrar-practica.ts`:

```ts
import { useState } from "react"
import { toast } from "sonner"
import { useModal } from "@/contexts/modal-context"

/**
 * Deletes the onboarding practice (order + client + its notifications) through
 * the narrow practice endpoint. Never through DELETE /api/ordenes/[id], which
 * would leave the practice client and the bell notifications behind.
 */
export function useBorrarPractica(onBorrada: () => void) {
  const { confirm, showError } = useModal()
  const [borrando, setBorrando] = useState(false)

  const borrar = async () => {
    const confirmado = await confirm({
      title: "Borrar práctica",
      description: "Se borran la orden de práctica y su cliente. Tus datos reales no se tocan.",
      confirmText: "Borrar",
      cancelText: "Cancelar",
      variant: "danger",
    })
    if (!confirmado) return

    setBorrando(true)
    try {
      const res = await fetch("/api/onboarding/practica", { method: "DELETE" })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        await showError(body?.error || "No pudimos borrar la práctica. Probá de nuevo.")
        return
      }
      toast.success("Práctica borrada")
      onBorrada()
    } catch (err) {
      console.error("Error deleting the practice:", err)
      await showError("No pudimos borrar la práctica. Revisá tu conexión y probá de nuevo.")
    } finally {
      setBorrando(false)
    }
  }

  return { borrar, borrando }
}
```

3d. `components/ordenes/ordenes-list.tsx`:

After `import { OrdenMobileCard } from "./orden-mobile-card"` (line 31), add:

```tsx
import { PracticaBadge } from "@/components/onboarding/practica-badge"
import { useBorrarPractica } from "@/components/onboarding/use-borrar-practica"
```

After `const isTecnico = session?.user?.role === "TECNICO"` (line 115), add:

```tsx
  const isAdmin = session?.user?.role === "ADMIN"
```

Replace `toggleSelectAll` (lines 163-169) with:

```tsx
  const toggleSelectAll = () => {
    // The practice order never joins bulk state changes or cobros.
    const seleccionables = ordenes.filter((o) => !o.esPractica)
    if (selectedIds.size === seleccionables.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(seleccionables.map((o) => o.id)))
    }
  }
```

After `const total = data?.total || 0` (line 328), add:

```tsx
  const { borrar: borrarPractica, borrando: borrandoPractica } = useBorrarPractica(() => mutate())
```

In the `select` column, replace `render: (orden) => (<input … />),` (lines 428-439) with:

```tsx
      render: (orden) =>
        orden.esPractica ? null : (
          <input
            type="checkbox"
            checked={selectedIds.has(orden.id)}
            onChange={(e) => {
              e.stopPropagation()
              toggleSelect(orden.id)
            }}
            onClick={(e) => e.stopPropagation()}
            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
          />
        ),
```

In the `numeroOrden` column, replace its `render` (lines 446-450) with:

```tsx
      render: (orden) => (
        <div className="flex flex-col items-start gap-1">
          <span className="text-primary font-semibold">
            {orden.codigoOrden || `#${orden.numeroOrden}`}
          </span>
          {orden.esPractica && <PracticaBadge conAviso className="max-w-[220px]" />}
        </div>
      ),
```

In the `actions` column, replace everything after the `</Link>` of "Ver orden", up to the closing `</div>` (lines 537-558), with:

```tsx
          {orden.esPractica ? (
            isAdmin && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive"
                onClick={(e) => {
                  // DataTable row clicks do not stop propagation: without this the row opens the order.
                  e.stopPropagation()
                  void borrarPractica()
                }}
                disabled={borrandoPractica}
              >
                <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Borrar práctica
              </Button>
            )
          ) : (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-primary"
                onClick={(e) => handlePrint(e, orden)}
                title="Imprimir"
                aria-label="Imprimir"
              >
                <Printer className="h-4 w-4" />
              </Button>
              {!isTecnico && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={(e) => handleDelete(e, orden)}
                  disabled={deleting === orden.id}
                  aria-label="Eliminar"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </>
          )}
```

In the mobile `OrdenMobileCard` usage (lines 1059-1067), add two props:

```tsx
                  onBorrarPractica={isAdmin ? () => void borrarPractica() : undefined}
                  borrandoPractica={borrandoPractica}
```

3e. `components/ordenes/orden-mobile-card.tsx`:

Add the import:

```tsx
import { PracticaBadge } from "@/components/onboarding/practica-badge"
```

Extend the props interface:

```tsx
  /** Only for the onboarding practice order (ADMIN). */
  onBorrarPractica?: () => void
  borrandoPractica?: boolean
```

Destructure the new props in the signature: `({ orden, onDelete, onPrint, deleting, onClick, hideDelete, onBorrarPractica, borrandoPractica }: OrdenMobileCardProps)`.

Replace the header block (lines 27-32) with:

```tsx
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="min-w-0 space-y-1">
            <span className="text-primary font-semibold text-sm">
              {orden.codigoOrden || `#${orden.numeroOrden}`}
            </span>
            {orden.esPractica && <PracticaBadge conAviso />}
          </div>
          <OrderStatusBadge status={orden.estado} showIcon />
        </div>
```

Inside the actions `div` (lines 83-109), keep the "Ver detalle" `Link`. Replace the print and delete buttons that follow it with:

```tsx
          {orden.esPractica ? (
            onBorrarPractica && (
              <Button
                variant="ghost"
                size="sm"
                className="h-10 px-3 text-sm text-muted-foreground hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation()
                  onBorrarPractica()
                }}
                disabled={borrandoPractica}
              >
                <Trash2 className="h-4 w-4 mr-1.5" aria-hidden="true" />
                Borrar práctica
              </Button>
            )
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-10 w-10 text-muted-foreground hover:text-primary"
                onClick={(e) => onPrint(e, orden)}
              >
                <Printer className="h-4 w-4" />
              </Button>
              {!hideDelete && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-10 w-10 text-muted-foreground hover:text-destructive"
                  onClick={(e) => onDelete(e, orden)}
                  disabled={deleting}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </>
          )}
```

- [ ] **Step 4: Run the tests and check that they pass**

Run: `npx vitest run __tests__/components/ordenes-list-practica.test.tsx __tests__/components/ordenes-list-nueva-param.test.tsx`

Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add types/index.ts components/onboarding/practica-badge.tsx components/onboarding/use-borrar-practica.ts components/ordenes/ordenes-list.tsx components/ordenes/orden-mobile-card.tsx __tests__/components/ordenes-list-practica.test.tsx
git commit -m "feat(ordenes): mark the practice order in the orders list"
```

---

## Task 2: Read-only practice order detail

**Files:**
- Create: `components/onboarding/ver-lo-que-ve-tu-cliente.tsx`
- Create: `components/ordenes/practica-orden-detail.tsx`
- Modify: `components/ordenes/orden-detail.tsx:1-86` (import), `:575-577` (early return)
- Modify: `__tests__/lib/terminologia-cableado.test.ts:17-26`
- Test: `__tests__/components/practica-orden-detail.test.tsx`
- Test: `__tests__/components/orden-detail-practica.test.tsx`

**Interfaces:**
- Consumes: `PracticaBadge`, `useBorrarPractica` (Task 1); `GET /api/ordenes/[id]` → `esPractica`.
- Produces: `VerLoQueVeTuCliente({ publicToken, className? })` (also used by Tasks 6 and 9), and `PracticaOrdenDetail({ orden, isAdmin })`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/components/practica-orden-detail.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { PracticaOrdenDetail } from "@/components/ordenes/practica-orden-detail"
import type { OrdenServicio } from "@/types"

const push = vi.fn()
const confirm = vi.fn()
const showError = vi.fn()

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))
vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}`, formatDate: () => "11/10/2026" }),
  useTerminologia: () => (key: string) => (key === "equipo" ? "Artefacto" : key),
}))
vi.mock("@/contexts/modal-context", () => ({ useModal: () => ({ confirm, showError }) }))
vi.mock("@/components/ordenes/notification-history", () => ({
  NotificationHistory: () => <div data-testid="historial" />,
}))

function orden(overrides: Partial<OrdenServicio> = {}): OrdenServicio {
  return {
    id: "prac-1",
    numeroOrden: 0,
    codigoOrden: "PRACTICA",
    clienteId: "cli-prac",
    dispositivo: "Gafa HGF-357",
    tipoDispositivo: "HELADERA",
    problemaReportado: "No enfría",
    estado: "REPARADO",
    costoFinal: 15000,
    fechaIngreso: new Date("2026-10-11T12:00:00Z"),
    publicToken: "tok-123",
    esPractica: true,
    cliente: {
      id: "cli-prac",
      nombre: "Ana Pérez",
      telefono: "",
      email: "ana@taller.test",
      createdAt: new Date("2026-10-11T12:00:00Z"),
      updatedAt: new Date("2026-10-11T12:00:00Z"),
    },
    ...overrides,
  }
}

describe("PracticaOrdenDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    confirm.mockResolvedValue(true)
  })

  it("shows the practice order read-only, with the badge and the owner as the client", () => {
    render(<PracticaOrdenDetail orden={orden()} isAdmin />)

    expect(screen.getByRole("heading", { name: "Orden de práctica" })).toBeInTheDocument()
    expect(screen.getByText("Práctica")).toBeInTheDocument()
    expect(screen.getByText(/se borra cuando cargues tu primera orden real/)).toBeInTheDocument()
    expect(screen.getByText(/acá no se cobra, no se mueve stock y no se factura/)).toBeInTheDocument()
    expect(screen.getByText("Vos")).toBeInTheDocument()
    expect(screen.getByText("ana@taller.test")).toBeInTheDocument()
    expect(screen.getByText("Artefacto")).toBeInTheDocument()
    expect(screen.getByText("Gafa HGF-357")).toBeInTheDocument()
    expect(screen.getByText("No enfría")).toBeInTheDocument()
    expect(screen.getByText("$15000")).toBeInTheDocument()
    expect(screen.getByTestId("historial")).toBeInTheDocument()
  })

  it("opens the tracking page in a new tab", () => {
    render(<PracticaOrdenDetail orden={orden()} isAdmin />)

    const link = screen.getByRole("link", { name: /Ver lo que ve tu cliente/ })
    expect(link).toHaveAttribute("href", "/seguimiento/tok-123")
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
  })

  it("offers to resume the practice until it is delivered", () => {
    const { unmount } = render(<PracticaOrdenDetail orden={orden({ estado: "RECIBIDO" })} isAdmin />)
    expect(screen.getByRole("link", { name: "Seguir con la práctica" })).toHaveAttribute("href", "/onboarding")
    unmount()

    render(<PracticaOrdenDetail orden={orden({ estado: "ENTREGADO_SIN_COBRO" })} isAdmin />)
    expect(screen.queryByRole("link", { name: "Seguir con la práctica" })).not.toBeInTheDocument()
  })

  it("Borrar práctica deletes it and goes back to the list", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }))
    vi.stubGlobal("fetch", fetchMock)
    render(<PracticaOrdenDetail orden={orden()} isAdmin />)

    fireEvent.click(screen.getByRole("button", { name: /Borrar práctica/ }))

    await waitFor(() => expect(push).toHaveBeenCalledWith("/ordenes"))
    expect(fetchMock).toHaveBeenCalledWith("/api/onboarding/practica", { method: "DELETE" })
  })

  it("a failed delete shows the server message and stays on the order", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: "No se pudo borrar" }) }))
    )
    render(<PracticaOrdenDetail orden={orden()} isAdmin />)

    fireEvent.click(screen.getByRole("button", { name: /Borrar práctica/ }))

    await waitFor(() => expect(showError).toHaveBeenCalledWith("No se pudo borrar"))
    expect(push).not.toHaveBeenCalled()
  })

  it("non-admins get the view without the practice controls", () => {
    render(<PracticaOrdenDetail orden={orden({ estado: "RECIBIDO" })} isAdmin={false} />)

    expect(screen.queryByRole("button", { name: /Borrar práctica/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Seguir con la práctica" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Ver lo que ve tu cliente/ })).toBeInTheDocument()
  })
})
```

Create `__tests__/components/orden-detail-practica.test.tsx`:

```tsx
/**
 * OrdenDetail hands a practice order to PracticaOrdenDetail before rendering
 * any action. Its children are stubbed with test ids so that the negative
 * assertions are not vacuous: the control case proves the same stubs do
 * render for a real order.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { OrdenDetail } from "@/components/ordenes/orden-detail"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}))
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: "ADMIN", organizationId: "org-1", name: "Ana" } } }),
}))
vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatPrice: (n: number) => `$${n}`,
    formatDate: () => "11/10/2026",
    currency: "ARS",
    timezone: "America/Argentina/Buenos_Aires",
    pais: "AR",
  }),
  useTerminologia: () => (key: string) => key,
}))
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ confirm: vi.fn(), alert: vi.fn(), showError: vi.fn() }),
}))
vi.mock("@/hooks/use-visibility-polling", () => ({ useVisibilityPolling: () => {} }))
vi.mock("@/components/ordenes/use-etiqueta-size", () => ({
  useEtiquetaSize: () => ({ size: "62x29", ready: true, update: vi.fn() }),
}))
vi.mock("@/components/ordenes/print-label", () => ({ printDeviceLabel: vi.fn(), LABEL_SIZE_OPTIONS: [] }))
vi.mock("@/components/ordenes/orden-estado-card", () => ({ OrdenEstadoCard: () => <div data-testid="estado-card" /> }))
vi.mock("@/components/ordenes/orden-tecnico-card", () => ({ OrdenTecnicoCard: () => <div data-testid="tecnico-card" /> }))
vi.mock("@/components/ordenes/orden-costos-card", () => ({ OrdenCostosCard: () => <div data-testid="costos-card" /> }))
vi.mock("@/components/ordenes/orden-comision-card", () => ({ OrdenComisionCard: () => <div data-testid="comision-card" /> }))
vi.mock("@/components/ordenes/orden-repuestos-tab", () => ({ OrdenRepuestosTab: () => <div data-testid="repuestos-tab" /> }))
vi.mock("@/components/ordenes/orden-servicios-tab", () => ({ OrdenServiciosTab: () => <div data-testid="servicios-tab" /> }))
vi.mock("@/components/ordenes/cobrar-orden-dialog", () => ({ CobrarOrdenDialog: () => <div data-testid="cobrar-dialog" /> }))
vi.mock("@/components/ordenes/confirmar-reparado-dialog", () => ({ ConfirmarReparadoDialog: () => <div data-testid="reparado-dialog" /> }))
vi.mock("@/components/ordenes/entrega-dialog", () => ({ EntregaDialog: () => <div data-testid="entrega-dialog" /> }))
vi.mock("@/components/ordenes/whatsapp-dialog", () => ({ WhatsAppDialog: () => <div data-testid="whatsapp" /> }))
vi.mock("@/components/ordenes/thermal-print-orden", () => ({ ThermalPrintOrden: () => <div data-testid="thermal" /> }))
vi.mock("@/components/ordenes/notification-history", () => ({ NotificationHistory: () => <div data-testid="historial" /> }))
vi.mock("@/components/notas-credito/nota-credito-dialog", () => ({ NotaCreditoDialog: () => <div data-testid="nota-credito" /> }))
vi.mock("@/components/cotizaciones/cotizacion-list", () => ({ CotizacionList: () => <div data-testid="cotizaciones" /> }))
vi.mock("@/components/garantias/garantia-card", () => ({ GarantiaCard: () => <div data-testid="garantia" /> }))
vi.mock("@/components/fotos/foto-gallery", () => ({ FotoGallery: () => <div data-testid="fotos" /> }))
vi.mock("@/components/checklist/checklist-card", () => ({ ChecklistCard: () => <div data-testid="checklist" /> }))

const BASE = {
  id: "ord-1",
  numeroOrden: 0,
  codigoOrden: "PRACTICA",
  estado: "REPARADO",
  dispositivo: "Gafa HGF-357",
  tipoDispositivo: "HELADERA",
  problemaReportado: "No enfría",
  costoFinal: 15000,
  fechaIngreso: "2026-10-11",
  publicToken: "tok-123",
  totalCobrado: 0,
  sena: 0,
  descuentoCobro: 0,
  estadoCobro: "PENDIENTE",
  metadata: {},
  cliente: { id: "cli-1", nombre: "Ana Pérez", telefono: "", email: "ana@taller.test" },
}

function stubFetch(orden: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === `/api/ordenes/${orden.id}`) return { ok: true, status: 200, json: async () => orden }
      return { ok: true, status: 200, json: async () => [] }
    })
  )
}

const ACCIONES = [
  "estado-card", "tecnico-card", "costos-card", "comision-card", "repuestos-tab", "servicios-tab",
  "cobrar-dialog", "reparado-dialog", "entrega-dialog", "whatsapp", "thermal", "nota-credito",
  "cotizaciones", "garantia", "fotos", "checklist",
]

describe("OrdenDetail — practice order", () => {
  it("renders the read-only practice view and none of the order actions", async () => {
    stubFetch({ ...BASE, esPractica: true })
    render(<OrdenDetail ordenId="ord-1" />)

    expect(await screen.findByRole("heading", { name: "Orden de práctica" })).toBeInTheDocument()
    for (const id of ACCIONES) expect(screen.queryByTestId(id)).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^PDF$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Imprimir/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Etiqueta/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument()
    expect(screen.queryByText(/Generar Remito/i)).not.toBeInTheDocument()
  })

  it("control: a real order still renders its actions with the same stubs", async () => {
    stubFetch({ ...BASE, codigoOrden: "HEL0001", numeroOrden: 1, esPractica: false })
    render(<OrdenDetail ordenId="ord-1" />)

    expect((await screen.findAllByTestId("costos-card")).length).toBeGreaterThan(0)
    expect(screen.getAllByTestId("estado-card").length).toBeGreaterThan(0)
    expect(screen.getByRole("button", { name: /PDF/ })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Orden de práctica" })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests and check that they fail**

Run: `npx vitest run __tests__/components/practica-orden-detail.test.tsx __tests__/components/orden-detail-practica.test.tsx`

Expected: FAIL. `Cannot find module '@/components/ordenes/practica-orden-detail'`. The routing test fails because no "Orden de práctica" heading renders.

- [ ] **Step 3: Write the minimal implementation**

Create `components/onboarding/ver-lo-que-ve-tu-cliente.tsx`:

```tsx
import { ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/** Opens the public tracking page the customer sees, in a new tab. */
export function VerLoQueVeTuCliente({ publicToken, className }: { publicToken: string; className?: string }) {
  return (
    <Button asChild variant="outline" size="sm" className={cn("shrink-0", className)}>
      <a href={`/seguimiento/${publicToken}`} target="_blank" rel="noopener noreferrer">
        <ExternalLink className="mr-1.5 h-4 w-4" aria-hidden="true" />
        Ver lo que ve tu cliente
        <span className="sr-only"> (se abre en otra pestaña)</span>
      </a>
    </Button>
  )
}
```

Create `components/ordenes/practica-orden-detail.tsx`:

```tsx
"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, GraduationCap, Loader2, Smartphone, Trash2, User, Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { OrderStatusBadge } from "@/components/ui/badge"
import { StatusBanner } from "@/components/ui/status-banner"
import { FieldSectionLabel } from "@/components/ui/field-section-label"
import { useCurrency, useTerminologia } from "@/contexts/currency-context"
import { NotificationHistory } from "@/components/ordenes/notification-history"
import { PracticaBadge } from "@/components/onboarding/practica-badge"
import { useBorrarPractica } from "@/components/onboarding/use-borrar-practica"
import { VerLoQueVeTuCliente } from "@/components/onboarding/ver-lo-que-ve-tu-cliente"
import type { OrdenServicio } from "@/types"

interface PracticaOrdenDetailProps {
  orden: OrdenServicio
  isAdmin: boolean
}

/**
 * Read-only view of the onboarding practice order. It deliberately renders
 * none of the order actions (state changes, cobros, seña, parts, quotes,
 * invoices, printing): the practice must never reach caja, stock or ARCA, and
 * a separate view keeps actions added to OrdenDetail later from leaking in.
 */
export function PracticaOrdenDetail({ orden, isAdmin }: PracticaOrdenDetailProps) {
  const router = useRouter()
  const term = useTerminologia()
  const { formatPrice, formatDate } = useCurrency()
  const { borrar, borrando } = useBorrarPractica(() => router.push("/ordenes"))
  const entregada = orden.estado === "ENTREGADO_SIN_COBRO"

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-4">
          <Button asChild variant="outline" size="icon" className="shrink-0">
            <Link href="/ordenes" aria-label="Volver a órdenes">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold">Orden de práctica</h1>
              <OrderStatusBadge status={orden.estado} showIcon />
            </div>
            <PracticaBadge conAviso />
            <p className="text-sm text-muted-foreground">Ingresado el {formatDate(orden.fechaIngreso)}</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {orden.publicToken && <VerLoQueVeTuCliente publicToken={orden.publicToken} />}
          {isAdmin && !entregada && (
            <Button asChild variant="outline" size="sm">
              <Link href="/onboarding">Seguir con la práctica</Link>
            </Button>
          )}
          {isAdmin && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => void borrar()}
              disabled={borrando}
            >
              {borrando ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
              )}
              Borrar práctica
            </Button>
          )}
        </div>
      </div>

      <StatusBanner tone="info" icon={GraduationCap}>
        Es una orden de práctica: acá no se cobra, no se mueve stock y no se factura.
      </StatusBanner>

      <Card>
        <CardContent className="grid gap-6 p-6 md:grid-cols-2">
          <div className="space-y-2">
            <FieldSectionLabel icon={User}>Cliente</FieldSectionLabel>
            <p className="text-lg font-semibold">Vos</p>
            {orden.cliente?.email && <p className="text-sm text-muted-foreground">{orden.cliente.email}</p>}
          </div>
          <div className="space-y-2">
            <FieldSectionLabel icon={Smartphone}>{term("equipo")}</FieldSectionLabel>
            <p className="text-lg font-semibold">{orden.dispositivo}</p>
          </div>
          <div className="space-y-2 md:col-span-2">
            <FieldSectionLabel icon={Wrench}>Problema reportado</FieldSectionLabel>
            <p className="text-sm">{orden.problemaReportado}</p>
          </div>
          {orden.costoFinal != null && (
            <div className="space-y-1 md:col-span-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Cobrarías</p>
              <p className="text-lg font-semibold">{formatPrice(orden.costoFinal)}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <NotificationHistory ordenId={orden.id} />
    </div>
  )
}
```

`components/ordenes/orden-detail.tsx`. Add next to the other `@/components/ordenes/*` imports:

```tsx
import { PracticaOrdenDetail } from "@/components/ordenes/practica-orden-detail"
```

Right after the existing `if (!orden) { return … }` (lines 575-577), before `// ESPERANDO_REPUESTO es un sub-estado…`, add:

```tsx
  // A practice order gets its own read-only view: no state change, cobro,
  // seña, parts, quotes, invoices or printing (see PracticaOrdenDetail).
  // Every hook of this component runs above this line.
  if (orden.esPractica) {
    return <PracticaOrdenDetail orden={orden} isAdmin={isAdmin} />
  }
```

`__tests__/lib/terminologia-cableado.test.ts`: add to `ARCHIVOS_CABLEADOS`, after `"app/(dashboard)/ordenes/recepcion/page.tsx",`:

```ts
  "components/ordenes/practica-orden-detail.tsx",
```

- [ ] **Step 4: Run the tests and check that they pass**

Run: `npx vitest run __tests__/components/practica-orden-detail.test.tsx __tests__/components/orden-detail-practica.test.tsx __tests__/components/orden-detail-tabs-gating.test.ts __tests__/lib/terminologia-cableado.test.ts`

Expected: PASS. If a stubbed child is still missing and the control case crashes with a "not a function / undefined" import error, add a `vi.mock(path, () => ({ Name: () => <div data-testid="…" /> }))` for that module. Never weaken the practice assertions.

- [ ] **Step 5: Commit**

```bash
git add components/onboarding/ver-lo-que-ve-tu-cliente.tsx components/ordenes/practica-orden-detail.tsx components/ordenes/orden-detail.tsx __tests__/lib/terminologia-cableado.test.ts __tests__/components/practica-orden-detail.test.tsx __tests__/components/orden-detail-practica.test.tsx
git commit -m "feat(ordenes): read-only detail for the practice order"
```

---

## Task 3: Practice client badge in the clients list

**Files:**
- Modify: `components/clientes/clientes-list.tsx:20,185`
- Modify: `components/clientes/cliente-mobile-card.tsx:13,54`
- Test: `__tests__/components/clientes-list-practica.test.tsx`

**Interfaces:**
- Consumes: `GET /api/clientes` → `data[].esPractica` (PR 1, through the recreated `v_clientes_resumen`); `PracticaBadge` (Task 1).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/clientes-list-practica.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { SWRConfig } from "swr"
import { ClientesList } from "@/components/clientes/clientes-list"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }))
vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}`, formatDate: (d: string) => d, pais: "AR" }),
}))
vi.mock("@/contexts/modal-context", () => ({ useModal: () => ({ confirm: vi.fn(), showError: vi.fn() }) }))
vi.mock("@/hooks/use-subscription", () => ({ useHasFeature: () => ({ hasFeature: true, loading: false }) }))
vi.mock("@/components/clientes/cliente-form", () => ({ ClienteForm: () => null }))
vi.mock("@/components/clientes/cuenta-corriente-dialog", () => ({ CuentaCorrienteDialog: () => null }))
vi.mock("@/components/clientes/cliente-whatsapp-dialog", () => ({ ClienteWhatsAppDialog: () => null }))
vi.mock("@/components/ordenes/cobrar-multiple-dialog", () => ({ CobrarMultipleDialog: () => null }))
vi.mock("@/components/import/import-modal", () => ({ ImportModal: () => null }))

const PRACTICA = {
  id: "cli-prac",
  nombre: "Ana Pérez",
  telefono: "",
  email: "ana@taller.test",
  tipoCliente: "INDIVIDUAL",
  esPractica: true,
  createdAt: "2026-10-11",
  updatedAt: "2026-10-11",
  ordenesCount: 1,
  deudaPendiente: 0,
}
const REAL = { ...PRACTICA, id: "cli-1", nombre: "Juan Gómez", esPractica: false }

function stubFetch(clientes: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.startsWith("/api/clientes?")) {
        return { ok: true, status: 200, json: async () => ({ data: clientes, total: clientes.length, totalDeuda: 0 }) }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    })
  )
}

function renderList() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ClientesList />
    </SWRConfig>
  )
}

describe("ClientesList — practice client", () => {
  beforeEach(() => vi.clearAllMocks())

  it("badges the practice client", async () => {
    stubFetch([PRACTICA])
    renderList()

    await screen.findAllByText("Ana Pérez")
    expect(screen.getAllByText("Práctica").length).toBeGreaterThan(0)
  })

  it("does not badge a real client", async () => {
    stubFetch([REAL])
    renderList()

    await screen.findAllByText("Juan Gómez")
    expect(screen.queryByText("Práctica")).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test and check that it fails**

Run: `npx vitest run __tests__/components/clientes-list-practica.test.tsx`

Expected: FAIL on `getAllByText("Práctica")`. If it fails earlier on an import of a heavy child, add a `vi.mock` stub for that module and run again until the failure is the missing badge.

- [ ] **Step 3: Write the minimal implementation**

`components/clientes/clientes-list.tsx`. After `import { TipoPrecioBadge } from "./tipo-precio-badge"` add:

```tsx
import { PracticaBadge } from "@/components/onboarding/practica-badge"
```

Right after `<TipoPrecioBadge tipoPrecio={cliente.tipoPrecio} />` (line 185) add:

```tsx
              {cliente.esPractica && <PracticaBadge />}
```

`components/clientes/cliente-mobile-card.tsx`. Add the same import. Right after `<TipoPrecioBadge tipoPrecio={cliente.tipoPrecio} />` (line 54) add:

```tsx
                {cliente.esPractica && <PracticaBadge />}
```

- [ ] **Step 4: Run the test and check that it passes**

Run: `npx vitest run __tests__/components/clientes-list-practica.test.tsx`

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add components/clientes/clientes-list.tsx components/clientes/cliente-mobile-card.tsx __tests__/components/clientes-list-practica.test.tsx
git commit -m "feat(clientes): mark the practice client in the clients list"
```

> **If the PR is split:** PR 3a ends here (Tasks 1–3). Before opening it, run Task 11 restricted to these files, plus a fresh-context review.

---

## Task 4: Pure helpers: article, wizard state, types

**Files:**
- Modify: `lib/terminologia.ts` (append)
- Create: `components/onboarding/wizard/types.ts`
- Create: `components/onboarding/wizard/wizard-state.ts`
- Test: `__tests__/lib/terminologia.test.ts` (append)
- Test: `__tests__/components/onboarding-wizard-state.test.ts`

**Interfaces:**
- Consumes: `PracticaOrden`, `PracticaEstado`, `PRACTICA_PROBLEMAS_GENERICOS` (PR 1); `getRubro`, `DEFAULT_RUBRO_ID` (`lib/rubros/index.ts`).
- Produces: every type in `types.ts` (see the Interfaces block), `articuloIndefinido`, `PASOS`, `subPasoPractica`, `pasoInicial`, `etiquetaRubro`, `problemasParaPractica`, `marcasParaPractica`.

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/lib/terminologia.test.ts`, and add `articuloIndefinido` to its import from `@/lib/terminologia`:

```ts
describe("articuloIndefinido", () => {
  it.each([
    ["Equipo", "un"],
    ["Vehículo", "un"],
    ["Artefacto", "un"],
    ["Rodado", "un"],
    ["Reloj", "un"],
    ["Pieza", "una"],
    ["pieza", "una"],
    ["Máquina de café", "una"],
    ["Cortadora de pasto", "una"],
    ["Instalación eléctrica", "una"],
    ["Unidad", "una"],
    ["Moto", "una"],
    ["Bici", "una"],
    ["Sistema de riego", "un"],
    ["  Persiana  ", "una"],
  ])("%s -> %s", (termino, esperado) => {
    expect(articuloIndefinido(termino)).toBe(esperado)
  })
})
```

Create `__tests__/components/onboarding-wizard-state.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import {
  etiquetaRubro,
  marcasParaPractica,
  pasoInicial,
  problemasParaPractica,
  subPasoPractica,
} from "@/components/onboarding/wizard/wizard-state"
import { PRACTICA_PROBLEMAS_GENERICOS, type PracticaOrden } from "@/lib/onboarding/practica-shared"

function practica(estado: PracticaOrden["estado"]): PracticaOrden {
  return {
    id: "prac-1",
    estado,
    publicToken: "tok-123",
    tipoDispositivo: "HELADERA",
    dispositivo: "Gafa",
    problemaReportado: "No enfría",
    costoFinal: null,
  }
}

describe("wizard resume", () => {
  it("starts at the welcome without a practice", () => {
    expect(pasoInicial(null)).toBe("bienvenida")
    expect(subPasoPractica(null)).toBe("recibir")
  })

  it.each([
    ["RECIBIDO", "practica", "reparar"],
    ["REPARADO", "practica", "entregar"],
    ["ENTREGADO_SIN_COBRO", "listo", "terminada"],
  ] as const)("a practice in %s resumes at %s / %s", (estado, paso, sub) => {
    expect(pasoInicial(practica(estado))).toBe(paso)
    expect(subPasoPractica(practica(estado))).toBe(sub)
  })
})

describe("etiquetaRubro", () => {
  it("uses the pack name for a curated rubro", () => {
    expect(etiquetaRubro("electrodomesticos", null)).toBe("Electrodomésticos y refrigeración")
  })

  it("uses the trade text for genérico", () => {
    expect(etiquetaRubro("generico", "máquinas de café")).toBe("Máquinas de café")
  })

  it("falls back to the genérico name without text or with an unknown rubro", () => {
    expect(etiquetaRubro("generico", "   ")).toBe("Otro servicio técnico")
    expect(etiquetaRubro("inexistente", null)).toBe("Otro servicio técnico")
  })
})

describe("practice suggestions", () => {
  it("uses the tipo's own problems, trimmed, deduplicated and capped at 6", () => {
    const tipo = {
      codigo: "X",
      nombre: "X",
      marcas: [],
      problemasComunes: ["A", "A", " B ", "C", "D", "E", "F", "G"],
    }
    expect(problemasParaPractica(tipo)).toEqual(["A", "B", "C", "D", "E", "F"])
  })

  it("falls back to the generic problems when the tipo has none", () => {
    const tipo = { codigo: "X", nombre: "X", marcas: [], problemasComunes: [] }
    expect(problemasParaPractica(tipo)).toEqual([...PRACTICA_PROBLEMAS_GENERICOS])
    expect(problemasParaPractica(undefined)).toEqual([...PRACTICA_PROBLEMAS_GENERICOS])
  })

  it("brands are trimmed, deduplicated and capped at 8", () => {
    const tipo = {
      codigo: "X",
      nombre: "X",
      marcas: ["Gafa", "Gafa", " ", "B", "C", "D", "E", "F", "G", "H", "I"],
      problemasComunes: [],
    }
    expect(marcasParaPractica(tipo)).toEqual(["Gafa", "B", "C", "D", "E", "F", "G", "H"])
    expect(marcasParaPractica(undefined)).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests and check that they fail**

Run: `npx vitest run __tests__/lib/terminologia.test.ts __tests__/components/onboarding-wizard-state.test.ts`

Expected: FAIL with `articuloIndefinido is not a function` and `Cannot find module '@/components/onboarding/wizard/wizard-state'`.

- [ ] **Step 3: Write the minimal implementation**

Append to `lib/terminologia.ts`:

```ts
/** Feminine words that do not end in a feminine suffix. */
const FEMENINOS_SIN_SUFIJO = new Set(["moto", "radio", "foto", "mano", "bici"])
/** Masculine words that end in -a. */
const MASCULINOS_EN_A = new Set(["sistema", "problema", "programa", "mapa", "dia", "sofa", "tema", "clima", "idioma", "planeta"])
const SUFIJO_FEMENINO = /(a|cion|sion|dad|tad|tud|umbre)$/

/**
 * Indefinite article for a vocabulary term, so copy like "¿Tenés un equipo
 * para cargar?" agrees with feminine terms ("una pieza"). Heuristic on the
 * first word: genérico shops get free-text terms, so a fixed map cannot cover
 * them, and the two exception lists catch the common words that break it.
 */
export function articuloIndefinido(termino: string): "un" | "una" {
  const primera = (termino.trim().split(/\s+/)[0] ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
  if (FEMENINOS_SIN_SUFIJO.has(primera)) return "una"
  if (MASCULINOS_EN_A.has(primera)) return "un"
  return SUFIJO_FEMENINO.test(primera) ? "una" : "un"
}
```

Create `components/onboarding/wizard/types.ts`:

```ts
import type { CurrencyCode } from "@/lib/currency"
import type { Terminologia } from "@/lib/terminologia"
import type { PracticaOrden } from "@/lib/onboarding/practica-shared"

/** A device type the practice form offers. Built server-side from tipos_dispositivo. */
export interface TipoPractica {
  codigo: string
  nombre: string
  marcas: string[]
  problemasComunes: string[]
}

export interface RubroVigente {
  rubro: string
  rubroDetalle: string | null
}

/** Sent to POST /api/onboarding/complete. The practice path is recorded by the practice POST. */
export type CaminoCompletar = "real" | "omitido"

export type PasoWizard = "bienvenida" | "negocio" | "pregunta" | "practica" | "listo"

export type SubPasoPractica = "recibir" | "reparar" | "entregar" | "terminada"

/** Built by app/(dashboard)/onboarding/wizard-props.ts; tests build it with a fixture. */
export interface OnboardingWizardProps {
  nombreNegocio: string
  logoUrl: string | null
  rubro: string
  rubroDetalle: string | null
  ownerNombre: string
  ownerEmail: string
  tipos: TipoPractica[]
  terminologia: Terminologia
  moneda: CurrencyCode
  ordenesRealesCount: number
  practica: PracticaOrden | null
}
```

Create `components/onboarding/wizard/wizard-state.ts`:

```ts
import { DEFAULT_RUBRO_ID, getRubro } from "@/lib/rubros"
import {
  PRACTICA_PROBLEMAS_GENERICOS,
  type PracticaEstado,
  type PracticaOrden,
} from "@/lib/onboarding/practica-shared"
import type { PasoWizard, SubPasoPractica, TipoPractica } from "./types"

export const PASOS: { key: PasoWizard; titulo: string }[] = [
  { key: "bienvenida", titulo: "Bienvenida" },
  { key: "negocio", titulo: "Tu negocio" },
  { key: "pregunta", titulo: "Primera orden" },
  { key: "practica", titulo: "Práctica" },
  { key: "listo", titulo: "Listo" },
]

const SUBPASO_POR_ESTADO: Record<PracticaEstado, SubPasoPractica> = {
  RECIBIDO: "reparar",
  REPARADO: "entregar",
  ENTREGADO_SIN_COBRO: "terminada",
}

/** Where the practice continues: the next action, derived from the server state. */
export function subPasoPractica(practica: PracticaOrden | null): SubPasoPractica {
  return practica ? SUBPASO_POR_ESTADO[practica.estado] : "recibir"
}

/** A user who left mid-practice resumes there; a finished practice lands on Listo. */
export function pasoInicial(practica: PracticaOrden | null): PasoWizard {
  const sub = subPasoPractica(practica)
  if (sub === "recibir") return "bienvenida"
  if (sub === "terminada") return "listo"
  return "practica"
}

export function etiquetaRubro(rubro: string, rubroDetalle: string | null): string {
  const pack = getRubro(rubro)
  const detalle = rubroDetalle?.trim() ?? ""
  if (pack.id === DEFAULT_RUBRO_ID && detalle !== "") {
    return detalle.charAt(0).toUpperCase() + detalle.slice(1)
  }
  return pack.nombre
}

function limpiar(lista: string[], max: number): string[] {
  return Array.from(new Set(lista.map((s) => s.trim()).filter(Boolean))).slice(0, max)
}

/** Problem chips: the tipo's own, or the fixed list (genérico tipos have none). */
export function problemasParaPractica(tipo: TipoPractica | undefined): string[] {
  const propios = limpiar(tipo?.problemasComunes ?? [], 6)
  return propios.length > 0 ? propios : [...PRACTICA_PROBLEMAS_GENERICOS]
}

export function marcasParaPractica(tipo: TipoPractica | undefined): string[] {
  return limpiar(tipo?.marcas ?? [], 8)
}
```

- [ ] **Step 4: Run the tests and check that they pass**

Run: `npx vitest run __tests__/lib/terminologia.test.ts __tests__/components/onboarding-wizard-state.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/terminologia.ts components/onboarding/wizard/types.ts components/onboarding/wizard/wizard-state.ts __tests__/lib/terminologia.test.ts __tests__/components/onboarding-wizard-state.test.ts
git commit -m "feat(onboarding): pure wizard state and term article helpers"
```

---

## Task 5: Let the org config be reloaded after a rubro change

**Files:**
- Modify: `contexts/currency-context.tsx:19-39,41-116`
- Test: `__tests__/components/currency-context-refresh.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `useCurrency().refreshConfig: () => void`. It is a no-op in the default context (no provider), so existing tests that render without a provider keep working.

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/currency-context-refresh.test.tsx`:

```tsx
/**
 * The root CurrencyProvider fetched the org config once per organizationId.
 * After a rubro change in the onboarding wizard, the next screen kept the old
 * vocabulary until a full reload. refreshConfig() re-reads it.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { CurrencyProvider, useCurrency, useTerminologia } from "@/contexts/currency-context"

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { organizationId: "org-1" } } }),
}))

function config(terminologia: Record<string, string>) {
  return { ok: true, headers: { get: () => "application/json" }, json: async () => ({ terminologia }) }
}

function Consumidor() {
  const { refreshConfig } = useCurrency()
  const term = useTerminologia()
  return (
    <>
      <span>{term("equipo")}</span>
      <button onClick={refreshConfig}>recargar</button>
    </>
  )
}

describe("CurrencyProvider.refreshConfig", () => {
  it("re-reads the org config on demand", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(config({ equipo: "Artefacto" }))
      .mockResolvedValueOnce(config({ equipo: "Vehículo" }))
    vi.stubGlobal("fetch", fetchMock)

    render(
      <CurrencyProvider>
        <Consumidor />
      </CurrencyProvider>
    )
    expect(await screen.findByText("Artefacto")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "recargar" }))

    expect(await screen.findByText("Vehículo")).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenLastCalledWith("/api/configuracion/operativa", expect.anything())
  })
})
```

- [ ] **Step 2: Run the test and check that it fails**

Run: `npx vitest run __tests__/components/currency-context-refresh.test.tsx`

Expected: FAIL. The click does nothing (`refreshConfig` is undefined) and "Vehículo" never appears. tsc would also flag the missing property.

- [ ] **Step 3: Write the minimal implementation**

In `contexts/currency-context.tsx`:

Add the field to `CurrencyContextType`:

```ts
  /** Re-reads /api/configuracion/operativa (e.g. after the rubro changed the vocabulary). */
  refreshConfig: () => void
```

Add the field to the default `createContext` value:

```ts
  refreshConfig: () => {},
```

Inside `CurrencyProvider`, after the `terminologia` state:

```ts
  const [configVersion, setConfigVersion] = useState(0)
  const refreshConfig = useCallback(() => setConfigVersion((v) => v + 1), [])
```

Change the fetch effect's dependency array from `[session?.user?.organizationId]` to:

```ts
  }, [session?.user?.organizationId, configVersion])
```

Add `refreshConfig` to the provider value:

```tsx
    <CurrencyContext.Provider value={{ currency, timezone, pais, organizationName, terminologia, formatPrice, formatDate, formatDateTime, refreshConfig }}>
```

- [ ] **Step 4: Run the tests and check that they pass**

Run: `npx vitest run __tests__/components/currency-context-refresh.test.tsx __tests__/components/ordenes-list-nueva-param.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add contexts/currency-context.tsx __tests__/components/currency-context-refresh.test.tsx
git commit -m "feat(currency): let consumers reload the org config"
```

---

## Task 6: Practice step (recibir, reparar, entregar)

**Files:**
- Create: `components/onboarding/wizard/practica-api.ts`
- Create: `components/onboarding/wizard/chips.tsx`
- Create: `components/onboarding/wizard/practica-recibir.tsx`
- Create: `components/onboarding/wizard/practica-step.tsx`
- Create (test helper, not collected): `__tests__/components/onboarding-wizard-fixtures.ts`
- Test: `__tests__/components/onboarding-practica-step.test.tsx`

**Interfaces:**
- Consumes: `/api/onboarding/practica` GET, POST and PATCH (PR 1); `TipoPractica`, `SubPasoPractica` and the helpers (Task 4); `VerLoQueVeTuCliente` (Task 2); `parseMoneyInput` (`lib/parse-money.ts`); `CURRENCIES` and `formatCurrencyValue` (`lib/currency.ts`).
- Produces:
  - `practicaApi`, `ResultadoPractica` and `NuevaPractica`.
  - `PracticaStep(props: PracticaStepProps)`.
  - `Chips({ etiqueta, opciones, activa, onElegir })`.
  - The fixtures `wizardProps(overrides)`, `practica(overrides)`, `json(body, status)`, `routeFetch(mockFetch, table)`, `callsTo(mockFetch, method, url)` and `bodyOf(call)`. Tasks 7–10 use them.

- [ ] **Step 1: Write the fixtures and the failing test**

Create `__tests__/components/onboarding-wizard-fixtures.ts`:

```ts
import type { Mock } from "vitest"
import type { OnboardingWizardProps } from "@/components/onboarding/wizard/types"
import type { PracticaOrden } from "@/lib/onboarding/practica-shared"
import { resolveTerminologia } from "@/lib/terminologia"

export function wizardProps(overrides: Partial<OnboardingWizardProps> = {}): OnboardingWizardProps {
  return {
    nombreNegocio: "",
    logoUrl: null,
    rubro: "electrodomesticos",
    rubroDetalle: null,
    ownerNombre: "Ana Pérez",
    ownerEmail: "ana@taller.test",
    tipos: [
      { codigo: "HELADERA", nombre: "Heladera / Freezer", marcas: ["Gafa", "Whirlpool"], problemasComunes: ["No enfría", "Pierde agua"] },
      { codigo: "LAVARROPAS", nombre: "Lavarropas / Secarropas", marcas: ["Drean"], problemasComunes: ["No centrifuga"] },
    ],
    terminologia: resolveTerminologia(null),
    moneda: "ARS",
    ordenesRealesCount: 0,
    practica: null,
    ...overrides,
  }
}

export function practica(overrides: Partial<PracticaOrden> = {}): PracticaOrden {
  return {
    id: "prac-1",
    estado: "RECIBIDO",
    publicToken: "tok-123",
    tipoDispositivo: "HELADERA",
    dispositivo: "Gafa HGF-357",
    problemaReportado: "No enfría",
    costoFinal: null,
    ...overrides,
  }
}

export type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> }

export function json(body: unknown, status = 200): FakeResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

/**
 * Routes fetch by "METHOD url". A queue answers in order and repeats its last
 * entry; an Error entry is thrown (network failure). Unknown routes get 200 {}.
 */
export function routeFetch(mockFetch: Mock, table: Record<string, Array<FakeResponse | Error>>) {
  const queues = Object.fromEntries(Object.entries(table).map(([key, value]) => [key, [...value]]))
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const queue = queues[`${init?.method ?? "GET"} ${url}`]
    const next = queue && queue.length > 1 ? queue.shift() : queue?.[0]
    if (!next) return json({})
    if (next instanceof Error) throw next
    return next
  })
}

export function callsTo(mockFetch: Mock, method: string, url: string) {
  return mockFetch.mock.calls.filter(
    ([u, init]) => u === url && ((init as RequestInit | undefined)?.method ?? "GET") === method
  )
}

export function bodyOf(call: unknown[] | undefined) {
  const init = call?.[1] as RequestInit | undefined
  return init?.body ? JSON.parse(init.body as string) : undefined
}
```

Create `__tests__/components/onboarding-practica-step.test.tsx`:

```tsx
/**
 * The practice sub-steps (recibir, reparar, entregar) against
 * /api/onboarding/practica. A harness holds the practice the way the wizard
 * shell does, so every server response drives the next sub-step.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { useState } from "react"
import { PracticaStep } from "@/components/onboarding/wizard/practica-step"
import type { TipoPractica } from "@/components/onboarding/wizard/types"
import { formatCurrencyValue } from "@/lib/currency"
import { PRACTICA_PROBLEMAS_GENERICOS, type PracticaOrden } from "@/lib/onboarding/practica-shared"
import { resolveTerminologia } from "@/lib/terminologia"
import { bodyOf, callsTo, json, practica, routeFetch, wizardProps } from "./onboarding-wizard-fixtures"

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

const PRACTICA_URL = "/api/onboarding/practica"
const CREAR = `POST ${PRACTICA_URL}`
const AVANZAR = `PATCH ${PRACTICA_URL}`
const LEER = `GET ${PRACTICA_URL}`

function Harness({
  inicial = null,
  tipos = wizardProps().tipos,
  onChange = () => {},
  onAtras = () => {},
}: {
  inicial?: PracticaOrden | null
  tipos?: TipoPractica[]
  onChange?: (p: PracticaOrden | null) => void
  onAtras?: () => void
}) {
  const [actual, setActual] = useState<PracticaOrden | null>(inicial)
  return (
    <PracticaStep
      practica={actual}
      tipos={tipos}
      terminologia={resolveTerminologia({ equipo: "Artefacto" })}
      ownerEmail="ana@taller.test"
      moneda="ARS"
      onPracticaChange={(p) => {
        onChange(p)
        setActual(p)
      }}
      onAtras={onAtras}
    />
  )
}

function cargarFormulario() {
  fireEvent.change(screen.getByLabelText("Artefacto"), { target: { value: "Gafa HGF-357" } })
  fireEvent.click(screen.getByRole("button", { name: "No enfría" }))
}

function etapaActual() {
  return within(screen.getByRole("list", { name: "Avance de la práctica" }))
    .getAllByRole("listitem")
    .find((li) => li.getAttribute("aria-current") === "step")
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockReset()
})

describe("PracticaStep — recibir", () => {
  it("preselects the first active tipo and shows the owner as the client", () => {
    render(<Harness />)

    expect(screen.getByLabelText("Tipo")).toHaveValue("HELADERA")
    expect(screen.getByText("Vos · ana@taller.test")).toBeInTheDocument()
    expect(etapaActual()).toHaveTextContent("Recibida")
  })

  it("brand chips fill the device text and problem chips fill the problem", () => {
    render(<Harness />)

    fireEvent.click(screen.getByRole("button", { name: "Gafa" }))
    expect(screen.getByLabelText("Artefacto")).toHaveValue("Gafa ")
    expect(screen.getByLabelText("Artefacto")).toHaveFocus()
    expect(screen.getByRole("button", { name: "Gafa" })).toHaveAttribute("aria-pressed", "true")

    fireEvent.click(screen.getByRole("button", { name: "Pierde agua" }))
    expect(screen.getByLabelText("Problema")).toHaveValue("Pierde agua")
  })

  it("switching the tipo switches the suggestions", () => {
    render(<Harness />)

    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "LAVARROPAS" } })

    expect(screen.getByRole("button", { name: "Drean" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "No centrifuga" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "No enfría" })).not.toBeInTheDocument()
  })

  it("falls back to the generic problems when the tipo has none (genérico)", () => {
    const generico: TipoPractica[] = [
      { codigo: "MAQUINA_DE_CAFE", nombre: "Máquina de café", marcas: [], problemasComunes: [] },
    ]
    render(<Harness tipos={generico} />)

    const grupo = screen.getByRole("group", { name: "Problemas comunes" })
    expect(within(grupo).getAllByRole("button").map((b) => b.textContent)).toEqual([...PRACTICA_PROBLEMAS_GENERICOS])
    expect(screen.queryByRole("group", { name: "Marcas sugeridas" })).not.toBeInTheDocument()
  })

  it("keeps the submit disabled until the device and the problem are filled", () => {
    render(<Harness />)
    const enviar = screen.getByRole("button", { name: "Cargar orden de práctica" })

    expect(enviar).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Artefacto"), { target: { value: "Gafa" } })
    expect(enviar).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "No enfría" }))
    expect(enviar).toBeEnabled()
  })

  it("creates the practice and moves to reparar with the tracking link", async () => {
    routeFetch(mockFetch, { [CREAR]: [json({ practica: practica() }, 201)] })
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    cargarFormulario()

    fireEvent.click(screen.getByRole("button", { name: "Cargar orden de práctica" }))

    expect(await screen.findByRole("heading", { name: "Ahora, la reparación" })).toBeInTheDocument()
    expect(bodyOf(callsTo(mockFetch, "POST", PRACTICA_URL)[0])).toEqual({
      tipoDispositivo: "HELADERA",
      dispositivo: "Gafa HGF-357",
      problemaReportado: "No enfría",
    })
    expect(onChange).toHaveBeenCalledWith(practica())
    expect(screen.getByText("Le mandamos un email a ana@taller.test: así se entera tu cliente.")).toBeInTheDocument()
    const link = screen.getByRole("link", { name: /Ver lo que ve tu cliente/ })
    expect(link).toHaveAttribute("href", "/seguimiento/tok-123")
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
    expect(etapaActual()).toHaveTextContent("Reparada")
  })

  it("shows the error with Reintentar and repeats the same request", async () => {
    routeFetch(mockFetch, {
      [CREAR]: [json({ error: "Se cortó la base" }, 500), json({ practica: practica() }, 201)],
    })
    render(<Harness />)
    cargarFormulario()
    fireEvent.click(screen.getByRole("button", { name: "Cargar orden de práctica" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Se cortó la base")
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }))

    expect(await screen.findByRole("heading", { name: "Ahora, la reparación" })).toBeInTheDocument()
    expect(callsTo(mockFetch, "POST", PRACTICA_URL)).toHaveLength(2)
    expect(bodyOf(callsTo(mockFetch, "POST", PRACTICA_URL)[1])).toEqual(bodyOf(callsTo(mockFetch, "POST", PRACTICA_URL)[0]))
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("Atrás goes back to the question", () => {
    const onAtras = vi.fn()
    render(<Harness onAtras={onAtras} />)

    fireEvent.click(screen.getByRole("button", { name: /Atrás/ }))

    expect(onAtras).toHaveBeenCalledTimes(1)
  })

  it("explains when the org has no active tipo", () => {
    render(<Harness tipos={[]} />)

    expect(screen.getByRole("alert")).toHaveTextContent(/al menos un tipo/)
    expect(screen.queryByRole("button", { name: "Cargar orden de práctica" })).not.toBeInTheDocument()
  })
})

describe("PracticaStep — reparar", () => {
  it("requires an amount greater than zero and reads es-AR thousands", async () => {
    routeFetch(mockFetch, {
      [AVANZAR]: [json({ practica: practica({ estado: "REPARADO", costoFinal: 15000 }) })],
    })
    render(<Harness inicial={practica()} />)
    const boton = screen.getByRole("button", { name: "Marcar como reparada" })
    const monto = screen.getByLabelText("¿Cuánto cobrarías?")

    expect(boton).toBeDisabled()
    fireEvent.change(monto, { target: { value: "0" } })
    expect(screen.getByText("Poné un monto mayor a cero.")).toBeInTheDocument()
    expect(monto).toHaveAttribute("aria-invalid", "true")
    expect(boton).toBeDisabled()

    fireEvent.change(monto, { target: { value: "15.000" } })
    fireEvent.click(boton)

    expect(await screen.findByRole("heading", { name: "Última parada: la entrega" })).toBeInTheDocument()
    expect(bodyOf(callsTo(mockFetch, "PATCH", PRACTICA_URL)[0])).toEqual({ accion: "reparar", costoFinal: 15000 })
  })

  it("reads decimals written with a comma", async () => {
    routeFetch(mockFetch, {
      [AVANZAR]: [json({ practica: practica({ estado: "REPARADO", costoFinal: 1500.5 }) })],
    })
    render(<Harness inicial={practica()} />)

    fireEvent.change(screen.getByLabelText("¿Cuánto cobrarías?"), { target: { value: "1500,50" } })
    fireEvent.click(screen.getByRole("button", { name: "Marcar como reparada" }))

    await screen.findByRole("heading", { name: "Última parada: la entrega" })
    expect(bodyOf(callsTo(mockFetch, "PATCH", PRACTICA_URL)[0])).toEqual({ accion: "reparar", costoFinal: 1500.5 })
  })

  it("retries after a network failure", async () => {
    routeFetch(mockFetch, {
      [AVANZAR]: [new TypeError("network down"), json({ practica: practica({ estado: "REPARADO", costoFinal: 15000 }) })],
    })
    render(<Harness inicial={practica()} />)
    fireEvent.change(screen.getByLabelText("¿Cuánto cobrarías?"), { target: { value: "15000" } })
    fireEvent.click(screen.getByRole("button", { name: "Marcar como reparada" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos conectarnos")
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }))

    expect(await screen.findByRole("heading", { name: "Última parada: la entrega" })).toBeInTheDocument()
  })

  it("continues from the real state when the practice was advanced elsewhere (409)", async () => {
    routeFetch(mockFetch, {
      [AVANZAR]: [json({ error: "La práctica no está en ese paso" }, 409)],
      [LEER]: [json({ practica: practica({ estado: "REPARADO", costoFinal: 9000 }) })],
    })
    render(<Harness inicial={practica()} />)
    fireEvent.change(screen.getByLabelText("¿Cuánto cobrarías?"), { target: { value: "15000" } })
    fireEvent.click(screen.getByRole("button", { name: "Marcar como reparada" }))

    expect(await screen.findByRole("heading", { name: "Última parada: la entrega" })).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("starts over when the practice was deleted (404)", async () => {
    routeFetch(mockFetch, {
      [AVANZAR]: [json({ error: "No hay práctica" }, 404)],
      [LEER]: [json({ practica: null })],
    })
    render(<Harness inicial={practica()} />)
    fireEvent.change(screen.getByLabelText("¿Cuánto cobrarías?"), { target: { value: "15000" } })
    fireEvent.click(screen.getByRole("button", { name: "Marcar como reparada" }))

    expect(await screen.findByRole("heading", { name: "Cargá tu orden de práctica" })).toBeInTheDocument()
  })
})

describe("PracticaStep — entregar", () => {
  const reparada = practica({ estado: "REPARADO", costoFinal: 15000 })
  const entregada = practica({ estado: "ENTREGADO_SIN_COBRO", costoFinal: 15000 })
  const cobrarias = `Cobrarías ${formatCurrencyValue(15000, "ARS")}`.replace(/\s+/g, " ")

  it("explains that the practice charges nothing, then delivers", async () => {
    routeFetch(mockFetch, { [AVANZAR]: [json({ practica: entregada })] })
    const onChange = vi.fn()
    render(<Harness inicial={reparada} onChange={onChange} />)

    expect(screen.getByText("En la práctica no se cobra nada. En una orden real, acá registrás el pago.")).toBeInTheDocument()
    expect(screen.getByText(cobrarias)).toBeInTheDocument()
    expect(screen.getByText("Le avisamos por email que ya puede pasar a retirar.")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Entregar" }))

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(entregada))
    expect(bodyOf(callsTo(mockFetch, "PATCH", PRACTICA_URL)[0])).toEqual({ accion: "entregar" })
  })

  it("retries after a server error", async () => {
    routeFetch(mockFetch, { [AVANZAR]: [json({ error: "Se cayó el envío" }, 500), json({ practica: entregada })] })
    const onChange = vi.fn()
    render(<Harness inicial={reparada} onChange={onChange} />)
    fireEvent.click(screen.getByRole("button", { name: "Entregar" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Se cayó el envío")
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }))

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(entregada))
  })
})
```

- [ ] **Step 2: Run the test and check that it fails**

Run: `npx vitest run __tests__/components/onboarding-practica-step.test.tsx`

Expected: FAIL with `Cannot find module '@/components/onboarding/wizard/practica-step'`.

- [ ] **Step 3: Write the minimal implementation**

Create `components/onboarding/wizard/practica-api.ts`:

```ts
import type { PracticaOrden } from "@/lib/onboarding/practica-shared"

export interface NuevaPractica {
  tipoDispositivo: string
  dispositivo: string
  problemaReportado: string
}

export type ResultadoPractica =
  | { ok: true; practica: PracticaOrden | null }
  | { ok: false; status: number; error: string }

const URL_PRACTICA = "/api/onboarding/practica"
const JSON_HEADERS = { "Content-Type": "application/json" }
const SIN_CONEXION = "No pudimos conectarnos. Revisá tu conexión y probá de nuevo."
const ERROR_GENERICO = "Algo salió mal. Probá de nuevo."

/** One request to the practice endpoint, never throwing: status 0 means no connection. */
async function pedir(init: RequestInit): Promise<ResultadoPractica> {
  try {
    const res = await fetch(URL_PRACTICA, init)
    const body = await res.json().catch(() => null)
    if (!res.ok) return { ok: false, status: res.status, error: body?.error || ERROR_GENERICO }
    return { ok: true, practica: (body?.practica ?? null) as PracticaOrden | null }
  } catch {
    return { ok: false, status: 0, error: SIN_CONEXION }
  }
}

export const practicaApi = {
  leer: () => pedir({ method: "GET", cache: "no-store" }),
  crear: (body: NuevaPractica) => pedir({ method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) }),
  reparar: (costoFinal: number) =>
    pedir({ method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ accion: "reparar", costoFinal }) }),
  entregar: () => pedir({ method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ accion: "entregar" }) }),
}
```

Create `components/onboarding/wizard/chips.tsx`:

```tsx
import { cn } from "@/lib/utils"

interface ChipsProps {
  /** Accessible name of the group, e.g. "Marcas sugeridas". */
  etiqueta: string
  opciones: string[]
  activa: (opcion: string) => boolean
  onElegir: (opcion: string) => void
}

/** Suggestion chips that fill a text input. They are not a selection control: the input stays editable. */
export function Chips({ etiqueta, opciones, activa, onElegir }: ChipsProps) {
  return (
    <div role="group" aria-label={etiqueta} className="flex flex-wrap gap-2 pt-1">
      {opciones.map((opcion) => {
        const encendida = activa(opcion)
        return (
          <button
            key={opcion}
            type="button"
            aria-pressed={encendida}
            onClick={() => onElegir(opcion)}
            className={cn(
              "inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-medium",
              "transition-[color,background-color,border-color,transform] duration-150 ease-snappy active:scale-[0.97]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "disabled:cursor-not-allowed disabled:opacity-50 [@media(pointer:coarse)]:min-h-11",
              encendida
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground [@media(hover:hover)]:hover:border-primary/50 [@media(hover:hover)]:hover:text-foreground"
            )}
          >
            {opcion}
          </button>
        )
      })}
    </div>
  )
}
```

Create `components/onboarding/wizard/practica-recibir.tsx`:

```tsx
"use client"

import { useRef, useState } from "react"
import { ChevronLeft, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { t, type Terminologia } from "@/lib/terminologia"
import { Chips } from "./chips"
import type { NuevaPractica } from "./practica-api"
import { marcasParaPractica, problemasParaPractica } from "./wizard-state"
import type { TipoPractica } from "./types"

interface PracticaRecibirProps {
  tipos: TipoPractica[]
  terminologia: Terminologia
  ownerEmail: string
  enviando: boolean
  onEnviar: (body: NuevaPractica) => void
  onAtras: () => void
}

const SELECT_CLASS =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 text-base sm:text-sm " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
  "disabled:cursor-not-allowed disabled:opacity-50"

export function PracticaRecibir({ tipos, terminologia, ownerEmail, enviando, onEnviar, onAtras }: PracticaRecibirProps) {
  const [tipoCodigo, setTipoCodigo] = useState(tipos[0]?.codigo ?? "")
  const [dispositivo, setDispositivo] = useState("")
  const [problema, setProblema] = useState("")
  const dispositivoRef = useRef<HTMLInputElement>(null)

  // Derived, not synced: if the tipos change (router.refresh after a rubro
  // change) the selection falls back to the first active tipo without an effect.
  const tipo = tipos.find((opcion) => opcion.codigo === tipoCodigo) ?? tipos[0]
  const equipo = t(terminologia, "equipo")

  if (!tipo) {
    return (
      <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
        Para practicar necesitás al menos un tipo de {equipo.toLowerCase()} activo. Podés omitir este paso y activarlo
        después en Configuración.
      </p>
    )
  }

  const marcas = marcasParaPractica(tipo)
  const problemas = problemasParaPractica(tipo)
  const completo = dispositivo.trim() !== "" && problema.trim() !== ""

  const elegirMarca = (marca: string) => {
    setDispositivo(`${marca} `)
    dispositivoRef.current?.focus()
  }

  const enviar = (e: React.FormEvent) => {
    e.preventDefault()
    if (!completo || enviando) return
    onEnviar({ tipoDispositivo: tipo.codigo, dispositivo: dispositivo.trim(), problemaReportado: problema.trim() })
  }

  return (
    <form onSubmit={enviar} className="space-y-4" noValidate>
      <fieldset disabled={enviando} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="practica-tipo">Tipo</Label>
          <select
            id="practica-tipo"
            value={tipo.codigo}
            onChange={(e) => setTipoCodigo(e.target.value)}
            className={SELECT_CLASS}
          >
            {tipos.map((opcion) => (
              <option key={opcion.codigo} value={opcion.codigo}>
                {opcion.nombre}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="practica-dispositivo">{equipo}</Label>
          <Input
            id="practica-dispositivo"
            ref={dispositivoRef}
            value={dispositivo}
            onChange={(e) => setDispositivo(e.target.value)}
            placeholder="Marca y modelo"
            autoComplete="off"
            maxLength={120}
          />
          {marcas.length > 0 && (
            <Chips
              etiqueta="Marcas sugeridas"
              opciones={marcas}
              activa={(marca) => dispositivo.trim().toLowerCase().startsWith(marca.toLowerCase())}
              onElegir={elegirMarca}
            />
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="practica-problema">Problema</Label>
          <Input
            id="practica-problema"
            value={problema}
            onChange={(e) => setProblema(e.target.value)}
            placeholder="¿Qué le pasa?"
            autoComplete="off"
            maxLength={200}
          />
          <Chips
            etiqueta="Problemas comunes"
            opciones={problemas}
            activa={(opcion) => problema.trim() === opcion}
            onElegir={setProblema}
          />
        </div>

        <div className="space-y-1">
          <p className="text-sm font-medium">Cliente</p>
          <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">Vos · {ownerEmail}</p>
          <p className="text-xs text-muted-foreground">
            Usamos tu email para que veas los avisos que le llegan al cliente.
          </p>
        </div>
      </fieldset>

      <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-between">
        <Button type="submit" disabled={!completo || enviando}>
          {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          {enviando ? "Cargando…" : "Cargar orden de práctica"}
        </Button>
        <Button type="button" variant="ghost" onClick={onAtras} disabled={enviando}>
          <ChevronLeft className="mr-2 h-4 w-4" aria-hidden="true" />
          Atrás
        </Button>
      </div>
    </form>
  )
}
```

Note: `Vos · {ownerEmail}` renders two text nodes in one `<p>`. Testing Library's `getByText` joins the element's own text nodes, so `"Vos · ana@taller.test"` matches.

Create `components/onboarding/wizard/practica-step.tsx`:

```tsx
"use client"

import { useRef, useState } from "react"
import { CheckCircle2, Loader2, Mail, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { VerLoQueVeTuCliente } from "@/components/onboarding/ver-lo-que-ve-tu-cliente"
import { CURRENCIES, formatCurrencyValue, type CurrencyCode } from "@/lib/currency"
import type { PracticaOrden } from "@/lib/onboarding/practica-shared"
import { parseMoneyInput } from "@/lib/parse-money"
import type { Terminologia } from "@/lib/terminologia"
import { cn } from "@/lib/utils"
import { PracticaRecibir } from "./practica-recibir"
import { practicaApi, type ResultadoPractica } from "./practica-api"
import { subPasoPractica } from "./wizard-state"
import type { SubPasoPractica, TipoPractica } from "./types"

const TEXTOS: Record<SubPasoPractica, { titulo: string; descripcion: string }> = {
  recibir: {
    titulo: "Cargá tu orden de práctica",
    descripcion: "Hacé de cuenta que entra un cliente. El cliente sos vos: así ves lo que le llega.",
  },
  reparar: {
    titulo: "Ahora, la reparación",
    descripcion: "Poné lo que cobrarías por el trabajo. Al marcarla como reparada sale el segundo email.",
  },
  entregar: {
    titulo: "Última parada: la entrega",
    descripcion: "Cuando el cliente retira, la marcás como entregada y le llega el último email.",
  },
  terminada: {
    titulo: "Práctica terminada",
    descripcion: "Ya recorriste el ciclo completo de una orden.",
  },
}

const ETAPAS: { sub: SubPasoPractica; label: string }[] = [
  { sub: "recibir", label: "Recibida" },
  { sub: "reparar", label: "Reparada" },
  { sub: "entregar", label: "Entregada" },
]
const ORDEN_SUBPASOS: SubPasoPractica[] = ["recibir", "reparar", "entregar", "terminada"]

export interface PracticaStepProps {
  practica: PracticaOrden | null
  tipos: TipoPractica[]
  terminologia: Terminologia
  ownerEmail: string
  moneda: CurrencyCode
  onPracticaChange: (practica: PracticaOrden | null) => void
  onAtras: () => void
}

export function PracticaStep({
  practica,
  tipos,
  terminologia,
  ownerEmail,
  moneda,
  onPracticaChange,
  onAtras,
}: PracticaStepProps) {
  const subPaso = subPasoPractica(practica)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ultimaAccion = useRef<(() => Promise<ResultadoPractica>) | null>(null)

  // On 404/409 the practice moved under us (deleted, or advanced from another
  // tab): re-read it and continue from where it really is instead of failing.
  const ejecutar = async (accion: () => Promise<ResultadoPractica>) => {
    ultimaAccion.current = accion
    setEnviando(true)
    setError(null)
    try {
      const resultado = await accion()
      if (resultado.ok) {
        onPracticaChange(resultado.practica)
        return
      }
      if (resultado.status === 404 || resultado.status === 409) {
        const actual = await practicaApi.leer()
        if (actual.ok) {
          onPracticaChange(actual.practica)
          return
        }
      }
      setError(resultado.error)
    } finally {
      setEnviando(false)
    }
  }

  const reintentar = () => {
    if (ultimaAccion.current) void ejecutar(ultimaAccion.current)
  }

  const texto = TEXTOS[subPaso]

  return (
    <>
      <CardHeader className="space-y-4">
        <PracticaTracker subPaso={subPaso} />
        <div className="space-y-1.5">
          <CardTitle data-paso-titulo tabIndex={-1} className="text-xl outline-none">
            {texto.titulo}
          </CardTitle>
          <CardDescription>{texto.descripcion}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {practica && (subPaso === "reparar" || subPaso === "entregar") && (
          <AvisoCliente practica={practica} subPaso={subPaso} ownerEmail={ownerEmail} />
        )}
        {practica && <ResumenPractica practica={practica} tipos={tipos} />}
        {subPaso === "recibir" && (
          <PracticaRecibir
            tipos={tipos}
            terminologia={terminologia}
            ownerEmail={ownerEmail}
            enviando={enviando}
            onEnviar={(body) => void ejecutar(() => practicaApi.crear(body))}
            onAtras={onAtras}
          />
        )}
        {subPaso === "reparar" && (
          <PracticaReparar
            moneda={moneda}
            enviando={enviando}
            onReparar={(monto) => void ejecutar(() => practicaApi.reparar(monto))}
          />
        )}
        {subPaso === "entregar" && practica && (
          <PracticaEntregar
            practica={practica}
            moneda={moneda}
            enviando={enviando}
            onEntregar={() => void ejecutar(practicaApi.entregar)}
          />
        )}
        {error && <AvisoError mensaje={error} reintentando={enviando} onReintentar={reintentar} />}
      </CardContent>
    </>
  )
}

function PracticaTracker({ subPaso }: { subPaso: SubPasoPractica }) {
  const actual = ORDEN_SUBPASOS.indexOf(subPaso)
  return (
    <ol aria-label="Avance de la práctica" className="grid grid-cols-3 gap-2">
      {ETAPAS.map((etapa, idx) => {
        const hecha = idx < actual
        const enCurso = idx === actual
        return (
          <li
            key={etapa.sub}
            aria-current={enCurso ? "step" : undefined}
            className={cn(
              "flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-xs font-medium transition-colors duration-200",
              hecha && "border-success/30 bg-success-50 text-success-700 dark:bg-success/15 dark:text-success-400",
              enCurso && "border-primary bg-primary/5 text-primary",
              !hecha && !enCurso && "border-border text-muted-foreground"
            )}
          >
            {hecha ? (
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            ) : (
              <span aria-hidden="true">{idx + 1}</span>
            )}
            {etapa.label}
            {hecha && <span className="sr-only"> (hecho)</span>}
          </li>
        )
      })}
    </ol>
  )
}

function AvisoCliente({
  practica,
  subPaso,
  ownerEmail,
}: {
  practica: PracticaOrden
  subPaso: "reparar" | "entregar"
  ownerEmail: string
}) {
  const texto =
    subPaso === "reparar"
      ? `Le mandamos un email a ${ownerEmail}: así se entera tu cliente.`
      : "Le avisamos por email que ya puede pasar a retirar."
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-lg border border-success/30 bg-success-50 p-3 text-sm text-success-700 dark:bg-success/15 dark:text-success-400 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="flex items-start gap-2">
        <Mail className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {texto}
      </p>
      <VerLoQueVeTuCliente publicToken={practica.publicToken} />
    </div>
  )
}

function ResumenPractica({ practica, tipos }: { practica: PracticaOrden; tipos: TipoPractica[] }) {
  const tipoNombre = tipos.find((tipo) => tipo.codigo === practica.tipoDispositivo)?.nombre ?? practica.tipoDispositivo
  return (
    <div className="rounded-lg border p-3 text-sm">
      <p className="font-medium">{practica.dispositivo}</p>
      <p className="text-muted-foreground">
        {tipoNombre} · {practica.problemaReportado}
      </p>
    </div>
  )
}

function PracticaReparar({
  moneda,
  enviando,
  onReparar,
}: {
  moneda: CurrencyCode
  enviando: boolean
  onReparar: (monto: number) => void
}) {
  const [valor, setValor] = useState("")
  const monto = parseMoneyInput(valor)
  const valido = Number.isFinite(monto) && monto > 0
  const mostrarAyuda = valor.trim() !== "" && !valido
  const simbolo = (CURRENCIES[moneda] ?? CURRENCIES.ARS).symbol

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (valido && !enviando) onReparar(monto)
      }}
      className="space-y-4"
      noValidate
    >
      <div className="space-y-1.5">
        <Label htmlFor="practica-costo">¿Cuánto cobrarías?</Label>
        <div className="relative">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
          >
            {simbolo}
          </span>
          <Input
            id="practica-costo"
            inputMode="decimal"
            autoComplete="off"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            disabled={enviando}
            placeholder="0"
            aria-invalid={mostrarAyuda}
            aria-describedby="practica-costo-ayuda"
            className={simbolo.length > 2 ? "pl-14" : "pl-10"}
          />
        </div>
        <p id="practica-costo-ayuda" className={cn("text-xs", mostrarAyuda ? "text-destructive" : "text-muted-foreground")}>
          {mostrarAyuda ? "Poné un monto mayor a cero." : "Es solo para la práctica: nadie te va a cobrar nada."}
        </p>
      </div>
      <Button type="submit" className="w-full sm:w-auto" disabled={!valido || enviando}>
        {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
        {enviando ? "Guardando…" : "Marcar como reparada"}
      </Button>
    </form>
  )
}

function PracticaEntregar({
  practica,
  moneda,
  enviando,
  onEntregar,
}: {
  practica: PracticaOrden
  moneda: CurrencyCode
  enviando: boolean
  onEntregar: () => void
}) {
  return (
    <div className="space-y-4">
      {practica.costoFinal != null && (
        <p className="text-sm text-muted-foreground">Cobrarías {formatCurrencyValue(practica.costoFinal, moneda)}</p>
      )}
      <p className="text-sm">En la práctica no se cobra nada. En una orden real, acá registrás el pago.</p>
      <Button className="w-full sm:w-auto" onClick={onEntregar} disabled={enviando}>
        {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
        {enviando ? "Entregando…" : "Entregar"}
      </Button>
    </div>
  )
}

function AvisoError({
  mensaje,
  reintentando,
  onReintentar,
}: {
  mensaje: string
  reintentando: boolean
  onReintentar: () => void
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
    >
      <p>{mensaje}</p>
      <Button type="button" size="sm" variant="outline" onClick={onReintentar} disabled={reintentando} className="shrink-0">
        <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden="true" />
        Reintentar
      </Button>
    </div>
  )
}
```

- [ ] **Step 4: Run the test and check that it passes**

Run: `npx vitest run __tests__/components/onboarding-practica-step.test.tsx`

Expected: PASS (16 tests).

- [ ] **Step 5: Commit**

```bash
git add components/onboarding/wizard/practica-api.ts components/onboarding/wizard/chips.tsx components/onboarding/wizard/practica-recibir.tsx components/onboarding/wizard/practica-step.tsx __tests__/components/onboarding-wizard-fixtures.ts __tests__/components/onboarding-practica-step.test.tsx
git commit -m "feat(onboarding): practice order cycle step"
```

---

## Task 7: Rubro selector

**Files:**
- Create: `components/onboarding/wizard/rubro-selector.tsx`
- Test: `__tests__/components/onboarding-rubro-selector.test.tsx`

**Interfaces:**
- Consumes:
  - `PUT /api/onboarding/rubro` (PR 2).
  - `RubroPicker` (`components/registro/rubro-picker.tsx`), reused as is.
  - `validarSeleccionRubro` (`lib/rubros/seleccion.ts`).
  - `DEFAULT_RUBRO_ID`.
  - `etiquetaRubro` and `RubroVigente` (Task 4).
  - The fixtures (Task 6).
- Produces: `RubroSelector({ rubro, rubroDetalle, bloqueado, onGuardado(r: RubroVigente), onBloqueado() })`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/onboarding-rubro-selector.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import type { ComponentProps } from "react"
import { RubroSelector } from "@/components/onboarding/wizard/rubro-selector"
import { bodyOf, callsTo, json, routeFetch } from "./onboarding-wizard-fixtures"

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

const RUBRO_URL = "/api/onboarding/rubro"
const RUBRO = `PUT ${RUBRO_URL}`

function renderSelector(overrides: Partial<ComponentProps<typeof RubroSelector>> = {}) {
  const props = {
    rubro: "electrodomesticos",
    rubroDetalle: null,
    bloqueado: false,
    onGuardado: vi.fn(),
    onBloqueado: vi.fn(),
    ...overrides,
  }
  render(<RubroSelector {...props} />)
  return props
}

function abrir() {
  fireEvent.click(screen.getByRole("button", { name: "Cambiar rubro" }))
}

function guardar() {
  fireEvent.click(screen.getByRole("button", { name: "Guardar rubro" }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockReset()
})

describe("RubroSelector", () => {
  it("shows the current rubro", () => {
    renderSelector()
    expect(screen.getByText("Electrodomésticos y refrigeración")).toBeInTheDocument()
  })

  it("shows the genérico trade text as the rubro", () => {
    renderSelector({ rubro: "generico", rubroDetalle: "máquinas de café" })
    expect(screen.getByText("Máquinas de café")).toBeInTheDocument()
  })

  it("is disabled with a one-line reason when the shop has real orders", () => {
    renderSelector({ bloqueado: true })

    const cambiar = screen.getByRole("button", { name: "Cambiar rubro" })
    expect(cambiar).toBeDisabled()
    const motivo = screen.getByText("Ya cargaste órdenes, así que el rubro queda como está.")
    expect(cambiar).toHaveAttribute("aria-describedby", motivo.id)
  })

  it("saves a curated rubro and closes", async () => {
    routeFetch(mockFetch, { [RUBRO]: [json({ rubro: "automotor", rubroDetalle: null, tiposActivos: [] })] })
    const props = renderSelector()
    abrir()

    fireEvent.click(screen.getByRole("radio", { name: /Taller mecánico/ }))
    guardar()

    await waitFor(() => expect(props.onGuardado).toHaveBeenCalledWith({ rubro: "automotor", rubroDetalle: null }))
    expect(bodyOf(callsTo(mockFetch, "PUT", RUBRO_URL)[0])).toEqual({ rubro: "automotor", rubroDetalle: null })
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(screen.getByRole("status")).toHaveTextContent("Listo, preparamos tu cuenta para este rubro.")
  })

  it("asks for the trade text before saving genérico", async () => {
    routeFetch(mockFetch, { [RUBRO]: [json({ rubro: "generico", rubroDetalle: "máquinas de café" })] })
    const props = renderSelector()
    abrir()
    fireEvent.click(screen.getByRole("radio", { name: /Otro servicio técnico/ }))

    guardar()
    expect(await screen.findByRole("alert")).toHaveTextContent("Contanos qué reparás para preparar tu cuenta")
    expect(callsTo(mockFetch, "PUT", RUBRO_URL)).toHaveLength(0)

    fireEvent.change(screen.getByRole("textbox", { name: "¿Qué reparás?" }), { target: { value: "máquinas de café" } })
    guardar()

    await waitFor(() =>
      expect(props.onGuardado).toHaveBeenCalledWith({ rubro: "generico", rubroDetalle: "máquinas de café" })
    )
    expect(bodyOf(callsTo(mockFetch, "PUT", RUBRO_URL)[0])).toEqual({ rubro: "generico", rubroDetalle: "máquinas de café" })
  })

  it("keeps the dialog open and reports the lock on 409", async () => {
    routeFetch(mockFetch, { [RUBRO]: [json({ error: "Ya tenés órdenes reales" }, 409)] })
    const props = renderSelector()
    abrir()
    fireEvent.click(screen.getByRole("radio", { name: /Taller mecánico/ }))

    guardar()

    expect(await screen.findByRole("alert")).toHaveTextContent("Ya tenés órdenes reales")
    expect(props.onBloqueado).toHaveBeenCalledTimes(1)
    expect(props.onGuardado).not.toHaveBeenCalled()
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("shows a connection error and stays open", async () => {
    routeFetch(mockFetch, { [RUBRO]: [new TypeError("network down")] })
    renderSelector()
    abrir()
    fireEvent.click(screen.getByRole("radio", { name: /Taller mecánico/ }))

    guardar()

    expect(await screen.findByRole("alert")).toHaveTextContent(/Revisá tu conexión/)
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("closes without a request when nothing changed", async () => {
    renderSelector()
    abrir()

    guardar()

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("cannot be dismissed while saving", async () => {
    let responder: (value: unknown) => void = () => {}
    mockFetch.mockImplementation(() => new Promise((resolve) => { responder = resolve }))
    renderSelector()
    abrir()
    fireEvent.click(screen.getByRole("radio", { name: /Taller mecánico/ }))

    guardar()

    expect(await screen.findByRole("button", { name: "Guardando…" })).toBeDisabled()
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    expect(screen.getByRole("dialog")).toBeInTheDocument()

    responder(json({ rubro: "automotor", rubroDetalle: null }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run the test and check that it fails**

Run: `npx vitest run __tests__/components/onboarding-rubro-selector.test.tsx`

Expected: FAIL with `Cannot find module '@/components/onboarding/wizard/rubro-selector'`.

- [ ] **Step 3: Write the minimal implementation**

Create `components/onboarding/wizard/rubro-selector.tsx`:

```tsx
"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { RubroPicker } from "@/components/registro/rubro-picker"
import { DEFAULT_RUBRO_ID } from "@/lib/rubros"
import { validarSeleccionRubro } from "@/lib/rubros/seleccion"
import { etiquetaRubro } from "./wizard-state"
import type { RubroVigente } from "./types"

interface RubroSelectorProps {
  rubro: string
  rubroDetalle: string | null
  /** True when the shop already has real orders: the server would answer 409. */
  bloqueado: boolean
  onGuardado: (rubro: RubroVigente) => void
  onBloqueado: () => void
}

const MOTIVO_BLOQUEO_ID = "rubro-bloqueado-motivo"
const MENSAJE_BLOQUEO = "Ya cargaste órdenes, así que el rubro no se puede cambiar desde acá."

export function RubroSelector({ rubro, rubroDetalle, bloqueado, onGuardado, onBloqueado }: RubroSelectorProps) {
  const [abierto, setAbierto] = useState(false)
  const [borrador, setBorrador] = useState(rubro)
  const [detalle, setDetalle] = useState(rubroDetalle ?? "")
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cambiado, setCambiado] = useState(false)

  const abrir = () => {
    setBorrador(rubro)
    setDetalle(rubroDetalle ?? "")
    setError(null)
    setAbierto(true)
  }

  // The request must finish before the dialog can close (X, Escape, overlay, Cancelar).
  const cambiarApertura = (open: boolean) => {
    if (guardando) return
    setAbierto(open)
  }

  const guardar = async () => {
    const esGenerico = borrador === DEFAULT_RUBRO_ID
    const detalleLimpio = esGenerico ? detalle.trim() : ""
    const invalido = validarSeleccionRubro(borrador, detalleLimpio)
    if (invalido) {
      setError(invalido)
      return
    }
    const sinCambios = borrador === rubro && (!esGenerico || detalleLimpio === (rubroDetalle ?? "").trim())
    if (sinCambios) {
      setAbierto(false)
      return
    }

    setGuardando(true)
    setError(null)
    try {
      const res = await fetch("/api/onboarding/rubro", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rubro: borrador, rubroDetalle: esGenerico ? detalleLimpio : null }),
      })
      const body = await res.json().catch(() => null)
      if (res.status === 409) {
        setError(body?.error || MENSAJE_BLOQUEO)
        onBloqueado()
        return
      }
      if (!res.ok) {
        setError(body?.error || "No pudimos cambiar el rubro. Probá de nuevo.")
        return
      }
      onGuardado({
        rubro: body?.rubro ?? borrador,
        rubroDetalle: body?.rubroDetalle ?? (esGenerico ? detalleLimpio : null),
      })
      setCambiado(true)
      setAbierto(false)
    } catch (err) {
      console.error("Error changing the rubro:", err)
      setError("No pudimos cambiar el rubro. Revisá tu conexión y probá de nuevo.")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="text-muted-foreground">Tu rubro:</span>
        <span className="font-medium">{etiquetaRubro(rubro, rubroDetalle)}</span>
        <span aria-hidden="true" className="text-muted-foreground">
          ·
        </span>
        <Button
          type="button"
          variant="link"
          className="h-auto p-0"
          onClick={abrir}
          disabled={bloqueado}
          aria-label="Cambiar rubro"
          aria-describedby={bloqueado ? MOTIVO_BLOQUEO_ID : undefined}
        >
          Cambiar
        </Button>
      </div>
      {bloqueado && (
        <p id={MOTIVO_BLOQUEO_ID} className="mt-1 text-xs text-muted-foreground">
          Ya cargaste órdenes, así que el rubro queda como está.
        </p>
      )}
      {cambiado && !bloqueado && (
        <p role="status" className="mt-1 text-xs text-success-700 dark:text-success-400">
          Listo, preparamos tu cuenta para este rubro.
        </p>
      )}

      <Dialog open={abierto} onOpenChange={cambiarApertura}>
        <DialogContent
          className="w-[calc(100%-2rem)] rounded-lg sm:max-w-xl"
          onEscapeKeyDown={(e) => {
            if (guardando) e.preventDefault()
          }}
          onInteractOutside={(e) => {
            if (guardando) e.preventDefault()
          }}
        >
          <DialogHeader>
            <DialogTitle>Cambiar rubro</DialogTitle>
            <DialogDescription>
              Preparamos tus tipos de equipo, el checklist de recepción y el vocabulario del sistema. Si hiciste una
              práctica, se borra.
            </DialogDescription>
          </DialogHeader>
          <RubroPicker
            value={borrador}
            onChange={(id) => {
              setBorrador(id)
              setError(null)
            }}
            detalle={detalle}
            onDetalleChange={(texto) => {
              setDetalle(texto)
              setError(null)
            }}
            disabled={guardando}
          />
          {error && (
            <div
              role="alert"
              className="rounded border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => cambiarApertura(false)} disabled={guardando}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void guardar()} disabled={guardando}>
              {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {guardando ? "Guardando…" : "Guardar rubro"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

The dialog title is "Cambiar rubro", not "¿Qué reparás?". Radix labels the dialog by its title, and a duplicate "¿Qué reparás?" would collide with the genérico input's label in `getByLabelText` and in screen readers.

- [ ] **Step 4: Run the test and check that it passes**

Run: `npx vitest run __tests__/components/onboarding-rubro-selector.test.tsx`

Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add components/onboarding/wizard/rubro-selector.tsx __tests__/components/onboarding-rubro-selector.test.tsx
git commit -m "feat(onboarding): change the rubro from the wizard"
```

> **If the PR is split:** PR 3b ends here (Tasks 4–7).

---

## Task 8: Wizard shell, business step and question step

**Files:**
- Create: `components/onboarding/wizard/negocio-step.tsx`
- Create: `components/onboarding/wizard/pregunta-step.tsx`
- Create: `components/onboarding/wizard/onboarding-wizard.tsx`
- Modify (rewrite for the new props): `__tests__/components/onboarding-wizard-logo.test.tsx`
- Modify (rewrite for the question step): `__tests__/components/onboarding-wizard-primera-orden.test.tsx`
- Test: `__tests__/components/onboarding-wizard-rubro.test.tsx`

**Interfaces:**
- Consumes:
  - `OnboardingWizardProps`, `PasoWizard`, `RubroVigente`, `CaminoCompletar`, `PASOS` and `pasoInicial` (Task 4).
  - `useCurrency().refreshConfig` (Task 5).
  - `RubroSelector` (Task 7).
  - `articuloIndefinido` and `t` (`lib/terminologia.ts`).
  - `compressImageToDataUrl` (`lib/images/compress-image.ts`).
  - `PUT /api/configuracion`, `PUT /api/onboarding/progress` and `POST /api/onboarding/complete`.
- Produces: `OnboardingWizard(props: OnboardingWizardProps)`, `NegocioStep` and `PreguntaStep` (signatures in the Interfaces block). This task wires only `bienvenida`, `negocio` and `pregunta`; Task 9 adds `practica` and `listo`.

- [ ] **Step 1: Rewrite the two existing suites and add the rubro one (all failing)**

Replace `__tests__/components/onboarding-wizard-logo.test.tsx` entirely:

```tsx
/**
 * Onboarding wizard, business step ("Personalizá tu negocio").
 *
 * Bug (#443): with a logo picked, "Siguiente" POSTed to /api/configuracion/logo
 * (a route that never existed) and silently did nothing; without a logo it sent
 * `nombreMostrar`, a field the PUT handler ignores. Neither path showed errors.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { OnboardingWizard } from "@/components/onboarding/wizard/onboarding-wizard"
import type { OnboardingWizardProps } from "@/components/onboarding/wizard/types"
import { json, wizardProps } from "./onboarding-wizard-fixtures"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

const mockCompress = vi.fn()
vi.mock("@/lib/images/compress-image", () => ({
  compressImageToDataUrl: (...args: unknown[]) => mockCompress(...args),
}))

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

const DATA_URL = "data:image/png;base64,AAAA"
const PREGUNTA = /¿Tenés un equipo para cargar ahora\?/

function configPuts() {
  return mockFetch.mock.calls.filter(([url, init]) => url === "/api/configuracion" && init?.method === "PUT")
}

async function renderOnStep1(overrides: Partial<OnboardingWizardProps> = {}) {
  mockFetch.mockImplementation(async () => json({}))
  const { container } = render(<OnboardingWizard {...wizardProps(overrides)} />)
  fireEvent.click(screen.getByRole("button", { name: /Comenzar/i }))
  await screen.findByText(/Personalizá tu negocio/i)
  return container
}

function nombreInput() {
  return screen.getByLabelText(/Nombre de tu negocio/i)
}

function pickFile(container: HTMLElement, file: File) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })
}

describe("OnboardingWizard — paso del negocio", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCompress.mockResolvedValue(DATA_URL)
    URL.createObjectURL = vi.fn(() => "blob:preview")
  })

  it("con logo elegido manda un único PUT con logoData, logoMime y nombreEmpresa, y avanza", async () => {
    const container = await renderOnStep1()
    fireEvent.change(nombreInput(), { target: { value: "  Mi Taller " } })
    pickFile(container, new File(["x"], "logo.png", { type: "image/png" }))

    fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }))

    await screen.findByRole("heading", { name: PREGUNTA })
    const puts = configPuts()
    expect(puts).toHaveLength(1)
    expect(JSON.parse(puts[0][1].body as string)).toEqual({
      nombreEmpresa: "Mi Taller",
      logoData: "AAAA",
      logoMime: "image/png",
    })
    expect(mockFetch.mock.calls.some(([url]) => url === "/api/configuracion/logo")).toBe(false)
    const progressPut = mockFetch.mock.calls.find(
      ([url, init]) => url === "/api/onboarding/progress" && init?.method === "PUT"
    )
    expect(JSON.parse(progressPut![1].body as string)).toEqual({ step_logo: true })
  })

  it("sin logo manda nombreEmpresa (no nombreMostrar) y avanza", async () => {
    await renderOnStep1()
    fireEvent.change(nombreInput(), { target: { value: "Mi Taller" } })

    fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }))

    await screen.findByRole("heading", { name: PREGUNTA })
    const puts = configPuts()
    expect(puts).toHaveLength(1)
    expect(JSON.parse(puts[0][1].body as string)).toEqual({ nombreEmpresa: "Mi Taller" })
    expect(mockCompress).not.toHaveBeenCalled()
  })

  it("sin nombre ni logo avanza sin llamar a la API", async () => {
    await renderOnStep1()

    fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }))

    await screen.findByRole("heading", { name: PREGUNTA })
    expect(configPuts()).toHaveLength(0)
  })

  it("un logo que vino del servidor no se vuelve a subir", async () => {
    await renderOnStep1({ nombreNegocio: "Taller", logoUrl: "https://cdn.test/logo.png" })
    await screen.findByAltText("Vista previa del logo")

    fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }))

    await screen.findByRole("heading", { name: PREGUNTA })
    const body = JSON.parse(configPuts()[0][1].body as string)
    expect(body).toEqual({ nombreEmpresa: "Taller" })
    expect(mockCompress).not.toHaveBeenCalled()
  })

  it("si la API responde 400 se queda en el paso y muestra el mensaje", async () => {
    const container = await renderOnStep1()
    pickFile(container, new File(["x"], "logo.png", { type: "image/png" }))
    mockFetch.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "PUT" ? json({ error: "El logo es demasiado grande" }, 400) : json({})
    )

    fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }))

    expect(await screen.findByRole("alert")).toHaveTextContent("El logo es demasiado grande")
    expect(screen.getByText(/Personalizá tu negocio/i)).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: PREGUNTA })).not.toBeInTheDocument()
  })

  it("si falla la red se queda en el paso y muestra un mensaje genérico", async () => {
    await renderOnStep1()
    fireEvent.change(nombreInput(), { target: { value: "Mi Taller" } })
    mockFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") throw new TypeError("network down")
      return json({})
    })

    fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }))

    expect(await screen.findByRole("alert")).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: PREGUNTA })).not.toBeInTheDocument()
  })

  it("rechaza archivos que no son imagen con un mensaje inline", async () => {
    const container = await renderOnStep1()

    pickFile(container, new File(["x"], "doc.pdf", { type: "application/pdf" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(/imagen válida/i)
    fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }))
    await waitFor(() => expect(screen.getByRole("heading", { name: PREGUNTA })).toBeInTheDocument())
    expect(configPuts()).toHaveLength(0)
  })

  it("rechaza imágenes de más de 5MB con un mensaje inline", async () => {
    const container = await renderOnStep1()
    const big = new File(["x"], "big.png", { type: "image/png" })
    Object.defineProperty(big, "size", { value: 6 * 1024 * 1024 })

    pickFile(container, big)

    expect(await screen.findByRole("alert")).toHaveTextContent(/5MB/)
  })

  it("un archivo inválido después de uno válido descarta el logo anterior", async () => {
    const container = await renderOnStep1()
    fireEvent.change(nombreInput(), { target: { value: "Mi Taller" } })
    pickFile(container, new File(["x"], "logo.png", { type: "image/png" }))
    pickFile(container, new File(["x"], "doc.pdf", { type: "application/pdf" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(/imagen válida/i)

    fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }))

    await screen.findByRole("heading", { name: PREGUNTA })
    const puts = configPuts()
    expect(puts).toHaveLength(1)
    expect(JSON.parse(puts[0][1].body as string)).toEqual({ nombreEmpresa: "Mi Taller" })
    expect(mockCompress).not.toHaveBeenCalled()
  })

  it("si la imagen no se puede leer muestra un mensaje de imagen y no envía el PUT", async () => {
    const container = await renderOnStep1()
    mockCompress.mockRejectedValue(new Event("error"))
    pickFile(container, new File(["x"], "logo.heic", { type: "image/heic" }))

    fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }))

    expect(await screen.findByRole("alert")).toHaveTextContent(/No pudimos leer la imagen/i)
    expect(screen.queryByRole("heading", { name: PREGUNTA })).not.toBeInTheDocument()
    expect(configPuts()).toHaveLength(0)
  })

  it("volver desde la pregunta conserva el nombre y no vuelve a subir el logo", async () => {
    const container = await renderOnStep1()
    fireEvent.change(nombreInput(), { target: { value: "Mi Taller" } })
    pickFile(container, new File(["x"], "logo.png", { type: "image/png" }))
    fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }))
    await screen.findByRole("heading", { name: PREGUNTA })

    fireEvent.click(screen.getByRole("button", { name: /Atrás/i }))
    await screen.findByText(/Personalizá tu negocio/i)
    expect(nombreInput()).toHaveValue("Mi Taller")
    fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }))

    await screen.findByRole("heading", { name: PREGUNTA })
    const puts = configPuts()
    expect(puts).toHaveLength(2)
    expect(JSON.parse(puts[1][1].body as string)).toEqual({ nombreEmpresa: "Mi Taller" })
    expect(mockCompress).toHaveBeenCalledTimes(1)
  })
})
```

Replace `__tests__/components/onboarding-wizard-primera-orden.test.tsx` entirely:

```tsx
/**
 * "¿Tenés un equipo para cargar ahora?" — the fork after the business step.
 *
 * "Sí" must complete onboarding with camino "real" and navigate once to
 * /ordenes?nueva=1 (#445: two competing navigations and a param nobody read).
 * "Omitir" completes with camino "omitido". The old sample-data button and the
 * "Primer cliente" step are gone.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { OnboardingWizard } from "@/components/onboarding/wizard/onboarding-wizard"
import type { OnboardingWizardProps } from "@/components/onboarding/wizard/types"
import { resolveTerminologia } from "@/lib/terminologia"
import { bodyOf, callsTo, json, wizardProps } from "./onboarding-wizard-fixtures"

const push = vi.fn()
const refresh = vi.fn()
const router = { push, refresh }
vi.mock("next/navigation", () => ({ useRouter: () => router }))

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

async function irAPregunta(overrides: Partial<OnboardingWizardProps> = {}) {
  render(<OnboardingWizard {...wizardProps(overrides)} />)
  fireEvent.click(screen.getByRole("button", { name: /Comenzar/i }))
  await screen.findByText(/Personalizá tu negocio/i)
  fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }))
  await screen.findByRole("heading", { name: /para cargar ahora\?/ })
}

function completeCalls() {
  return callsTo(mockFetch, "POST", "/api/onboarding/complete")
}

describe("OnboardingWizard — question step", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockImplementation(async () => json({}))
  })

  it("Sí completes with camino real and navigates exactly once, to /ordenes?nueva=1", async () => {
    await irAPregunta()

    fireEvent.click(screen.getByRole("button", { name: "Sí, tengo uno" }))

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
    expect(push).toHaveBeenCalledWith("/ordenes?nueva=1")
    expect(completeCalls()).toHaveLength(1)
    expect(bodyOf(completeCalls()[0])).toEqual({ camino: "real" })
  })

  it("still navigates once to /ordenes?nueva=1 when the completion request fails", async () => {
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/onboarding/complete" && init?.method === "POST") throw new TypeError("network down")
      return json({})
    })
    vi.spyOn(console, "error").mockImplementation(() => {})
    await irAPregunta()

    fireEvent.click(screen.getByRole("button", { name: "Sí, tengo uno" }))

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
    expect(push).toHaveBeenCalledWith("/ordenes?nueva=1")
  })

  it("a double tap on Sí sends one completion and one navigation", async () => {
    await irAPregunta()
    const si = screen.getByRole("button", { name: "Sí, tengo uno" })

    fireEvent.click(si)
    fireEvent.click(si)

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
    expect(completeCalls()).toHaveLength(1)
  })

  it("Omitir on the welcome step completes with camino omitido and goes to the dashboard", async () => {
    render(<OnboardingWizard {...wizardProps()} />)

    fireEvent.click(screen.getByRole("button", { name: /Omitir/i }))

    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"))
    expect(push).toHaveBeenCalledTimes(1)
    expect(bodyOf(completeCalls()[0])).toEqual({ camino: "omitido" })
  })

  it("Omitir is still offered on the question step", async () => {
    await irAPregunta()

    fireEvent.click(screen.getByRole("button", { name: /Omitir/i }))

    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"))
    expect(bodyOf(completeCalls()[0])).toEqual({ camino: "omitido" })
  })

  it.each([
    ["Pieza", "¿Tenés una pieza para cargar ahora?", "Sí, tengo una"],
    ["Vehículo", "¿Tenés un vehículo para cargar ahora?", "Sí, tengo uno"],
    ["Máquina de café", "¿Tenés una máquina de café para cargar ahora?", "Sí, tengo una"],
  ])("speaks the org's vocabulary (%s)", async (equipo, titulo, boton) => {
    await irAPregunta({ terminologia: resolveTerminologia({ equipo }) })

    expect(screen.getByRole("heading", { name: titulo })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: boton })).toBeInTheDocument()
  })

  it("no longer offers sample data nor a first-client step", async () => {
    await irAPregunta()

    expect(screen.queryByText(/datos de ejemplo/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Tu primer cliente/i)).not.toBeInTheDocument()
    expect(mockFetch.mock.calls.some(([url]) => url === "/api/onboarding/sample-data")).toBe(false)
    expect(mockFetch.mock.calls.some(([url]) => url === "/api/clientes")).toBe(false)
  })

  it("moves focus to the new step's title", async () => {
    render(<OnboardingWizard {...wizardProps()} />)

    fireEvent.click(screen.getByRole("button", { name: /Comenzar/i }))

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Personalizá tu negocio/i })).toHaveFocus()
    )
  })
})
```

Create `__tests__/components/onboarding-wizard-rubro.test.tsx`:

```tsx
/**
 * The rubro change from the business step: the shell shows the saved rubro at
 * once, re-reads the server props (tipos, vocabulary) and reloads the root
 * CurrencyProvider, so the next screen does not keep the old vocabulary.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { OnboardingWizard } from "@/components/onboarding/wizard/onboarding-wizard"
import type { OnboardingWizardProps } from "@/components/onboarding/wizard/types"
import { json, routeFetch, wizardProps } from "./onboarding-wizard-fixtures"

const push = vi.fn()
const refresh = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }))

const refreshConfig = vi.fn()
vi.mock("@/contexts/currency-context", () => ({ useCurrency: () => ({ refreshConfig }) }))

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch
const RUBRO = "PUT /api/onboarding/rubro"

async function irANegocio(overrides: Partial<OnboardingWizardProps> = {}) {
  render(<OnboardingWizard {...wizardProps(overrides)} />)
  fireEvent.click(screen.getByRole("button", { name: /Comenzar/i }))
  await screen.findByText(/Personalizá tu negocio/i)
}

function cambiarA(nombre: RegExp) {
  fireEvent.click(screen.getByRole("button", { name: "Cambiar rubro" }))
  fireEvent.click(screen.getByRole("radio", { name: nombre }))
  fireEvent.click(screen.getByRole("button", { name: "Guardar rubro" }))
}

describe("OnboardingWizard — rubro change", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
  })

  it("shows the new rubro and reloads tipos and vocabulary", async () => {
    routeFetch(mockFetch, { [RUBRO]: [json({ rubro: "automotor", rubroDetalle: null, tiposActivos: [] })] })
    await irANegocio()

    cambiarA(/Taller mecánico/)

    expect(await screen.findByText("Taller mecánico / Automotor")).toBeInTheDocument()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refreshConfig).toHaveBeenCalledTimes(1)
  })

  it("locks Cambiar after the server answers 409", async () => {
    routeFetch(mockFetch, { [RUBRO]: [json({ error: "Ya tenés órdenes reales" }, 409)] })
    await irANegocio()

    cambiarA(/Taller mecánico/)
    expect(await screen.findByRole("alert")).toHaveTextContent("Ya tenés órdenes reales")
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))

    await waitFor(() => expect(screen.getByRole("button", { name: "Cambiar rubro" })).toBeDisabled())
    expect(screen.getByText("Ya cargaste órdenes, así que el rubro queda como está.")).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  it("Cambiar is disabled from the start when the shop has real orders", async () => {
    await irANegocio({ ordenesRealesCount: 2 })

    expect(screen.getByRole("button", { name: "Cambiar rubro" })).toBeDisabled()
    expect(screen.getByText("Ya cargaste órdenes, así que el rubro queda como está.")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests and check that they fail**

Run: `npx vitest run __tests__/components/onboarding-wizard-logo.test.tsx __tests__/components/onboarding-wizard-primera-orden.test.tsx __tests__/components/onboarding-wizard-rubro.test.tsx`

Expected: FAIL with `Cannot find module '@/components/onboarding/wizard/onboarding-wizard'`.

- [ ] **Step 3: Write the minimal implementation**

Create `components/onboarding/wizard/negocio-step.tsx`:

```tsx
"use client"

import { useState } from "react"
import { ChevronLeft, ChevronRight, Loader2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { compressImageToDataUrl } from "@/lib/images/compress-image"
import { RubroSelector } from "./rubro-selector"
import type { RubroVigente } from "./types"

const MAX_LOGO_BYTES = 5 * 1024 * 1024

interface NegocioStepProps {
  nombre: string
  onNombreChange: (nombre: string) => void
  logoFile: File | null
  logoPreview: string | null
  onLogoChange: (file: File | null, preview: string | null) => void
  rubro: RubroVigente
  rubroBloqueado: boolean
  onRubroGuardado: (rubro: RubroVigente) => void
  onRubroBloqueado: () => void
  /** router.refresh() is bringing the new tipos and vocabulary after a rubro change. */
  actualizando: boolean
  onAtras: () => void
  onGuardado: () => void
}

export function NegocioStep({
  nombre,
  onNombreChange,
  logoFile,
  logoPreview,
  onLogoChange,
  rubro,
  rubroBloqueado,
  onRubroGuardado,
  onRubroBloqueado,
  actualizando,
  onAtras,
  onGuardado,
}: NegocioStepProps) {
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleLogoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target
    const file = input.files?.[0]
    // Reset so picking the same file again still fires onChange.
    const resetInput = () => {
      input.value = ""
    }
    if (!file) return

    const rejectFile = (message: string) => {
      // Drop any previously picked logo: it must not be uploaded after an invalid pick.
      onLogoChange(null, null)
      setError(message)
      resetInput()
    }

    if (!file.type.startsWith("image/")) {
      rejectFile("Elegí una imagen válida.")
      return
    }
    if (file.size > MAX_LOGO_BYTES) {
      rejectFile("La imagen es demasiado grande (máximo 5MB).")
      return
    }

    setError(null)
    onLogoChange(file, URL.createObjectURL(file))
    resetInput()
  }

  // Single save (#443): name and, only if a new file was picked, logo.
  const handleSiguiente = async () => {
    const nombreEmpresa = nombre.trim()
    if (!nombreEmpresa && !logoFile) {
      onGuardado()
      return
    }
    setGuardando(true)
    setError(null)
    try {
      const payload: Record<string, string> = {}
      if (nombreEmpresa) payload.nombreEmpresa = nombreEmpresa
      if (logoFile) {
        let dataUrl: string
        try {
          dataUrl = await compressImageToDataUrl(logoFile)
        } catch (err) {
          console.error("Error compressing logo:", err)
          setError("No pudimos leer la imagen. Probá con un PNG o JPG.")
          return
        }
        const [header, data] = dataUrl.split(",")
        payload.logoData = data
        payload.logoMime = header.split(":")[1].split(";")[0]
      }

      const res = await fetch("/api/configuracion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.error || "No pudimos guardar los datos. Probá de nuevo.")
        return
      }

      await fetch("/api/onboarding/progress", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step_logo: true }),
      })
      onGuardado()
    } catch (err) {
      console.error("Error saving business data:", err)
      setError("No pudimos guardar los datos. Revisá tu conexión y probá de nuevo.")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <>
      <CardHeader>
        <CardTitle data-paso-titulo tabIndex={-1} className="flex items-center gap-2 outline-none">
          <Upload className="h-5 w-5 text-blue-600" aria-hidden="true" />
          Personalizá tu negocio
        </CardTitle>
        <CardDescription>Así te ven tus clientes en los avisos y en los comprobantes.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="negocio-nombre">Nombre de tu negocio</Label>
          <Input
            id="negocio-nombre"
            value={nombre}
            onChange={(e) => onNombreChange(e.target.value)}
            placeholder="Ej: Service Rodríguez"
            autoComplete="organization"
            disabled={guardando}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="negocio-logo">Logo (opcional)</Label>
          <input
            id="negocio-logo"
            type="file"
            accept="image/*"
            onChange={handleLogoFileChange}
            disabled={guardando}
            className="block w-full rounded-md text-sm text-muted-foreground file:mr-4 file:rounded-md file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 dark:file:bg-blue-900 dark:file:text-blue-300"
          />
          {logoPreview && (
            <img src={logoPreview} alt="Vista previa del logo" className="mt-3 h-16 w-auto rounded object-contain" />
          )}
        </div>
        <RubroSelector
          rubro={rubro.rubro}
          rubroDetalle={rubro.rubroDetalle}
          bloqueado={rubroBloqueado}
          onGuardado={onRubroGuardado}
          onBloqueado={onRubroBloqueado}
        />
        {error && (
          <div role="alert" className="rounded border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}
        <div className="flex flex-col gap-2 pt-4 sm:flex-row-reverse sm:justify-between">
          <Button onClick={() => void handleSiguiente()} disabled={guardando || actualizando}>
            {(guardando || actualizando) && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {actualizando ? "Actualizando…" : "Siguiente"}
            {!actualizando && <ChevronRight className="ml-2 h-4 w-4" aria-hidden="true" />}
          </Button>
          <Button variant="ghost" onClick={onAtras} disabled={guardando}>
            <ChevronLeft className="mr-2 h-4 w-4" aria-hidden="true" />
            Atrás
          </Button>
        </div>
      </CardContent>
    </>
  )
}
```

Create `components/onboarding/wizard/pregunta-step.tsx`:

```tsx
"use client"

import { useState } from "react"
import { ChevronLeft, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { articuloIndefinido, t, type Terminologia } from "@/lib/terminologia"

interface PreguntaStepProps {
  terminologia: Terminologia
  completando: boolean
  onSi: () => void
  onPracticar: () => void
  onAtras: () => void
}

const BOTON_GRANDE = "h-auto min-h-11 w-full whitespace-normal py-3"

export function PreguntaStep({ terminologia, completando, onSi, onPracticar, onAtras }: PreguntaStepProps) {
  const [eligioSi, setEligioSi] = useState(false)
  const equipo = t(terminologia, "equipo").toLowerCase()
  const articulo = articuloIndefinido(equipo)
  const titulo = `¿Tenés ${articulo} ${equipo} para cargar ahora?`
  const si = `Sí, tengo ${articulo === "una" ? "una" : "uno"}`

  return (
    <>
      <CardHeader>
        <CardTitle data-paso-titulo tabIndex={-1} className="text-xl outline-none">
          {titulo}
        </CardTitle>
        <CardDescription>Si ya te dejaron algo para arreglar, cargalo directo: es la mejor forma de arrancar.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          size="lg"
          className={BOTON_GRANDE}
          onClick={() => {
            setEligioSi(true)
            onSi()
          }}
          disabled={completando}
        >
          {completando && eligioSi && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          {si}
        </Button>
        <Button size="lg" variant="outline" className={BOTON_GRANDE} onClick={onPracticar} disabled={completando}>
          Todavía no, quiero practicar
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Cargás una orden de prueba a tu nombre y ves los avisos que le llegan al cliente. No suma a los límites de tu plan.
        </p>
        <div className="pt-2">
          <Button variant="ghost" onClick={onAtras} disabled={completando}>
            <ChevronLeft className="mr-2 h-4 w-4" aria-hidden="true" />
            Atrás
          </Button>
        </div>
      </CardContent>
    </>
  )
}
```

Create `components/onboarding/wizard/onboarding-wizard.tsx`:

```tsx
"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, ChevronRight, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useCurrency } from "@/contexts/currency-context"
import type { PracticaOrden } from "@/lib/onboarding/practica-shared"
import { cn } from "@/lib/utils"
import { NegocioStep } from "./negocio-step"
import { PreguntaStep } from "./pregunta-step"
import { PASOS, pasoInicial } from "./wizard-state"
import type { CaminoCompletar, OnboardingWizardProps, PasoWizard, RubroVigente } from "./types"

export function OnboardingWizard(props: OnboardingWizardProps) {
  const router = useRouter()
  const { refreshConfig } = useCurrency()
  const [paso, setPaso] = useState<PasoWizard>(() => pasoInicial(props.practica))
  const [practica, setPractica] = useState<PracticaOrden | null>(props.practica)

  // Business drafts live here so that going back from a later step keeps them.
  const [nombre, setNombre] = useState(props.nombreNegocio)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(props.logoUrl)

  // The props are a server snapshot: a rubro saved here wins until
  // router.refresh() brings the next snapshot (new tipos and vocabulary).
  const [rubroGuardado, setRubroGuardado] = useState<RubroVigente | null>(null)
  const [rubroBloqueadoAhora, setRubroBloqueadoAhora] = useState(false)
  const rubro = rubroGuardado ?? { rubro: props.rubro, rubroDetalle: props.rubroDetalle }
  const rubroBloqueado = props.ordenesRealesCount > 0 || rubroBloqueadoAhora
  const [actualizando, startActualizar] = useTransition()

  const [completando, setCompletando] = useState(false)
  const completandoRef = useRef(false)

  const contenidoRef = useRef<HTMLDivElement>(null)
  const debeEnfocar = useRef(false)

  // Move focus to the new title after a step change, so keyboard and
  // screen-reader users land on what changed. Never on mount.
  useEffect(() => {
    if (!debeEnfocar.current) return
    debeEnfocar.current = false
    contenidoRef.current?.querySelector<HTMLElement>("[data-paso-titulo]")?.focus()
  }, [paso, practica])

  const irA = (siguiente: PasoWizard) => {
    debeEnfocar.current = true
    setPaso(siguiente)
  }

  const completar = async (destino: string, camino?: CaminoCompletar) => {
    // A ref, not state: two taps in the same frame must not both get through.
    if (completandoRef.current) return
    completandoRef.current = true
    setCompletando(true)
    try {
      await fetch(
        "/api/onboarding/complete",
        camino
          ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ camino }) }
          : { method: "POST" }
      )
    } catch (err) {
      console.error("Error completing onboarding:", err)
    } finally {
      // Navigate even if completion failed: the dashboard sends the user back
      // here when it did not persist, and the CTA must never be a no-op.
      router.push(destino)
      router.refresh()
    }
  }

  const handleRubroGuardado = (nuevo: RubroVigente) => {
    setRubroGuardado(nuevo)
    setPractica(null) // the rubro change deletes the practice server-side
    refreshConfig()
    startActualizar(() => router.refresh())
  }

  const handleNegocioGuardado = () => {
    setLogoFile(null) // saved: going back and forth must not upload it again
    irA("pregunta")
  }

  const primerNombre = props.ownerNombre.trim().split(/\s+/)[0] ?? ""

  return (
    <div className="flex min-h-dvh items-start justify-center bg-gradient-to-br from-blue-50 to-indigo-50 px-4 py-6 dark:from-gray-950 dark:to-gray-900 sm:items-center sm:p-6">
      <div className="w-full max-w-2xl space-y-6">
        <PasosIndicador actual={paso} />
        <Card className="shadow-xl">
          <div
            ref={contenidoRef}
            key={paso}
            className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-snappy"
          >
            {paso === "bienvenida" && (
              <>
                <CardHeader className="pb-2 text-center">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900">
                    <Sparkles className="h-8 w-8 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                  </div>
                  <CardTitle data-paso-titulo tabIndex={-1} className="text-2xl outline-none">
                    {primerNombre ? `¡Hola, ${primerNombre}!` : "¡Te damos la bienvenida a STApp!"}
                  </CardTitle>
                  <CardDescription className="mt-2 text-base">
                    En un par de minutos dejás tu cuenta lista y ves cómo se entera tu cliente de cada paso.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-4">
                  <Button onClick={() => irA("negocio")} className="w-full" size="lg">
                    Comenzar
                    <ChevronRight className="ml-2 h-4 w-4" aria-hidden="true" />
                  </Button>
                </CardContent>
              </>
            )}
            {paso === "negocio" && (
              <NegocioStep
                nombre={nombre}
                onNombreChange={setNombre}
                logoFile={logoFile}
                logoPreview={logoPreview}
                onLogoChange={(file, preview) => {
                  setLogoFile(file)
                  setLogoPreview(preview)
                }}
                rubro={rubro}
                rubroBloqueado={rubroBloqueado}
                onRubroGuardado={handleRubroGuardado}
                onRubroBloqueado={() => setRubroBloqueadoAhora(true)}
                actualizando={actualizando}
                onAtras={() => irA("bienvenida")}
                onGuardado={handleNegocioGuardado}
              />
            )}
            {paso === "pregunta" && (
              <PreguntaStep
                terminologia={props.terminologia}
                completando={completando}
                onSi={() => void completar("/ordenes?nueva=1", "real")}
                onPracticar={() => irA("practica")}
                onAtras={() => irA("negocio")}
              />
            )}
          </div>
        </Card>
        {paso !== "listo" && (
          <div className="flex justify-center">
            <Button
              variant="ghost"
              onClick={() => void completar("/dashboard", "omitido")}
              disabled={completando}
              className="text-muted-foreground"
            >
              Omitir y entrar al panel
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function PasosIndicador({ actual }: { actual: PasoWizard }) {
  const indiceActual = PASOS.findIndex((p) => p.key === actual)
  return (
    <ol aria-label="Pasos de la configuración" className="flex items-center justify-center">
      {PASOS.map((p, idx) => {
        const hecho = idx < indiceActual
        const esActual = idx === indiceActual
        return (
          <li key={p.key} aria-current={esActual ? "step" : undefined} className="flex items-center">
            <span
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors duration-200",
                hecho && "bg-green-500 text-white",
                esActual && "bg-blue-600 text-white",
                !hecho && !esActual && "bg-muted text-muted-foreground"
              )}
            >
              {hecho ? <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> : <span aria-hidden="true">{idx + 1}</span>}
              <span className="sr-only">
                {p.titulo}
                {hecho ? " (hecho)" : ""}
              </span>
            </span>
            {idx < PASOS.length - 1 && (
              <span aria-hidden="true" className={cn("mx-1 h-0.5 w-6 sm:w-8", hecho ? "bg-green-500" : "bg-muted")} />
            )}
          </li>
        )
      })}
    </ol>
  )
}
```

At 360 px, the indicator is 5 × 32 px plus 4 × (24 + 8) px = 288 px, inside the 328 px content width.

- [ ] **Step 4: Run the tests and check that they pass**

Run: `npx vitest run __tests__/components/onboarding-wizard-logo.test.tsx __tests__/components/onboarding-wizard-primera-orden.test.tsx __tests__/components/onboarding-wizard-rubro.test.tsx`

Expected: PASS (11 + 10 + 3 tests).

- [ ] **Step 5: Commit**

```bash
git add components/onboarding/wizard/negocio-step.tsx components/onboarding/wizard/pregunta-step.tsx components/onboarding/wizard/onboarding-wizard.tsx __tests__/components/onboarding-wizard-logo.test.tsx __tests__/components/onboarding-wizard-primera-orden.test.tsx __tests__/components/onboarding-wizard-rubro.test.tsx
git commit -m "feat(onboarding): new wizard shell with business and question steps"
```

---

## Task 9: Practice and Listo in the shell, and resume

**Files:**
- Create: `components/onboarding/wizard/listo-step.tsx`
- Modify: `components/onboarding/wizard/onboarding-wizard.tsx` (imports, `handlePracticaChange`, two JSX branches)
- Test: `__tests__/components/onboarding-wizard-practica.test.tsx`

**Interfaces:**
- Consumes: `PracticaStep` (Task 6), `VerLoQueVeTuCliente` (Task 2), and the shell (Task 8).
- Produces: `ListoStep({ practica, completando, onCompletar(destino) })`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/onboarding-wizard-practica.test.tsx`:

```tsx
/**
 * The practice path through the whole wizard: from the question to Listo,
 * resuming mid-practice, and the two Listo CTAs (no camino: the practice POST
 * already recorded it).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { OnboardingWizard } from "@/components/onboarding/wizard/onboarding-wizard"
import { bodyOf, callsTo, json, practica, routeFetch, wizardProps } from "./onboarding-wizard-fixtures"

const push = vi.fn()
const refresh = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }))

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

const PRACTICA_URL = "/api/onboarding/practica"
const LISTO = "¡Listo! Ya viste cómo funciona"

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockReset()
  mockFetch.mockImplementation(async () => json({}))
})

describe("OnboardingWizard — practice path", () => {
  it("runs the whole practice from the question to Listo", async () => {
    routeFetch(mockFetch, {
      [`POST ${PRACTICA_URL}`]: [json({ practica: practica() }, 201)],
      [`PATCH ${PRACTICA_URL}`]: [
        json({ practica: practica({ estado: "REPARADO", costoFinal: 15000 }) }),
        json({ practica: practica({ estado: "ENTREGADO_SIN_COBRO", costoFinal: 15000 }) }),
      ],
    })
    render(<OnboardingWizard {...wizardProps()} />)
    fireEvent.click(screen.getByRole("button", { name: /Comenzar/i }))
    await screen.findByText(/Personalizá tu negocio/i)
    fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }))
    fireEvent.click(await screen.findByRole("button", { name: "Todavía no, quiero practicar" }))

    await screen.findByRole("heading", { name: "Cargá tu orden de práctica" })
    fireEvent.change(screen.getByLabelText("Equipo"), { target: { value: "Gafa HGF-357" } })
    fireEvent.click(screen.getByRole("button", { name: "No enfría" }))
    fireEvent.click(screen.getByRole("button", { name: "Cargar orden de práctica" }))

    await screen.findByRole("heading", { name: "Ahora, la reparación" })
    fireEvent.change(screen.getByLabelText("¿Cuánto cobrarías?"), { target: { value: "15000" } })
    fireEvent.click(screen.getByRole("button", { name: "Marcar como reparada" }))

    await screen.findByRole("heading", { name: "Última parada: la entrega" })
    fireEvent.click(screen.getByRole("button", { name: "Entregar" }))

    expect(await screen.findByRole("heading", { name: LISTO })).toBeInTheDocument()
    expect(screen.getByText("La práctica queda en tu lista hasta que cargues tu primera orden real.")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Ver lo que ve tu cliente/ })).toHaveAttribute("href", "/seguimiento/tok-123")
    expect(screen.queryByRole("button", { name: /Omitir/ })).not.toBeInTheDocument()
    expect(callsTo(mockFetch, "PATCH", PRACTICA_URL).map(bodyOf)).toEqual([
      { accion: "reparar", costoFinal: 15000 },
      { accion: "entregar" },
    ])
  })

  it.each([
    ["RECIBIDO", "Ahora, la reparación"],
    ["REPARADO", "Última parada: la entrega"],
  ] as const)("resumes a practice left in %s", (estado, titulo) => {
    render(<OnboardingWizard {...wizardProps({ practica: practica({ estado, costoFinal: 15000 }) })} />)

    expect(screen.getByRole("heading", { name: titulo })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Comenzar/i })).not.toBeInTheDocument()
  })

  it("resumes on Listo when the practice was already delivered", () => {
    render(<OnboardingWizard {...wizardProps({ practica: practica({ estado: "ENTREGADO_SIN_COBRO" }) })} />)

    expect(screen.getByRole("heading", { name: LISTO })).toBeInTheDocument()
  })

  it("Cargar mi primera orden real completes without camino and navigates once", async () => {
    render(<OnboardingWizard {...wizardProps({ practica: practica({ estado: "ENTREGADO_SIN_COBRO" }) })} />)

    fireEvent.click(screen.getByRole("button", { name: "Cargar mi primera orden real" }))

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
    expect(push).toHaveBeenCalledWith("/ordenes?nueva=1")
    const complete = callsTo(mockFetch, "POST", "/api/onboarding/complete")
    expect(complete).toHaveLength(1)
    expect(complete[0][1]).toEqual({ method: "POST" })
  })

  it("Ir al panel completes and goes to the dashboard", async () => {
    render(<OnboardingWizard {...wizardProps({ practica: practica({ estado: "ENTREGADO_SIN_COBRO" }) })} />)

    fireEvent.click(screen.getByRole("button", { name: "Ir al panel" }))

    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"))
    expect(push).toHaveBeenCalledTimes(1)
  })

  it("Omitir still works while a practice error is shown", async () => {
    routeFetch(mockFetch, { [`PATCH ${PRACTICA_URL}`]: [json({ error: "Se cortó" }, 500)] })
    render(<OnboardingWizard {...wizardProps({ practica: practica() })} />)
    fireEvent.change(screen.getByLabelText("¿Cuánto cobrarías?"), { target: { value: "15000" } })
    fireEvent.click(screen.getByRole("button", { name: "Marcar como reparada" }))
    await screen.findByRole("alert")

    fireEvent.click(screen.getByRole("button", { name: /Omitir/ }))

    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"))
    expect(bodyOf(callsTo(mockFetch, "POST", "/api/onboarding/complete")[0])).toEqual({ camino: "omitido" })
  })

  it("Atrás on the practice form returns to the question", async () => {
    render(<OnboardingWizard {...wizardProps()} />)
    fireEvent.click(screen.getByRole("button", { name: /Comenzar/i }))
    await screen.findByText(/Personalizá tu negocio/i)
    fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }))
    fireEvent.click(await screen.findByRole("button", { name: "Todavía no, quiero practicar" }))
    await screen.findByRole("heading", { name: "Cargá tu orden de práctica" })

    fireEvent.click(screen.getByRole("button", { name: /Atrás/ }))

    expect(await screen.findByRole("heading", { name: /para cargar ahora\?/ })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test and check that it fails**

Run: `npx vitest run __tests__/components/onboarding-wizard-practica.test.tsx`

Expected: FAIL. Resume shows nothing (no branch renders "practica"/"listo"), and "Cargá tu orden de práctica" never appears.

- [ ] **Step 3: Write the minimal implementation**

Create `components/onboarding/wizard/listo-step.tsx`:

```tsx
"use client"

import { useState } from "react"
import { Loader2, Rocket } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { VerLoQueVeTuCliente } from "@/components/onboarding/ver-lo-que-ve-tu-cliente"
import type { PracticaOrden } from "@/lib/onboarding/practica-shared"

interface ListoStepProps {
  practica: PracticaOrden | null
  completando: boolean
  onCompletar: (destino: string) => void
}

const PRIMERA_ORDEN = "/ordenes?nueva=1"
const PANEL = "/dashboard"

export function ListoStep({ practica, completando, onCompletar }: ListoStepProps) {
  const [destino, setDestino] = useState<string | null>(null)
  const ir = (siguiente: string) => {
    setDestino(siguiente)
    onCompletar(siguiente)
  }

  return (
    <>
      <CardHeader className="pb-2 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
          <Rocket className="h-8 w-8 text-green-600 dark:text-green-400" aria-hidden="true" />
        </div>
        <CardTitle data-paso-titulo tabIndex={-1} className="text-2xl outline-none">
          ¡Listo! Ya viste cómo funciona
        </CardTitle>
        <CardDescription className="mt-2 text-base">
          Le mandamos el último email: la entrega quedó registrada.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        {practica && (
          <div className="flex justify-center">
            <VerLoQueVeTuCliente publicToken={practica.publicToken} />
          </div>
        )}
        <Button
          size="lg"
          className="h-auto min-h-11 w-full whitespace-normal py-3"
          onClick={() => ir(PRIMERA_ORDEN)}
          disabled={completando}
        >
          {completando && destino === PRIMERA_ORDEN && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          Cargar mi primera orden real
        </Button>
        <Button size="lg" variant="outline" className="w-full" onClick={() => ir(PANEL)} disabled={completando}>
          {completando && destino === PANEL && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          Ir al panel
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          La práctica queda en tu lista hasta que cargues tu primera orden real.
        </p>
      </CardContent>
    </>
  )
}
```

In `components/onboarding/wizard/onboarding-wizard.tsx`:

Add the imports:

```tsx
import { ListoStep } from "./listo-step"
import { PracticaStep } from "./practica-step"
```

After `handleNegocioGuardado`, add:

```tsx
  const handlePracticaChange = (nueva: PracticaOrden | null) => {
    debeEnfocar.current = true
    setPractica(nueva)
    if (nueva?.estado === "ENTREGADO_SIN_COBRO") setPaso("listo")
  }
```

Right after the `{paso === "pregunta" && (…)}` block, add:

```tsx
            {paso === "practica" && (
              <PracticaStep
                practica={practica}
                tipos={props.tipos}
                terminologia={props.terminologia}
                ownerEmail={props.ownerEmail}
                moneda={props.moneda}
                onPracticaChange={handlePracticaChange}
                onAtras={() => irA("pregunta")}
              />
            )}
            {paso === "listo" && (
              <ListoStep practica={practica} completando={completando} onCompletar={(destino) => void completar(destino)} />
            )}
```

- [ ] **Step 4: Run the tests and check that they pass**

Run: `npx vitest run __tests__/components/onboarding-wizard-practica.test.tsx __tests__/components/onboarding-wizard-primera-orden.test.tsx __tests__/components/onboarding-wizard-logo.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/onboarding/wizard/listo-step.tsx components/onboarding/wizard/onboarding-wizard.tsx __tests__/components/onboarding-wizard-practica.test.tsx
git commit -m "feat(onboarding): run and resume the practice inside the wizard"
```

---

## Task 10: Feed the wizard from the server and delete the old one

**Files:**
- Create: `app/(dashboard)/onboarding/wizard-props.ts`
- Modify: `app/(dashboard)/onboarding/page.tsx` (full rewrite, 10 lines)
- Delete: `components/onboarding/onboarding-wizard.tsx`
- Test: `__tests__/app/onboarding-wizard-props.test.ts`
- Test: `__tests__/app/onboarding-page.test.ts`

**Interfaces:**
- Consumes:
  - `getPracticaOrden` (PR 1).
  - `getRubro` (`lib/rubros`).
  - `resolveTerminologia` (`lib/terminologia.ts`).
  - `CURRENCIES` and `DEFAULT_CURRENCY` (`lib/currency.ts`).
  - `OnboardingWizardProps` and `TipoPractica` (Task 4).
  - `OnboardingWizard` (Tasks 8–9).
- Produces: `loadOnboardingWizardProps(params)` and `tiposParaPractica(rows)`.

The real queries (PostgREST against production data) are covered by the manual preview pass in Task 12. These tests pin the mapping, the filters and the gate.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/app/onboarding-wizard-props.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

type Respuesta = { data?: unknown; count?: number | null; error?: unknown }
const respuestas: Record<string, Respuesta> = {}
const llamadas: Array<{ tabla: string; metodo: string; args: unknown[] }> = []

/**
 * Chainable stand-in for a PostgREST builder: every method returns the
 * builder, and awaiting it (or .single()) yields the canned response for its table.
 */
function builder(tabla: string): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (value: Respuesta) => void) => resolve(respuestas[tabla] ?? { data: null })
        }
        return (...args: unknown[]) => {
          llamadas.push({ tabla, metodo: String(prop), args })
          return prop === "single" || prop === "maybeSingle"
            ? Promise.resolve(respuestas[tabla] ?? { data: null })
            : proxy
        }
      },
    }
  )
  return proxy
}

vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: (tabla: string) => builder(tabla) } }))

const getPracticaOrden = vi.fn()
vi.mock("@/lib/onboarding/practica", () => ({
  getPracticaOrden: (...args: unknown[]) => getPracticaOrden(...args),
}))

import { loadOnboardingWizardProps, tiposParaPractica } from "@/app/(dashboard)/onboarding/wizard-props"

const PARAMS = { organizationId: "org-1", userId: "user-1", fallbackNombre: "Sesión", fallbackEmail: "sesion@test.com" }
const PRACTICA = {
  id: "prac-1",
  estado: "RECIBIDO",
  publicToken: "tok-123",
  tipoDispositivo: "HELADERA",
  dispositivo: "Gafa",
  problemaReportado: "No enfría",
  costoFinal: null,
}

beforeEach(() => {
  llamadas.length = 0
  for (const key of Object.keys(respuestas)) delete respuestas[key]
  getPracticaOrden.mockReset().mockResolvedValue(null)
})

describe("loadOnboardingWizardProps", () => {
  it("builds the props from the org, the owner, the tipos and the practice", async () => {
    respuestas.organizations = {
      data: {
        nombre: "taller-ana",
        nombre_mostrar: "Taller Ana",
        logo_url: "https://cdn.test/l.png",
        rubro: "electrodomesticos",
        rubro_detalle: null,
        moneda: "CLP",
        terminologia: { equipo: "Artefacto" },
      },
    }
    respuestas.users = { data: { nombre: "Ana Pérez", email: "ana@taller.test" } }
    respuestas.tipos_dispositivo = {
      data: [{ codigo: "HELADERA", nombre: "Heladera / Freezer", config: { marcas: ["Gafa"], problemasComunes: ["No enfría"] } }],
    }
    respuestas.ordenes_servicio = { data: null, count: 2 }
    getPracticaOrden.mockResolvedValue(PRACTICA)

    const props = await loadOnboardingWizardProps(PARAMS)

    expect(props).toEqual({
      nombreNegocio: "Taller Ana",
      logoUrl: "https://cdn.test/l.png",
      rubro: "electrodomesticos",
      rubroDetalle: null,
      ownerNombre: "Ana Pérez",
      ownerEmail: "ana@taller.test",
      tipos: [{ codigo: "HELADERA", nombre: "Heladera / Freezer", marcas: ["Gafa"], problemasComunes: ["No enfría"] }],
      terminologia: expect.objectContaining({ equipo: "Artefacto", orden: "Orden de trabajo" }),
      moneda: "CLP",
      ordenesRealesCount: 2,
      practica: PRACTICA,
    })
    expect(getPracticaOrden).toHaveBeenCalledWith("org-1")
  })

  it("counts only the org's real orders", async () => {
    await loadOnboardingWizardProps(PARAMS)

    const filtros = llamadas.filter((l) => l.tabla === "ordenes_servicio" && l.metodo === "eq").map((l) => l.args)
    expect(filtros).toContainEqual(["organization_id", "org-1"])
    expect(filtros).toContainEqual(["es_practica", false])
  })

  it("reads only the org's active tipos, in their order", async () => {
    await loadOnboardingWizardProps(PARAMS)

    const tipos = llamadas.filter((l) => l.tabla === "tipos_dispositivo")
    expect(tipos.map((l) => [l.metodo, ...l.args])).toEqual(
      expect.arrayContaining([
        ["eq", "organization_id", "org-1"],
        ["eq", "activo", true],
        ["order", "orden", { ascending: true }],
      ])
    )
  })

  it("falls back for a bare org: name, unknown rubro and currency, missing owner row", async () => {
    respuestas.organizations = {
      data: {
        nombre: "taller-ana",
        nombre_mostrar: null,
        logo_url: null,
        rubro: "inexistente",
        rubro_detalle: null,
        moneda: "XXX",
        terminologia: null,
      },
    }

    const props = await loadOnboardingWizardProps(PARAMS)

    expect(props.nombreNegocio).toBe("taller-ana")
    expect(props.rubro).toBe("generico")
    expect(props.moneda).toBe("ARS")
    expect(props.terminologia.equipo).toBe("Equipo")
    expect(props.ownerNombre).toBe("Sesión")
    expect(props.ownerEmail).toBe("sesion@test.com")
    expect(props.ordenesRealesCount).toBe(0)
    expect(props.tipos).toEqual([])
    expect(props.practica).toBeNull()
  })
})

describe("tiposParaPractica", () => {
  it("drops the TODOS bucket unless it is the only tipo", () => {
    const celular = { codigo: "CELULAR", nombre: "Celular", config: null }
    const todos = { codigo: "TODOS", nombre: "Todos los dispositivos", config: null }

    expect(tiposParaPractica([celular, todos]).map((t) => t.codigo)).toEqual(["CELULAR"])
    expect(tiposParaPractica([todos]).map((t) => t.codigo)).toEqual(["TODOS"])
  })

  it("ignores malformed config lists", () => {
    const [tipo] = tiposParaPractica([
      { codigo: "X", nombre: "X", config: { marcas: "Gafa", problemasComunes: [1, "", "Pierde agua"] } },
    ])
    expect(tipo.marcas).toEqual([])
    expect(tipo.problemasComunes).toEqual(["Pierde agua"])
  })
})
```

Create `__tests__/app/onboarding-page.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest"
import { auth } from "@/lib/auth"
import { wizardProps } from "../components/onboarding-wizard-fixtures"

const redirect = vi.fn((url: string): never => {
  throw new Error(`REDIRECT ${url}`)
})
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }))

const loadProps = vi.fn()
vi.mock("@/app/(dashboard)/onboarding/wizard-props", () => ({
  loadOnboardingWizardProps: (...args: unknown[]) => loadProps(...args),
}))
vi.mock("@/components/onboarding/wizard/onboarding-wizard", () => ({ OnboardingWizard: () => null }))

import OnboardingPage from "@/app/(dashboard)/onboarding/page"

const authMock = auth as unknown as Mock

function session(role: string) {
  return { user: { id: "user-1", role, organizationId: "org-1", name: "Ana", email: "ana@taller.test" } }
}

describe("/onboarding page", () => {
  beforeEach(() => vi.clearAllMocks())

  it("sends a visitor without session to the login", async () => {
    authMock.mockResolvedValue(null)
    await expect(OnboardingPage()).rejects.toThrow("REDIRECT /login")
  })

  it("sends non-admin roles to the dashboard without loading anything", async () => {
    authMock.mockResolvedValue(session("TECNICO"))
    await expect(OnboardingPage()).rejects.toThrow("REDIRECT /dashboard")
    expect(loadProps).not.toHaveBeenCalled()
  })

  it("feeds the wizard with the loader's props for an admin", async () => {
    const props = wizardProps({ nombreNegocio: "Taller Ana" })
    authMock.mockResolvedValue(session("ADMIN"))
    loadProps.mockResolvedValue(props)

    const element = await OnboardingPage()

    expect(loadProps).toHaveBeenCalledWith({
      organizationId: "org-1",
      userId: "user-1",
      fallbackNombre: "Ana",
      fallbackEmail: "ana@taller.test",
    })
    expect(element.props).toEqual(props)
  })
})
```

- [ ] **Step 2: Run the tests and check that they fail**

Run: `npx vitest run __tests__/app/onboarding-wizard-props.test.ts __tests__/app/onboarding-page.test.ts`

Expected: FAIL. `Cannot find module '@/app/(dashboard)/onboarding/wizard-props'`. The page test fails because the page renders the old wizard and never redirects non-admins.

- [ ] **Step 3: Write the minimal implementation**

Create `app/(dashboard)/onboarding/wizard-props.ts`:

```ts
import { supabaseAdmin } from "@/lib/supabase"
import { getRubro } from "@/lib/rubros"
import { resolveTerminologia, type Terminologia } from "@/lib/terminologia"
import { CURRENCIES, DEFAULT_CURRENCY, type CurrencyCode } from "@/lib/currency"
import { getPracticaOrden } from "@/lib/onboarding/practica"
import type { OnboardingWizardProps, TipoPractica } from "@/components/onboarding/wizard/types"

interface TipoRow {
  codigo: string
  nombre: string
  config: { marcas?: unknown; problemasComunes?: unknown } | null
}

function textos(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.filter((v): v is string => typeof v === "string" && v.trim() !== "") : []
}

/**
 * Active tipos the practice form offers, in the org's order. "TODOS" is the
 * catch-all bucket ("Todos los dispositivos"), not a device someone brings in,
 * so it is left out unless it is the only one.
 */
export function tiposParaPractica(rows: TipoRow[]): TipoPractica[] {
  const tipos = rows.map((row) => ({
    codigo: row.codigo,
    nombre: row.nombre,
    marcas: textos(row.config?.marcas),
    problemasComunes: textos(row.config?.problemasComunes),
  }))
  const sinComodin = tipos.filter((tipo) => tipo.codigo !== "TODOS")
  return sinComodin.length > 0 ? sinComodin : tipos
}

interface LoadParams {
  organizationId: string
  userId: string
  fallbackNombre: string
  fallbackEmail: string
}

/**
 * Server snapshot the onboarding wizard renders from. The rubro and the owner
 * are not in the session and not in GET /api/configuracion, so they are read
 * here. The terminology is resolved from the column already selected (same
 * logic as getTerminologia, without a second query).
 */
export async function loadOnboardingWizardProps({
  organizationId,
  userId,
  fallbackNombre,
  fallbackEmail,
}: LoadParams): Promise<OnboardingWizardProps> {
  const [orgRes, ownerRes, tiposRes, realesRes, practica] = await Promise.all([
    supabaseAdmin
      .from("organizations")
      .select("nombre, nombre_mostrar, logo_url, rubro, rubro_detalle, moneda, terminologia")
      .eq("id", organizationId)
      .single(),
    supabaseAdmin.from("users").select("nombre, email").eq("id", userId).single(),
    supabaseAdmin
      .from("tipos_dispositivo")
      .select("codigo, nombre, config")
      .eq("organization_id", organizationId)
      .eq("activo", true)
      .order("orden", { ascending: true }),
    supabaseAdmin
      .from("ordenes_servicio")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("es_practica", false),
    getPracticaOrden(organizationId),
  ])

  const org = orgRes.data
  const moneda: CurrencyCode =
    typeof org?.moneda === "string" && org.moneda in CURRENCIES ? (org.moneda as CurrencyCode) : DEFAULT_CURRENCY

  return {
    nombreNegocio: org?.nombre_mostrar || org?.nombre || "",
    logoUrl: org?.logo_url ?? null,
    rubro: getRubro(org?.rubro).id,
    rubroDetalle: org?.rubro_detalle ?? null,
    ownerNombre: ownerRes.data?.nombre || fallbackNombre,
    ownerEmail: ownerRes.data?.email || fallbackEmail,
    tipos: tiposParaPractica((tiposRes.data ?? []) as TipoRow[]),
    terminologia: resolveTerminologia((org?.terminologia ?? null) as Terminologia | null),
    moneda,
    // A failed count reads as 0, which unlocks "Cambiar": the server's 409 is the real guard.
    ordenesRealesCount: realesRes.count ?? 0,
    practica,
  }
}
```

Replace `app/(dashboard)/onboarding/page.tsx`:

```tsx
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { OnboardingWizard } from "@/components/onboarding/wizard/onboarding-wizard"
import { loadOnboardingWizardProps } from "./wizard-props"

export default async function OnboardingPage() {
  const session = await auth()
  if (!session) redirect("/login")
  // Every request the wizard makes is ADMIN-only; other roles have nothing to do here.
  if (session.user.role !== "ADMIN") redirect("/dashboard")

  const props = await loadOnboardingWizardProps({
    organizationId: session.user.organizationId,
    userId: session.user.id,
    fallbackNombre: session.user.name ?? "",
    fallbackEmail: session.user.email ?? "",
  })

  return <OnboardingWizard {...props} />
}
```

Delete the old wizard:

```bash
git rm components/onboarding/onboarding-wizard.tsx
```

- [ ] **Step 4: Run the tests, then confirm that nothing imports the old path**

Run: `npx vitest run __tests__/app/onboarding-wizard-props.test.ts __tests__/app/onboarding-page.test.ts __tests__/components/onboarding-wizard`

Expected: PASS.

Run: `rg -n "components/onboarding/onboarding-wizard\"" app components lib __tests__`

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/onboarding/wizard-props.ts" "app/(dashboard)/onboarding/page.tsx" __tests__/app/onboarding-wizard-props.test.ts __tests__/app/onboarding-page.test.ts
git commit -m "feat(onboarding): feed the wizard from the server and drop the old one"
```

---

## Task 11: Definition of done

**Files:** none new. Fix only what these checks report, inside the files this plan touches.

**Interfaces:** none.

- [ ] **Step 1: Run every suite this PR touched**

Run: `npx vitest run __tests__/components/onboarding __tests__/components/ordenes-list __tests__/components/clientes-list __tests__/components/orden-detail __tests__/components/practica-orden-detail __tests__/components/currency-context __tests__/lib/terminologia __tests__/app/onboarding`

Expected: all PASS.

- [ ] **Step 2: Run the full suite**

Run: `npx vitest run`

Expected: PASS. A failure in a file this plan did not touch: check whether it also fails on `origin/main`. If it does, report it and do not fix it here.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 4: Lint the touched directories (never `npm run lint`)**

Run: `npx eslint components/onboarding components/ordenes components/clientes contexts lib/terminologia.ts "app/(dashboard)/onboarding" types __tests__/components __tests__/app __tests__/lib`

Expected: no errors. If `<img>` in `negocio-step.tsx` raises `@next/next/no-img-element` as an error, rather than the warning it was in the old wizard, add `{/* eslint-disable-next-line @next/next/no-img-element -- blob: preview URLs cannot go through next/image */}` right above it.

- [ ] **Step 5: Static checks for the global constraints**

```bash
rg -n "toLocale" components/onboarding components/ordenes/practica-orden-detail.tsx "app/(dashboard)/onboarding"
rg -n "from \"@/components/ui/select\"" components/onboarding
rg -n -i "es_practica|seed|pack|camino" components/onboarding/wizard --glob "!*.ts" --glob "!types.ts"
git log origin/main..HEAD --format=%B | rg -i "co-authored-by|generated with" -
```

Expected:
- The first two commands: no output.
- The third: hits only inside comments or identifiers, never inside a JSX string.
- The fourth: no output.

- [ ] **Step 6: Fresh-context review before any push or PR**

The orchestrator dispatches a fresh reviewer (judgment-day or code-review) over `git diff origin/main...HEAD`. It passes this plan and the spec, and gives the reviewer the UI-states table and the Review Focus list. Fix confirmed findings with a new commit each.

---

## Task 12: Manual pass on the Vercel preview (orchestrator step, needs the user)

**Files:** none. The orchestrator runs this with the user before merge.

- [ ] **Step 1: The orchestrator pushes the branch and opens the PR, then sends the user the preview URL and this checklist**

Use a fresh signup with a real inbox the user can read. Check each item:

1. **Feminine term, desktop.** Sign up with Relojería. `/onboarding` greets by first name, and the question reads "¿Tenés una pieza para cargar ahora?".
2. **Business step.** Save a name and a logo, go Atrás, then Siguiente. The name stays and the logo is not uploaded twice. Network tab: one `PUT /api/configuracion` with `logoData`.
3. **Rubro change.**
   - Change to "Otro servicio técnico" with "máquinas de café". The question then says "una máquina de café".
   - Open `/ordenes?nueva=1` later: the order form uses the new vocabulary without a reload.
4. **Practice: receive.**
   - Brand and problem chips fill the inputs.
   - The first email arrives in the inbox.
   - "Ver lo que ve tu cliente" opens `/seguimiento/…` in a new tab.
5. **Resume.** Close the tab after "Recibir" and open `/onboarding` again: the wizard lands on "Ahora, la reparación".
6. **Repair and deliver.**
   - Type "15.000". The second email arrives.
   - "Entregar": the third email arrives, and Listo shows.
7. **Listo.** "Cargar mi primera orden real" opens the order form once. Back button: no loop.
8. **Orders list (desktop and phone).**
   - The badge and "Borrar práctica" show.
   - Clicking it does not open the order.
   - The detail shows no cobro, state, print or remito actions.
   - The clients list shows the "Práctica" badge.
9. **First real order.** Creating it removes the practice from both lists (PR 1 behavior seen from the UI).
10. **Phone width (360 px, real device or DevTools).** No horizontal scroll, the primary CTA is on top and full width, and the chips are easy to tap. Dark mode reads well.
11. **Keyboard only.** Tab through every step. Focus lands on each new title. The rubro dialog traps focus, Escape closes it, and focus returns to "Cambiar".
12. **Sí path.** A second signup choosing "Sí, tengo uno" lands once on the order form.

- [ ] **Step 2: Record the result**

The orchestrator writes the outcome of each item to engram (topic `architecture/onboarding-wizard-ui`). Any failure becomes a fix task before merge.

---

## Self-review against the spec

| Spec requirement | Task |
|---|---|
| Wizard moves to `components/onboarding/wizard/`: shell, `negocio-step`, `pregunta-step`, `practica-step`, `listo-step`, rubro selector | 6, 7, 8, 9 |
| Page becomes the data source: name, logo, rubro, `rubro_detalle`, owner `nombre`/`email`, active tipos with `marcas` and `problemasComunes`, terminology, real-order count, practice | 10 |
| Bienvenida; "Omitir" on every step | 8 |
| Tu negocio: one `PUT /api/configuracion` (#443 kept, 10 tests ported) | 8 |
| "Tu rubro: X · Cambiar"; genérico asks for the trade text; disabled with a reason when there are real orders; 409 inline | 7, 8 |
| "¿Tenés un {equipo}…?" from the terminology | 8 (with gender agreement, Decision 2) |
| "Sí, tengo uno" → complete with `real`, navigate once; "Omitir" → `omitido` | 8 |
| Practice tracker Recibida → Reparada → Entregada | 6 |
| Recibir: tipo preselected; brand chips; problem chips with genérico fallback; client "Vos · {email}"; email notice; "Ver lo que ve tu cliente" in a new tab | 6 |
| Reparar: "¿Cuánto cobrarías?" > 0 | 6 |
| Entregar: "En la práctica no se cobra nada…" | 6 |
| Listo: primary, secondary, note | 9 |
| Resume at the practice sub-step | 4, 9 |
| Badge and "Borrar práctica" in the orders list and the detail; read-only detail | 1, 2 |
| Clients list badge | 3 |
| Sample-data button and "Primer cliente" step removed (routes kept) | 8 (test), 10 (delete) |
| Error handling: inline alert with Reintentar, Omitir still works; emails never surfaced | 6, 9 |
| Testing bullets for the wizard; existing suites updated | 6–10 |
| Manual pass with a real inbox before PR 3 merges | 12 |

The placeholder scan, the type-consistency check and the Review Focus check were all run while writing:

- Every Review Focus line has a test in its owning task.
- Names in later tasks match the Interfaces block.
- No step defers code to "similar to" another task.
