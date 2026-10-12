# Rubro-Aware Onboarding, PR 1: Server Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the server half of the practice order: the data model, the practice endpoint, automatic cleanup on the first real order, 409 guards on money and stock routes, activity filters, and the `esPractica` flag in list responses. Nothing is visible yet.

**Architecture:** A practice order is a real `ordenes_servicio` row flagged `es_practica`, owned by a practice `clientes` row flagged the same way. A narrow endpoint (`/api/onboarding/practica`) is the only writer of practice rows and never touches money tables. One SQL function, `borrar_datos_practica`, deletes practice data atomically and keeps the client whenever any foreign key still points at it. Every real-order insert path calls it after success. Money and stock routes reject practice ids with 409.

**Tech Stack:** Next.js route handlers, Supabase (PostgREST + plpgsql), zod v3, vitest with the repo's chain mocks (`__tests__/api/helpers.ts`).

**Spec:** `docs/superpowers/specs/2026-10-11-onboarding-multirubro-design.md`. This plan covers only "Delivery → 1. Server foundation". PR 2 (rubro change) and PR 3 (wizard UI) consume the Interfaces block below.

## Global Constraints

- **Strict TDD.** Every behavior gets a failing test first. Run it and watch it fail, write the minimal code, run it and watch it pass, then commit. SQL has no local runner, so the migration's autocheck block is its test, and its first run is the orchestrator's dry-run (Task 1).
- **Commits:** Conventional Commits in English, small work-unit commits, NO `Co-Authored-By` and no AI attribution lines.
- **Definition of done** for every task: the task's tests pass, `npx tsc --noEmit` is clean, and `npx eslint <the dirs you touched>` is clean. NEVER run `npm run lint`: it walks the worktrees and never finishes.
- **Test command:** `npx vitest run <file> [<file> ...]` (`package.json:11` defines `test:run` as `vitest run`). If the worktree has no `node_modules`, stop and ask the orchestrator: the healthy copy lives in another worktree and is linked with a junction, never reinstalled or deleted.
- **`rg` always gets an explicit path, or `-` in a pipe.** Never a bare `rg "pattern"`: the repo root holds `.env*` secrets. Never read `.env*` files.
- **Database:** implementers never run SQL. Dry-run and apply go through `node scripts/db-run.mjs <file>` from the main clone (`C:\Users\LUIS\Desktop\stapp`), dry-run by default, and only with the user's explicit OK. Those steps are marked **(orchestrator, with user approval)**. If `pg` is missing in the main clone, use `node .claude/worktrees/wa-destino/scripts/db-run.mjs <file>` from the same root.
- **Deploy order:** the migration is applied to production BEFORE PR 1 merges, and before the branch is pushed (previews share the production database). The new `.eq("es_practica", ...)` filters fail with 42703 until the column exists.
- **Migration number is provisional:** `346` here. The number is assigned at merge (repo convention). Before opening the PR, check the highest number across `main` and every open branch (`git ls-tree -r --name-only <branch> supabase/migrations/`). Renaming takes two regex passes over both files and this plan: `\b346\b` and `346_`.
- **New columns in SELECTs:** a column added to a SELECT with fallback cascades (like `/api/configuracion`) needs its own step in every cascade, and a mock that ignores the SELECT gives a false green. This plan adds no column to a cascade. Every test that depends on `es_practica` asserts the filter or select explicitly (`expect(chain.eq).toHaveBeenCalledWith("es_practica", false)`).
- **Timezones:** any `toLocale*` call passes `timeZone` (`lib/timezone.ts`). This plan adds none.
- **Language:** code, identifiers, comments, test names in new files and log messages are in English. SQL comments follow the migrations' Spanish (neutral). User-facing strings (`{ error }` bodies) are Spanish with voseo, as the product UI is.
- **Exact contract names** (Interfaces block below) are shared with PR 2 and PR 3. Do not rename them.
- **Practice row values:** order `numero_orden = 0` and `codigo_orden = 'PRACTICA'`. Client `telefono = ''`, `acepta_whatsapp = false`, `nombre = users.nombre`, `email = users.email`.
- **Public repo:** commit messages and PR text say what changed. They never describe a production weakness.

## Review Focus

1. **A practice delivery that charges cuenta corriente** or writes `cobros_orden`, a garantía or stock. Expected: practice delivery writes only the order row, one event and one notification. Pinned in Task 4 ("entregar never touches money, stock or warranties") and Task 7 (the `entregar` guard).
2. **A practice client reused for real work** (a real order, sale or quote for "Vos"), then wiped by a cascading delete. Expected: the client survives with `es_practica = false`, and its real order survives. Pinned in Task 1 autocheck (d) and Task 2 (`deletePracticeData` maps `clienteConservado`).
3. **A first real order created through a path other than `POST /api/ordenes`**, so the practice lingers next to real data. Expected: every real-order insert path deletes it. Pinned in Task 6 (one test per path, plus a source sweep that fails on any new insert path).
4. **A plan-limit trigger that still counts practice rows**, or a delete or flip that drifts the counter. Expected: practice rows never touch `organization_usage`, and a flipped client adds exactly 1. Pinned in Task 1 autocheck (a), (c) and (d).
5. **The REPARADO notification sent twice** by a double click on "reparar". Expected: exactly one email. Pinned in Task 4 ("reparar queues exactly one notification" and "a second reparar returns 409 and sends nothing").

Cross-org access is also pinned, in Task 2 (`rejectIfPractica` scopes by org) and Tasks 3 and 4 (every practice query asserts `organization_id` and `es_practica`).

---

## Verified Facts (the spec's "To verify at plan time")

### 1. `codigo_orden` → `'PRACTICA'`

`codigo_orden` is `TEXT`, nullable, with no unique constraint. Its only index is non-unique: `(organization_id, codigo_orden)` (`supabase/migrations/013_ordenes_codigo_orden.sql:6-10`). No code parses it: `rg -n "(codigoOrden|codigo_orden).{0,20}\.(match|replace|slice|split)" app lib components` returns nothing. List search treats it as free text (`app/api/ordenes/route.ts:225`). So the preferred value `PRACTICA` is safe, reads clearly in the list, and never collides with the counter format `{prefijo}{NNN}` (`lib/counters.ts:39-46`).

`numero_orden` is `INTEGER NOT NULL` with `UNIQUE(organization_id, numero_orden)` (`001_schema.sql:185,201`). That allows exactly one practice per org at `numero_orden = 0`.

### 2. Foreign keys and delete actions

From the repo's migrations. Task 1's dry-run also prints the live list from `pg_constraint`, so production drift shows up before apply.

**FKs to `clientes(id)`:**

| Table.column | ON DELETE | Source |
|---|---|---|
| `ordenes_servicio.cliente_id` | **CASCADE** | `001_schema.sql:186` |
| `notification_logs.cliente_id` | **CASCADE** | `001_schema.sql:469` |
| `sectores_cliente.cliente_id` | **CASCADE** | `051_clientes_empresa_sectores.sql:11` |
| `cuenta_corriente.cliente_id` | **CASCADE** | `066_cuenta_corriente_pagos_combinados.sql:9` |
| `recepciones.cliente_id` | **CASCADE** | `287_recepcion_multiple.sql:64` |
| `ventas.cliente_id` | SET NULL | `016_ventas_schema.sql:20` |
| `cotizaciones.cliente_id` | SET NULL | `052_cotizaciones_standalone.sql:5` |
| `user_notifications.cliente_id` | SET NULL | `056_user_notifications.sql:21` |
| `turnos.cliente_id` | SET NULL | `164_turnos.sql:18` |
| `inventario_series.cliente_id` | SET NULL | `175_lotes_series.sql:119` |

**FKs to `ordenes_servicio(id)`:**

| Table.column | ON DELETE | Source |
|---|---|---|
| `fotos_orden.orden_id` | CASCADE | `001_schema.sql:219` |
| `repuestos_orden.orden_id` | CASCADE | `001_schema.sql:265` |
| `facturas.orden_id` | CASCADE | `001_schema.sql:280` |
| `cotizaciones.orden_id` | CASCADE | `001_schema.sql:339` |
| `garantias.orden_id` | CASCADE | `001_schema.sql:380` |
| `checklist_recepcion.orden_id` | CASCADE | `001_schema.sql:442` |
| `orden_eventos.orden_id` | CASCADE | `040_enhanced_tracking.sql:8` |
| `cobros_orden.orden_id` | CASCADE | `067_cobros_orden_caja.sql:8` |
| `orden_tiempos_estado.orden_id` | CASCADE | `068_mejoras_ordenes.sql:12` |
| `cuotas_cobro.orden_id` | CASCADE | `068_mejoras_ordenes.sql:44` |
| `servicios_orden.orden_id` | CASCADE | `300_servicios.sql:80` |
| `notification_logs.orden_id` | SET NULL | `001_schema.sql:467` |
| `user_notifications.orden_id` | SET NULL | `056_user_notifications.sql:20` |
| `cotizaciones.convertida_a_orden_id` | SET NULL | `126_cotizaciones_tipo_presupuesto.sql:40-41` |
| `turnos.orden_id` | SET NULL | `164_turnos.sql:47` |
| `notas_credito.orden_id` | SET NULL | `186_notas_credito.sql:18` |
| `ordenes_servicio.orden_origen_id` | **NO ACTION** | `068_mejoras_ordenes.sql:74` |

**Design consequences:**

- Deleting a client cascades to its orders, cuenta corriente, recepciones and sectores. A naive "delete the practice client" could destroy real work. So the client check lives in SQL (`borrar_datos_practica`, Task 1). It reads every FK to `clientes` from `pg_constraint` at call time, so a future FK is covered without editing the function. It takes `FOR UPDATE` on the client row before checking. A concurrent insert that references the client needs `FOR KEY SHARE` and therefore waits, so the check cannot race a new reference. A composite FK counts as "referenced" (fail closed).
- `notification_logs` and `user_notifications` are excluded from the check. They are side effects of notifications, not use. The practice order's rows are deleted by `orden_id` first, because their FK is `SET NULL` and would otherwise survive with a dangling link. When the client itself is deleted, its remaining `user_notifications` rows go too, and `notification_logs` cascade. If the client is kept, its logs stay.
- `orden_origen_id` is `NO ACTION`: a reingreso created from the practice would block its deletion. The reingreso route gets the 409 guard (Task 7).

### 3. Guarded routes (Task 7)

Each handler calls `rejectIfPractica(ordenId, organizationId)` right after it knows the order id.

| Handler | File:line where the guard goes | Why |
|---|---|---|
| `PUT /api/ordenes/[id]` | `app/api/ordenes/[id]/route.ts:217` | state changes, `costo_final`, `presupuesto` |
| `POST /api/ordenes/[id]/entregar` | `app/api/ordenes/[id]/entregar/route.ts:40` | charges cuenta corriente (192-211), garantía, stock |
| `POST /api/ordenes/[id]/cobros` | `app/api/ordenes/[id]/cobros/route.ts:124` | cobros, cuotas, cuenta corriente |
| `POST /api/ordenes/[id]/repuestos` | `app/api/ordenes/[id]/repuestos/route.ts:47` | parts, `add_repuesto_inventario` decrements stock |
| `POST /api/ordenes/[id]/servicios` | `app/api/ordenes/[id]/servicios/route.ts:40` | priced lines, syncs `costo_final` |
| `PATCH /api/ordenes/[id]/servicios` | `app/api/ordenes/[id]/servicios/route.ts:195` | writes the order's amount |
| `POST /api/ordenes/[id]/reingreso` | `app/api/ordenes/[id]/reingreso/route.ts:28` | creates a real order pointing at the practice (NO ACTION FK) |
| `POST /api/cotizaciones` (with `ordenId`) | `app/api/cotizaciones/route.ts:334` | quote from the order; its approval reserves stock |
| `POST /api/facturacion/generar` (with `ordenId`) | `app/api/facturacion/generar/route.ts:52` | factura from the order |
| `POST /api/garantias` | `app/api/garantias/route.ts:116` | warranty for the order |

**Deliberately not guarded:**

- Seña: written only at order creation (`app/api/ordenes/route.ts:474-484`), which the practice never goes through.
- Cobro annulment (`DELETE .../cobros`), `PUT .../cuotas`, `PATCH`/`DELETE .../repuestos`, `DELETE .../servicios`: they act on rows that cannot exist once their creating route is guarded.
- `POST /api/pagos` and the ARCA routes: they take a factura id, and no factura can exist.
- `DELETE /api/ordenes/[id]`: ADMIN-only hard delete, allowed. An orphaned practice client is removed by the next `borrar_datos_practica` call.

### 4. Token expiry

`POST /api/ordenes` never sets `public_token_expires_at` on create (`app/api/ordenes/route.ts:389-428`). It stays NULL, and `lib/public-token.ts:89-96` treats NULL as "never expires". The only writer is the state trigger on delivery (`142_fix_trigger_duracion_minutos_generated.sql:20-22`). The practice order matches the create route: it does not set the column. (Side finding, out of scope: the trigger is `AFTER UPDATE` (`068_mejoras_ordenes.sql:168-171`), so the `NEW.public_token_expires_at :=` assignment it has used since migration 140 has no effect.)

### 5. Notification context

`queueNotification` takes the params typed in `lib/notifications/queue.ts:10-61`. The create route builds `{ organizationName, organizationSlug, moneda, zonaHoraria, cliente: { id, nombre, email, telefono }, orden: { id, numeroOrden, dispositivo, estado, estadoAnterior, publicToken } }` (`app/api/ordenes/route.ts:573-599`). The practice endpoint builds the same shape, with `numeroOrden: 0` and `telefono: ""` hardcoded.

`lib/notifications/send-direct.ts` then:

- emails when `organizations.notificaciones_email` is on (default `TRUE`, `001_schema.sql:111`) and the client has an email (88);
- attempts WhatsApp only when `context.cliente.telefono` is truthy and the client `acepta_whatsapp` (145-155);
- creates the in-app `user_notifications` rows (247-278).

The email subject will read "Orden #0 - Estado actualizado" (`send-direct.ts:366`). This is accepted for a demo sent to the owner's own inbox.

### 6. Every real-order insert path

Sweep: `rg -n -U "from\(\s*\"ordenes_servicio\"\s*\)\s*\.insert" app lib --glob '!**/*.test.*'` plus the RPC inserts in `supabase/migrations`.

| Path | Insert | Real? |
|---|---|---|
| `POST /api/ordenes` | `app/api/ordenes/route.ts:389` | yes |
| `POST /api/recepciones` (RPC `crear_recepcion_multiple`) | `app/api/recepciones/route.ts:111`, SQL `288_crear_recepcion_multiple.sql:100` | yes |
| `POST /api/cotizaciones/[id]/convertir-orden` | `app/api/cotizaciones/[id]/convertir-orden/route.ts:154` | yes |
| `POST /api/ordenes/[id]/reingreso` | `app/api/ordenes/[id]/reingreso/route.ts:76` | yes |
| `PUT /api/garantias/[id]/reclamos` (`crearOrden`) | `app/api/garantias/[id]/reclamos/route.ts:146` | yes |
| `POST /api/onboarding/seed-demo-data` | `app/api/onboarding/seed-demo-data/route.ts:211` | no, demo data |
| `lib/onboarding/sample-data.ts` | `lib/onboarding/sample-data.ts:168` | no, sample data |
| `POST /api/onboarding/practica` (new) | Task 3 | no, the practice itself |

`/api/v1/ordenes` is read-only (`app/api/v1/ordenes/route.ts`), and import only handles CLIENTES and INVENTARIO (`app/api/import/execute/route.ts:16`).

Five real paths is more than four, hence **Decision needed #1** below. (Side finding, out of scope: the reclamos insert sends no `sucursal_id`, but `ordenes_servicio.sucursal_id` has been NOT NULL since `207_sucursales_set_not_null.sql:25`, so that path likely fails in production today. It is hooked anyway, so the sweep stays honest.)

### 7. Migration number and file conventions

The highest file on this branch is `345_factura_pago_sincroniza_orden.sql`. 341 is reserved by `feat/orden-ingreso-trabajo-garantia` and 342-344 by the notas de crédito plan (`345_factura_pago_sincroniza_orden.sql:4-6`). The next free number is **346, provisional**.

- Files: `supabase/migrations/346_orden_practica_onboarding.sql` and `supabase/migrations/rollback/346_rollback.sql` (pattern `rollback/NNN_rollback.sql`, e.g. `rollback/345_rollback.sql`).
- No `BEGIN`/`COMMIT` in the migration: `scripts/db-run.mjs:70` treats a `BEGIN;` in the first 40 lines as "the file owns its transaction".
- The repo's post-apply probes live in `supabase/migrations/verify/NNN_probes.sql`. Here the spec requires the trigger check during the dry-run, so the checks live inside the migration as a self-reverting autocheck block. Pattern: `verify/337_probes.sql:252-271`.

### 8. Test conventions

- Global mocks for `@/lib/supabase`, `@/lib/auth` and `next/headers` are in `vitest.setup.ts:36-88`.
- Route tests use `mockAuthSuccess`, `createChainMock`, `mockSupabaseFrom` and `parseResponse` from `__tests__/api/helpers.ts`. `createChainMock` returns one chain for every method; `.single()` and `await` resolve `{ data, error, count }`. To record payloads, tests replace a method with a spy that returns the chain (`__tests__/api/ordenes.test.ts:237-241`).
- Lib tests live in `lib/__tests__/`; cross-cutting tests in `__tests__/lib/`.

### 9. Other facts that shaped the design

- `clientes.telefono` is `TEXT NOT NULL` with `UNIQUE(organization_id, telefono)` (`001_schema.sql:161,169`). The spec's "no phone" is therefore `telefono = ''`, which every WhatsApp path skips (`send-direct.ts:155`), plus `acepta_whatsapp = false`. Consequence: an org with a real client whose phone is `''` cannot get a practice client (23505). The dry-run prints that count (expected 0), and the endpoint answers 409.
- `v_clientes_resumen` froze its `c.*` expansion (`294_precios_mayoristas_clientes.sql:42-53`). The clientes list reads it (`app/api/clientes/route.ts:71`), so the view must be dropped and recreated for `es_practica` to reach the list.
- The clientes trigger also decrements on DELETE (`167_atomic_plan_limit_enforcement.sql:124-128`). Practice deletes must skip the decrement, or the counter drifts down.
- The `onboarding_progress` row is created by signup, best-effort (`app/api/auth/register/route.ts:287-292`), and by `GET /api/onboarding/progress` when missing (`app/api/onboarding/progress/route.ts:16-24`). The current wizard calls that GET on mount; the PR 3 wizard does not. Today's `/complete` does a plain UPDATE (`app/api/onboarding/complete/route.ts:16-19`), which matches 0 rows when the row is missing. So every write in this plan upserts by `organization_id` (`UNIQUE`, `039_onboarding.sql:13`). The `camino` writes go through `registrar_camino_onboarding`, and `practica_completada_at` through a supabase-js upsert.
- `DROP VIEW` drops the view's grants, and `CREATE VIEW` applies the schema's default privileges, which may differ. The migration snapshots `pg_class.relacl` before the drop, restores it exactly after the create, and the autocheck compares the two.

---

## Decision Needed

### #1: Where the automatic deletion lives (5 insert paths)

The spec hooks deletion into `POST /api/ordenes` only. There are five real insert paths (Verified Facts §6). This plan follows the spec's mechanism and extends it to all five (Task 6). The alternative is an `AFTER INSERT` trigger on `ordenes_servicio`.

| | Per-path call (planned) | `AFTER INSERT ... WHEN (NOT NEW.es_practica)` trigger |
|---|---|---|
| Coverage | 5 call sites. A source-sweep test fails the build when a new insert path appears without the call. | Every path, including RPCs and future ones, automatically. |
| Failure isolation | The call runs after the insert commits. A failure is logged to Vercel and the order is untouched. | Runs inside the real order's transaction. A SQL bug rolls back the real order unless every error is swallowed in plpgsql, where it reaches only Supabase logs. |
| Locks | None on the hot path. | Every real insert pays a lookup on the partial index. The first one also locks the practice client row inside the order's transaction. |
| Testability | vitest per path, plus the sweep. | The migration autocheck only. Invisible from the TypeScript side. |
| Spec | Matches ("after the INSERT succeeds, the route calls..."; "A failure is logged and swallowed"). | Changes the mechanism. Needs your OK. |

**Recommendation:** keep the per-path calls plus the sweep test for PR 1. Revisit the trigger only if a new insert path slips past the sweep.

### #2: PR 1 size

Estimate: ~2,450 changed lines. About 560 are SQL (with comments, the grant restore and the autocheck), about 650 app code and about 1,250 tests. That is far over the 400-line budget. Options:

- **Keep one PR with `size:exception`.** Simplest. Nothing calls the new code until PR 3.
- **Split into 1a (Tasks 1-5) and 1b (Tasks 6-9).** 1a carries the migration, helpers, practice endpoint and `/complete` (~1,550 lines). 1b carries hooks, guards, filters and flags (~620 lines). The split is safe: until PR 3, nothing creates a practice, so nothing has to be guarded or cleaned up yet.

---

## File Map

| File | Change | Task |
|---|---|---|
| `supabase/migrations/346_orden_practica_onboarding.sql` | create | 1 |
| `supabase/migrations/rollback/346_rollback.sql` | create | 1 |
| `lib/onboarding/practica-shared.ts` | create (pure, client-safe) | 2 |
| `lib/onboarding/practica.ts` | create (server) | 2 |
| `vitest.setup.ts` | modify: default mocks for two helpers | 2 |
| `lib/__tests__/onboarding-practica-shared.test.ts` | create | 2 |
| `lib/__tests__/onboarding-practica.test.ts` | create | 2 |
| `app/api/onboarding/practica/route.ts` | create (GET/POST/DELETE in 3, PATCH in 4) | 3, 4 |
| `__tests__/api/onboarding-practica.test.ts` | create | 3 |
| `__tests__/api/onboarding-practica-avance.test.ts` | create | 4 |
| `app/api/onboarding/complete/route.ts` | modify | 5 |
| `__tests__/api/onboarding-complete.test.ts` | create | 5 |
| `app/api/ordenes/route.ts`, `app/api/recepciones/route.ts`, `app/api/cotizaciones/[id]/convertir-orden/route.ts`, `app/api/ordenes/[id]/reingreso/route.ts`, `app/api/garantias/[id]/reclamos/route.ts` | modify: deletion hook | 6 |
| `__tests__/api/ordenes.test.ts`, `__tests__/api/recepcion-multiple-atomica.test.ts`, `__tests__/api/cotizaciones-convertir-orden.test.ts`, `__tests__/api/reingreso.test.ts` | modify | 6 |
| `__tests__/api/garantias-reclamos-practica.test.ts`, `__tests__/lib/practica-borrado-sweep.test.ts` | create | 6 |
| the 9 route files of Verified Facts §3 | modify: guard | 7 |
| `__tests__/api/practica-guards.test.ts` | create | 7 |
| `app/(dashboard)/dashboard/page.tsx`, `app/api/onboarding/status/route.ts`, 5 superadmin routes, 7 crons | modify: filters | 8 |
| `__tests__/api/onboarding-status.test.ts` | create | 8 |
| `__tests__/api/cron-recordatorios.test.ts`, `__tests__/api/superadmin-organization-detail.test.ts` | modify | 8 |
| `lib/db-utils.ts` | modify: `esPractica` in `formatOrden` and `formatCliente` | 9 |
| `lib/__tests__/db-utils.test.ts`, `__tests__/api/clientes.test.ts`, `__tests__/api/ordenes.test.ts` | modify | 9 |

## Interfaces (shared with PR 2 and PR 3)

```
DB — migration 346 (number provisional)
- ordenes_servicio.es_practica boolean NOT NULL DEFAULT false
    partial index ordenes_servicio_practica_idx ON (organization_id) WHERE es_practica
- clientes.es_practica boolean NOT NULL DEFAULT false
    partial index clientes_practica_idx ON (organization_id) WHERE es_practica
- onboarding_progress.camino text NULL, constraint onboarding_progress_camino_check
    CHECK (camino IN ('real','practica','omitido'))
- onboarding_progress.practica_completada_at timestamptz NULL
- update_ordenes_count skips es_practica inserts
- update_clientes_count skips es_practica inserts and deletes, adds 1 on a true->false flip
    (trigger_clientes_count is now AFTER INSERT OR DELETE OR UPDATE OF es_practica)
- v_clientes_resumen recreated so c.* includes es_practica; definition of 294:55-85 otherwise
    unchanged, grants restored exactly (snapshot of relacl before DROP); the rollback restores
    the 294 definition the same way
- RPC borrar_datos_practica(p_org_id text) RETURNS jsonb {orden_borrada boolean, cliente_conservado boolean}
    service_role only
- RPC registrar_camino_onboarding(p_org_id text, p_camino text) RETURNS text (the stored camino)
    service_role only; one upsert by organization_id: creates the onboarding_progress row when
    missing; 'practica' is always stored; nothing overwrites 'practica'; 'omitido' only fills an
    empty camino; 'real' overwrites an empty camino or 'omitido'
- practice order: numero_orden = 0, codigo_orden = 'PRACTICA', estado starts RECIBIDO,
  public_token = randomBytes(16).hex, public_token_expires_at not set (same as POST /api/ordenes)
- practice client: telefono = '', acepta_whatsapp = false, nombre = users.nombre, email = users.email

lib/onboarding/practica-shared.ts (PURE, client-safe, no supabase import) — exactly the contract:
  export const PRACTICA_NUMERO_ORDEN = 0
  export type PracticaEstado = "RECIBIDO" | "REPARADO" | "ENTREGADO_SIN_COBRO"
  export interface PracticaOrden { id: string; estado: PracticaEstado; publicToken: string;
    tipoDispositivo: string; dispositivo: string; problemaReportado: string; costoFinal: number | null }
  export const PRACTICA_PROBLEMAS_GENERICOS = ["No enciende", "Funciona con fallas", "Hace ruido", "Mantenimiento"] as const
  export const ORDEN_PRACTICA_ERROR = { error: "Es una orden de práctica", code: "ORDEN_PRACTICA" } as const

lib/onboarding/practica.ts (server-only)
  contract:
  export async function getPracticaOrden(organizationId: string, client = supabaseAdmin): Promise<PracticaOrden | null>
      // throws on DB error
  export async function deletePracticeData(organizationId: string, client = supabaseAdmin):
      Promise<{ ordenBorrada: boolean; clienteConservado: boolean }>   // throws on DB error; callers decide
  export async function rejectIfPractica(ordenId: string, organizationId: string, client = supabaseAdmin):
      Promise<NextResponse | null>   // 409 + ORDEN_PRACTICA_ERROR when es_practica; fails open on DB error
  additive (PR 2 may use countRealOrders for its 409; PR 3 for the page's real-order count):
  export async function countRealOrders(organizationId: string, client = supabaseAdmin): Promise<number>
      // throws on DB error
  export const PRACTICA_CODIGO_ORDEN = "PRACTICA"
  export const PRACTICA_ORDEN_SELECT: string
  export interface PracticaOrdenRow { ...raw row incl. clientes embed }
  export function toPracticaOrden(row: PracticaOrdenRow): PracticaOrden
      // EN_REPARACION (a half-done "reparar") maps to "RECIBIDO"

HTTP (all requireAdmin; errors are { error: string })
  GET    /api/onboarding/practica -> 200 { practica: PracticaOrden | null }
  POST   /api/onboarding/practica  body { tipoDispositivo, dispositivo, problemaReportado } -> 201 { practica }
         400 invalid body or a tipo that is not an active tipos_dispositivo.codigo of the org
         409 when the org already has real orders
         409 when a concurrent submit holds the slot and no practice can be returned
         a concurrent double submit returns the winning practice with 201
  PATCH  /api/onboarding/practica  body { accion: "reparar", costoFinal: number > 0 } | { accion: "entregar" }
         -> 200 { practica }; 400 invalid body; 404 none; 409 wrong state or lost race
  DELETE /api/onboarding/practica -> 200 { ok: true }
  POST   /api/onboarding/complete  optional body { camino?: "real" | "omitido" }; 400 for anything else
         camino written through registrar_camino_onboarding (creates the row when missing);
         "omitido" only fills an empty camino; nothing sent here ever overwrites "practica"
  The practice POST writes camino = 'practica' through the same function (creates the row when
  missing). Neither write depends on GET /api/onboarding/progress having run.
  The practice entregar upserts practica_completada_at by organization_id (creates the row too).

Response casing for the practice flag: camelCase `esPractica` (rows are mapped), always a boolean.
  - GET /api/ordenes            -> data[i].esPractica      formatOrden (lib/db-utils.ts:64), route.ts:268
  - GET /api/ordenes/[id]       -> esPractica (top level)  formatOrden, [id]/route.ts:158 and 186-187
  - PUT /api/ordenes/[id]       -> esPractica              formatOrden, [id]/route.ts:572
  - GET /api/clientes           -> data[i].esPractica      formatCliente (lib/db-utils.ts:169), route.ts:94-99
  - embedded order client       -> cliente.esPractica      formatCliente via formatOrden (db-utils.ts:133)
```

---

### Task 1: Migration 346 and its rollback

**Files:**
- Create: `supabase/migrations/346_orden_practica_onboarding.sql`
- Create: `supabase/migrations/rollback/346_rollback.sql`

**Interfaces:**
- Consumes: `get_plan_limit` (`167_atomic_plan_limit_enforcement.sql:22-58`), the trigger bodies of 167, and the view body of `294_precios_mayoristas_clientes.sql:55-85`.
- Produces: everything in the DB section of the Interfaces block. Tasks 2-9 depend on the column names. They do not need the migration applied to run their tests.

- [ ] **Step 1: Write the migration, including its autocheck (the test)**

The autocheck (block 5) creates a synthetic org and verifies Review Focus #2 and #4 inside a sub-block that is always rolled back. If any check fails, it raises and the whole migration aborts, in dry-run and in apply. Create `supabase/migrations/346_orden_practica_onboarding.sql`:

```sql
-- ============================================================================
-- 346: orden de práctica del onboarding (es_practica) y camino del wizard
-- ============================================================================
-- NUMERO: provisorio, se asigna al mergear. 345 es la última aplicada; 341 la
-- reserva feat/orden-ingreso-trabajo-garantia y 342-344 el plan de notas de
-- crédito. Antes del merge: máximo global entre main y las branches abiertas.
--
-- ORDEN DE DESPLIEGUE: aplicar ANTES de mergear el PR 1 (y antes de pushear la
-- branch: los previews usan esta base). El código filtra por es_practica; sin la
-- columna esas queries fallan con 42703.
-- Un archivo por vez: node scripts/db-run.mjs supabase/migrations/346_...sql
-- (dry-run por defecto, --apply para confirmar). Sin transacción propia a
-- propósito: el runner abre y cierra la suya.
--
-- QUÉ HACE
--   1. es_practica en ordenes_servicio y clientes (+ índices parciales), y
--      camino / practica_completada_at en onboarding_progress.
--   2. Los triggers de cupo (167) no cuentan filas de práctica. El cupo nunca
--      se devuelve al borrar una orden, así que saltear en el alta es la única
--      corrección posible. Un cliente de práctica que pasa a real suma 1.
--   3. v_clientes_resumen se recrea para que exponga es_practica (c.* quedó
--      congelado en 294). Misma definición y mismos permisos que tenía.
--   4. borrar_datos_practica(org) borra la práctica de la org. El cliente se
--      borra solo si ninguna FK hacia clientes lo referencia (salvo los logs de
--      notificaciones); si no, se conserva y pasa a real.
--   4b. registrar_camino_onboarding(org, camino): upsert atómico de
--      onboarding_progress.camino. Crea la fila si falta (el wizard nuevo ya no
--      llama a GET /api/onboarding/progress, que era quien la creaba), nunca
--      pisa un camino con 'omitido' y nada pisa 'practica'.
--   5. Autocheck sobre una org sintética, dentro de un sub-bloque que siempre se
--      revierte. Si algo falla, aborta la migración entera.
--   6. Dos SELECT de solo lectura para comparar con el plan.
--
-- POR QUÉ EL CHEQUEO DE REFERENCIAS ES DINÁMICO
--   ordenes_servicio.cliente_id, cuenta_corriente, recepciones,
--   sectores_cliente y notification_logs apuntan a clientes con ON DELETE
--   CASCADE: borrar un cliente referenciado borraría trabajo real. La función
--   lee las FKs de pg_constraint en cada llamada (una FK nueva queda cubierta
--   sin tocarla) y toma FOR UPDATE sobre el cliente antes de mirar, así un
--   INSERT concurrente que lo referencie (FOR KEY SHARE) espera.
--
-- VERIFICACIÓN POSTERIOR (después de --apply):
--   SELECT es_practica FROM v_clientes_resumen LIMIT 1;  -- corre sin error
--   SELECT pg_get_triggerdef(oid) FROM pg_trigger
--    WHERE tgname = 'trigger_clientes_count';             -- incluye UPDATE OF es_practica
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Columnas e índices
-- ----------------------------------------------------------------------------
ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS es_practica BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE clientes         ADD COLUMN IF NOT EXISTS es_practica BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS ordenes_servicio_practica_idx
  ON ordenes_servicio (organization_id) WHERE es_practica;
CREATE INDEX IF NOT EXISTS clientes_practica_idx
  ON clientes (organization_id) WHERE es_practica;

ALTER TABLE onboarding_progress ADD COLUMN IF NOT EXISTS camino TEXT;
ALTER TABLE onboarding_progress DROP CONSTRAINT IF EXISTS onboarding_progress_camino_check;
ALTER TABLE onboarding_progress ADD CONSTRAINT onboarding_progress_camino_check
  CHECK (camino IN ('real', 'practica', 'omitido'));
ALTER TABLE onboarding_progress ADD COLUMN IF NOT EXISTS practica_completada_at TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- 2. Triggers de cupo: cuerpos de 167:67-100 y 167:106-131 con el salto
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_ordenes_count()
RETURNS TRIGGER AS $$
DECLARE
  v_new_count INTEGER;
  v_limit INTEGER;
BEGIN
  -- La orden de práctica no usa cupo del plan.
  IF TG_OP = 'INSERT' AND NOT NEW.es_practica THEN
    INSERT INTO organization_usage (organization_id, ordenes_count, ordenes_mes_actual, periodo_inicio)
    VALUES (NEW.organization_id, 1, 1, DATE_TRUNC('month', NOW()))
    ON CONFLICT (organization_id)
    DO UPDATE SET
      ordenes_count = organization_usage.ordenes_count + 1,
      ordenes_mes_actual = CASE
        WHEN organization_usage.periodo_inicio < DATE_TRUNC('month', NOW())
        THEN 1
        ELSE organization_usage.ordenes_mes_actual + 1
      END,
      periodo_inicio = CASE
        WHEN organization_usage.periodo_inicio < DATE_TRUNC('month', NOW())
        THEN DATE_TRUNC('month', NOW())
        ELSE organization_usage.periodo_inicio
      END
    RETURNING ordenes_mes_actual INTO v_new_count;

    v_limit := get_plan_limit(NEW.organization_id, 'ordenes');

    IF v_limit IS NOT NULL AND v_new_count > v_limit THEN
      RAISE EXCEPTION 'PLAN_LIMIT_EXCEEDED:ordenes:%:%', v_new_count, v_limit
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_clientes_count()
RETURNS TRIGGER AS $$
DECLARE
  v_new_count INTEGER;
  v_limit INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- El cliente de práctica no usa cupo del plan.
    IF NOT NEW.es_practica THEN
      INSERT INTO organization_usage (organization_id, clientes_count)
      VALUES (NEW.organization_id, 1)
      ON CONFLICT (organization_id)
      DO UPDATE SET clientes_count = organization_usage.clientes_count + 1
      RETURNING clientes_count INTO v_new_count;

      v_limit := get_plan_limit(NEW.organization_id, 'clientes');
      IF v_limit IS NOT NULL AND v_new_count > v_limit THEN
        RAISE EXCEPTION 'PLAN_LIMIT_EXCEEDED:clientes:%:%', v_new_count, v_limit
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    -- Si nunca se contó, no se descuenta.
    IF NOT OLD.es_practica THEN
      UPDATE organization_usage
      SET clientes_count = GREATEST(0, clientes_count - 1)
      WHERE organization_id = OLD.organization_id;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.es_practica AND NOT NEW.es_practica THEN
      -- La práctica se usó para trabajo real y pasa a contar. Sin chequeo de
      -- límite: el cliente ya existe, y fallar acá haría fallar para siempre el
      -- borrado de la práctica.
      INSERT INTO organization_usage (organization_id, clientes_count)
      VALUES (NEW.organization_id, 1)
      ON CONFLICT (organization_id)
      DO UPDATE SET clientes_count = organization_usage.clientes_count + 1;
    ELSIF NOT OLD.es_practica AND NEW.es_practica THEN
      UPDATE organization_usage
      SET clientes_count = GREATEST(0, clientes_count - 1)
      WHERE organization_id = NEW.organization_id;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- 006:367 lo creó AFTER INSERT OR DELETE; se agrega UPDATE OF es_practica.
DROP TRIGGER IF EXISTS trigger_clientes_count ON clientes;
CREATE TRIGGER trigger_clientes_count
  AFTER INSERT OR DELETE OR UPDATE OF es_practica ON clientes
  FOR EACH ROW EXECUTE FUNCTION update_clientes_count();

-- ----------------------------------------------------------------------------
-- 3. v_clientes_resumen
-- ----------------------------------------------------------------------------
-- c.* se expandió al crear la vista (294:42-53): la columna nueva solo aparece
-- recreándola, y CREATE OR REPLACE falla porque es_practica cae antes de
-- ordenes_count. Recreación textual de 294:55-85, sin cambiar nada más. La
-- lista de clientes lee esta vista (app/api/clientes/route.ts:71,83).
-- Sin CASCADE a propósito: un dependiente inesperado tiene que fallar
-- ruidosamente.
--
-- PERMISOS: DROP VIEW se lleva los GRANT y CREATE VIEW aplica los default
-- privileges del esquema, que pueden no coincidir con los que tenía. Se guarda
-- el ACL antes del DROP y se restaura exacto después del CREATE. El autocheck
-- (f) compara los dos.
CREATE TEMP TABLE _acl_v_clientes_resumen_346 ON COMMIT DROP AS
  SELECT relacl FROM pg_class WHERE oid = 'public.v_clientes_resumen'::regclass;

DROP VIEW IF EXISTS v_clientes_resumen;
CREATE VIEW v_clientes_resumen AS
SELECT
  c.*,
  COALESCE(agg.ordenes_count, 0)   AS ordenes_count,
  agg.ultima_visita                AS ultima_visita,
  COALESCE(agg.deuda_pendiente, 0) AS deuda_pendiente,
  sec.sectores_texto               AS sectores_texto
FROM clientes c
LEFT JOIN (
  SELECT
    cliente_id,
    COUNT(*)            AS ordenes_count,
    MAX(fecha_ingreso)  AS ultima_visita,
    SUM(
      CASE WHEN estado_cobro IN ('PENDIENTE','PARCIAL')
                AND estado IN ('REPARADO','ENTREGADO')
        THEN GREATEST(
          COALESCE(costo_final, 0)
          - COALESCE(descuento_cobro, 0)
          - COALESCE(total_cobrado, 0), 0)
        ELSE 0 END
    ) AS deuda_pendiente
  FROM ordenes_servicio
  GROUP BY cliente_id
) agg ON agg.cliente_id = c.id
LEFT JOIN (
  SELECT cliente_id, string_agg(nombre, ' ') AS sectores_texto
  FROM sectores_cliente
  WHERE activo = true
  GROUP BY cliente_id
) sec ON sec.cliente_id = c.id;

DO $$
DECLARE
  r RECORD;
  v_owner OID;
BEGIN
  SELECT relowner INTO v_owner FROM pg_class WHERE oid = 'public.v_clientes_resumen'::regclass;

  -- 1. Sacar lo que pusieron los default privileges al crear la vista.
  FOR r IN
    SELECT DISTINCT a.grantee
      FROM pg_class c, aclexplode(c.relacl) a
     WHERE c.oid = 'public.v_clientes_resumen'::regclass AND a.grantee <> v_owner
  LOOP
    EXECUTE format('REVOKE ALL ON public.v_clientes_resumen FROM %s',
      CASE WHEN r.grantee = 0 THEN 'PUBLIC'
           ELSE (SELECT quote_ident(rolname) FROM pg_roles WHERE oid = r.grantee) END);
  END LOOP;

  -- 2. Volver a dar exactamente lo que tenía (un ACL NULL no devuelve filas:
  --    queda solo el dueño, igual que antes).
  FOR r IN
    SELECT a.grantee, a.privilege_type, a.is_grantable
      FROM _acl_v_clientes_resumen_346 t, aclexplode(t.relacl) a
     WHERE a.grantee <> v_owner
  LOOP
    EXECUTE format('GRANT %s ON public.v_clientes_resumen TO %s%s',
      r.privilege_type,
      CASE WHEN r.grantee = 0 THEN 'PUBLIC'
           ELSE (SELECT quote_ident(rolname) FROM pg_roles WHERE oid = r.grantee) END,
      CASE WHEN r.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 4. borrar_datos_practica
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION borrar_datos_practica(p_org_id TEXT)
RETURNS JSONB AS $$
DECLARE
  v_orden_id TEXT;
  v_cliente_id TEXT;
  v_fk RECORD;
  v_referenciado BOOLEAN;
  v_orden_borrada BOOLEAN := FALSE;
  v_cliente_conservado BOOLEAN := FALSE;
BEGIN
  -- Camino rápido: la gran mayoría de las órdenes reales llegan acá sin
  -- práctica. Los dos índices parciales hacen esto casi gratis.
  IF NOT EXISTS (SELECT 1 FROM ordenes_servicio WHERE organization_id = p_org_id AND es_practica)
     AND NOT EXISTS (SELECT 1 FROM clientes WHERE organization_id = p_org_id AND es_practica) THEN
    RETURN jsonb_build_object('orden_borrada', FALSE, 'cliente_conservado', FALSE);
  END IF;

  -- La orden. Sus notificaciones tienen FK SET NULL: se borran antes, si no la
  -- campanita queda con un link a una orden que ya no existe. El resto cascadea.
  FOR v_orden_id IN
    SELECT id FROM ordenes_servicio
     WHERE organization_id = p_org_id AND es_practica
       FOR UPDATE
  LOOP
    DELETE FROM user_notifications WHERE orden_id = v_orden_id;
    DELETE FROM notification_logs WHERE orden_id = v_orden_id;
    DELETE FROM ordenes_servicio WHERE id = v_orden_id;
    v_orden_borrada := TRUE;
  END LOOP;

  -- El cliente, incluido uno huérfano (orden borrada a mano desde el listado).
  FOR v_cliente_id IN
    SELECT id FROM clientes
     WHERE organization_id = p_org_id AND es_practica
       FOR UPDATE
  LOOP
    v_referenciado := FALSE;
    FOR v_fk IN
      SELECT c.conrelid::regclass AS tabla, c.conkey, a.attname AS columna
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
       WHERE c.contype = 'f'
         AND c.confrelid = 'public.clientes'::regclass
         -- Los logs de notificaciones no son uso: son efecto de avisar.
         AND c.conrelid NOT IN ('public.notification_logs'::regclass,
                                'public.user_notifications'::regclass)
    LOOP
      IF array_length(v_fk.conkey, 1) <> 1 THEN
        -- FK compuesta: no se sabe chequear, así que se conserva el cliente.
        v_referenciado := TRUE;
      ELSE
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)', v_fk.tabla, v_fk.columna)
          INTO v_referenciado
          USING v_cliente_id;
      END IF;
      EXIT WHEN v_referenciado;
    END LOOP;

    IF v_referenciado THEN
      -- El dueño lo usó para trabajo real: pasa a ser un cliente real.
      UPDATE clientes SET es_practica = FALSE WHERE id = v_cliente_id;
      v_cliente_conservado := TRUE;
    ELSE
      DELETE FROM user_notifications WHERE cliente_id = v_cliente_id;
      DELETE FROM clientes WHERE id = v_cliente_id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('orden_borrada', v_orden_borrada,
                            'cliente_conservado', v_cliente_conservado);
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

COMMENT ON FUNCTION borrar_datos_practica(TEXT) IS
  'Borra la orden de práctica del onboarding y su cliente si nada real lo referencia. Ver migración 346.';

REVOKE EXECUTE ON FUNCTION borrar_datos_practica(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION borrar_datos_practica(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION borrar_datos_practica(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION borrar_datos_practica(TEXT) TO service_role;

-- ----------------------------------------------------------------------------
-- 4b. registrar_camino_onboarding
-- ----------------------------------------------------------------------------
-- Una sola sentencia: crea la fila si falta y decide el pisado en el mismo
-- ON CONFLICT, así dos requests concurrentes no se pisan. Reglas:
--   - 'practica' siempre se guarda: es el camino más informativo.
--   - nada pisa una 'practica' ya registrada.
--   - 'omitido' solo completa un camino vacío.
--   - 'real' pisa un camino vacío u 'omitido'.
-- onboarding_progress.organization_id es UNIQUE (039:13).
CREATE OR REPLACE FUNCTION registrar_camino_onboarding(p_org_id TEXT, p_camino TEXT)
RETURNS TEXT AS $$
  INSERT INTO onboarding_progress (organization_id, camino)
  VALUES (p_org_id, p_camino)
  ON CONFLICT (organization_id) DO UPDATE
    SET camino = CASE
      WHEN EXCLUDED.camino = 'practica' THEN 'practica'
      WHEN onboarding_progress.camino = 'practica' THEN 'practica'
      WHEN EXCLUDED.camino = 'omitido' THEN COALESCE(onboarding_progress.camino, 'omitido')
      ELSE EXCLUDED.camino
    END
  RETURNING camino;
$$ LANGUAGE sql SET search_path = public, pg_temp;

COMMENT ON FUNCTION registrar_camino_onboarding(TEXT, TEXT) IS
  'Upsert de onboarding_progress.camino: crea la fila si falta, omitido nunca pisa, nada pisa practica. Ver migración 346.';

REVOKE EXECUTE ON FUNCTION registrar_camino_onboarding(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION registrar_camino_onboarding(TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION registrar_camino_onboarding(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION registrar_camino_onboarding(TEXT, TEXT) TO service_role;

-- ----------------------------------------------------------------------------
-- 5. Autocheck: org sintética, sub-bloque que siempre se revierte
-- ----------------------------------------------------------------------------
-- La org nace con suscripción Free (006:332-343) y su sucursal principal la
-- crea el trigger de 217. Nada de lo que se crea acá sobrevive: el sub-bloque
-- termina con un RAISE que lo revierte. Las variables de plpgsql no se
-- revierten, así que v_falla conserva lo que se detectó.
DO $$
DECLARE
  v_org TEXT := 'autocheck-346-' || substr(md5(random()::text), 1, 10);
  v_suc TEXT;
  v_falla TEXT;
  v_cli_a TEXT;
  v_cli_b TEXT;
  v_orden_a TEXT;
  v_orden_b TEXT;
  v_orden_real TEXT;
  v_res JSONB;
  v_n INT;
  v_antes INT;
  v_c TEXT;
BEGIN
  BEGIN
    INSERT INTO organizations (id, nombre, slug, activo, rubro)
    VALUES (v_org, 'Autocheck 346', v_org, TRUE, 'electronica');

    SELECT id INTO v_suc FROM sucursales WHERE organization_id = v_org AND principal LIMIT 1;
    IF v_suc IS NULL THEN
      v_falla := 'el alta de la org no creó la sucursal principal (217)';
      RAISE EXCEPTION 'autocheck-346-rollback';
    END IF;

    -- (a) La práctica no consume cupo del plan.
    INSERT INTO clientes (organization_id, nombre, telefono, es_practica)
    VALUES (v_org, 'Práctica A', '', TRUE) RETURNING id INTO v_cli_a;
    INSERT INTO ordenes_servicio (organization_id, sucursal_id, cliente_id, numero_orden, codigo_orden,
                                  dispositivo, tipo_dispositivo, problema_reportado, estado, es_practica)
    VALUES (v_org, v_suc, v_cli_a, 0, 'PRACTICA', 'Equipo', 'CELULAR', 'No enciende', 'RECIBIDO', TRUE)
    RETURNING id INTO v_orden_a;

    SELECT COALESCE(clientes_count, 0) + COALESCE(ordenes_mes_actual, 0) INTO v_n
      FROM organization_usage WHERE organization_id = v_org;
    IF COALESCE(v_n, 0) <> 0 THEN
      v_falla := concat_ws('; ', v_falla, 'los triggers contaron filas de práctica (' || v_n || ')');
    END IF;

    -- (b) A lo sumo una práctica por org: numero_orden 0 es único.
    BEGIN
      INSERT INTO ordenes_servicio (organization_id, sucursal_id, cliente_id, numero_orden, codigo_orden,
                                    dispositivo, tipo_dispositivo, problema_reportado, estado, es_practica)
      VALUES (v_org, v_suc, v_cli_a, 0, 'PRACTICA', 'Equipo', 'CELULAR', 'No enciende', 'RECIBIDO', TRUE);
      v_falla := concat_ws('; ', v_falla, 'se pudo crear una segunda orden con numero_orden 0');
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;

    -- (c) Práctica sin uso real: se borra todo y no se descuenta cupo.
    INSERT INTO notification_logs (organization_id, orden_id, cliente_id, tipo, canal, estado,
                                   destinatario, contenido)
    VALUES (v_org, v_orden_a, v_cli_a, 'CAMBIO_ESTADO', 'EMAIL', 'ENVIADO',
            'autocheck@example.com', 'autocheck');

    v_res := borrar_datos_practica(v_org);
    IF (v_res->>'orden_borrada')::BOOLEAN IS NOT TRUE
       OR EXISTS (SELECT 1 FROM ordenes_servicio WHERE id = v_orden_a)
       OR EXISTS (SELECT 1 FROM clientes WHERE id = v_cli_a)
       OR EXISTS (SELECT 1 FROM notification_logs WHERE cliente_id = v_cli_a) THEN
      v_falla := concat_ws('; ', v_falla, 'no se borró la práctica sin uso: ' || v_res::TEXT);
    END IF;
    SELECT COALESCE(clientes_count, 0) INTO v_n FROM organization_usage WHERE organization_id = v_org;
    IF v_n <> 0 THEN
      v_falla := concat_ws('; ', v_falla, 'borrar la práctica movió clientes_count a ' || v_n);
    END IF;

    -- (d) Cliente de práctica usado en una orden real (FK con CASCADE): se
    --     conserva, pasa a real y suma 1; la orden real sobrevive.
    INSERT INTO clientes (organization_id, nombre, telefono, es_practica)
    VALUES (v_org, 'Práctica B', '', TRUE) RETURNING id INTO v_cli_b;
    INSERT INTO ordenes_servicio (organization_id, sucursal_id, cliente_id, numero_orden, codigo_orden,
                                  dispositivo, tipo_dispositivo, problema_reportado, estado, es_practica)
    VALUES (v_org, v_suc, v_cli_b, 0, 'PRACTICA', 'Equipo', 'CELULAR', 'No enciende', 'RECIBIDO', TRUE)
    RETURNING id INTO v_orden_b;
    INSERT INTO ordenes_servicio (organization_id, sucursal_id, cliente_id, numero_orden, codigo_orden,
                                  dispositivo, tipo_dispositivo, problema_reportado, estado)
    VALUES (v_org, v_suc, v_cli_b, 1, 'CEL001', 'Equipo real', 'CELULAR', 'Pantalla', 'RECIBIDO')
    RETURNING id INTO v_orden_real;

    SELECT COALESCE(clientes_count, 0) INTO v_antes FROM organization_usage WHERE organization_id = v_org;
    v_res := borrar_datos_practica(v_org);

    IF (v_res->>'cliente_conservado')::BOOLEAN IS NOT TRUE
       OR NOT EXISTS (SELECT 1 FROM clientes WHERE id = v_cli_b AND NOT es_practica)
       OR NOT EXISTS (SELECT 1 FROM ordenes_servicio WHERE id = v_orden_real)
       OR EXISTS (SELECT 1 FROM ordenes_servicio WHERE id = v_orden_b) THEN
      v_falla := concat_ws('; ', v_falla, 'se destruyeron o no se liberaron datos reales: ' || v_res::TEXT);
    END IF;
    SELECT COALESCE(clientes_count, 0) INTO v_n FROM organization_usage WHERE organization_id = v_org;
    IF v_n <> v_antes + 1 THEN
      v_falla := concat_ws('; ', v_falla,
        'el cliente que pasó a real no sumó cupo (' || v_antes || ' -> ' || v_n || ')');
    END IF;

    -- (e) La lista de clientes lee la vista: tiene que exponer la columna.
    PERFORM es_practica FROM v_clientes_resumen LIMIT 1;

    -- (g) camino: fila ausente y fila presente, para las dos escrituras.
    --     La org sintética no tiene fila (la crea el registro en la app, no un
    --     trigger), así que arranca en el caso "fila ausente".
    -- POST de la práctica, fila ausente: se crea con 'practica'.
    v_c := registrar_camino_onboarding(v_org, 'practica');
    SELECT COUNT(*) INTO v_n FROM onboarding_progress WHERE organization_id = v_org;
    IF v_c IS DISTINCT FROM 'practica' OR v_n <> 1 THEN
      v_falla := concat_ws('; ', v_falla, 'practica sin fila: ' || COALESCE(v_c, 'NULL') || ', filas ' || v_n);
    END IF;
    -- /complete, fila presente con 'practica': ni 'omitido' ni 'real' la pisan.
    v_c := registrar_camino_onboarding(v_org, 'omitido');
    IF v_c IS DISTINCT FROM 'practica' THEN
      v_falla := concat_ws('; ', v_falla, 'omitido pisó practica: ' || COALESCE(v_c, 'NULL'));
    END IF;
    v_c := registrar_camino_onboarding(v_org, 'real');
    IF v_c IS DISTINCT FROM 'practica' THEN
      v_falla := concat_ws('; ', v_falla, 'real pisó practica: ' || COALESCE(v_c, 'NULL'));
    END IF;
    -- /complete, fila ausente: se crea con el camino pedido.
    DELETE FROM onboarding_progress WHERE organization_id = v_org;
    v_c := registrar_camino_onboarding(v_org, 'omitido');
    SELECT COUNT(*) INTO v_n FROM onboarding_progress WHERE organization_id = v_org;
    IF v_c IS DISTINCT FROM 'omitido' OR v_n <> 1 THEN
      v_falla := concat_ws('; ', v_falla, 'omitido sin fila: ' || COALESCE(v_c, 'NULL') || ', filas ' || v_n);
    END IF;
    -- POST de la práctica, fila presente: 'practica' se guarda igual.
    v_c := registrar_camino_onboarding(v_org, 'practica');
    IF v_c IS DISTINCT FROM 'practica' THEN
      v_falla := concat_ws('; ', v_falla, 'practica no pisó omitido: ' || COALESCE(v_c, 'NULL'));
    END IF;
    -- Fila presente con camino vacío: 'omitido' lo completa.
    UPDATE onboarding_progress SET camino = NULL WHERE organization_id = v_org;
    v_c := registrar_camino_onboarding(v_org, 'omitido');
    IF v_c IS DISTINCT FROM 'omitido' THEN
      v_falla := concat_ws('; ', v_falla, 'omitido no completó un camino vacío: ' || COALESCE(v_c, 'NULL'));
    END IF;
    -- Fila presente con 'real': 'omitido' nunca pisa.
    UPDATE onboarding_progress SET camino = 'real' WHERE organization_id = v_org;
    v_c := registrar_camino_onboarding(v_org, 'omitido');
    IF v_c IS DISTINCT FROM 'real' THEN
      v_falla := concat_ws('; ', v_falla, 'omitido pisó real: ' || COALESCE(v_c, 'NULL'));
    END IF;
    -- El CHECK rechaza un camino desconocido.
    BEGIN
      PERFORM registrar_camino_onboarding(v_org, 'otro');
      v_falla := concat_ws('; ', v_falla, 'se aceptó el camino ''otro''');
    EXCEPTION WHEN check_violation THEN
      NULL;
    END;

    RAISE EXCEPTION 'autocheck-346-rollback';
  EXCEPTION WHEN raise_exception THEN
    -- Solo se traga la señal propia. Cualquier otro P0001 (p. ej. un límite de
    -- plan) es un error real y aborta la migración.
    IF SQLERRM <> 'autocheck-346-rollback' THEN
      RAISE;
    END IF;
  END;

  -- (f) Privilegios: lectura pura, fuera del bloque revertido.
  IF has_function_privilege('anon', 'borrar_datos_practica(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'borrar_datos_practica(text)', 'EXECUTE') THEN
    v_falla := concat_ws('; ', v_falla, 'anon/authenticated pueden ejecutar borrar_datos_practica');
  END IF;
  IF has_function_privilege('anon', 'registrar_camino_onboarding(text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'registrar_camino_onboarding(text, text)', 'EXECUTE') THEN
    v_falla := concat_ws('; ', v_falla, 'anon/authenticated pueden ejecutar registrar_camino_onboarding');
  END IF;
  -- La vista recreada tiene exactamente los permisos que tenía (sin mirar el
  -- grantor, que puede cambiar con quien corre la migración).
  IF EXISTS (
    (SELECT a.grantee, a.privilege_type, a.is_grantable
       FROM _acl_v_clientes_resumen_346 t, aclexplode(t.relacl) a
      WHERE a.grantee <> (SELECT relowner FROM pg_class WHERE oid = 'public.v_clientes_resumen'::regclass)
     EXCEPT
     SELECT a.grantee, a.privilege_type, a.is_grantable
       FROM pg_class c, aclexplode(c.relacl) a
      WHERE c.oid = 'public.v_clientes_resumen'::regclass)
    UNION ALL
    (SELECT a.grantee, a.privilege_type, a.is_grantable
       FROM pg_class c, aclexplode(c.relacl) a
      WHERE c.oid = 'public.v_clientes_resumen'::regclass
        AND a.grantee <> c.relowner
     EXCEPT
     SELECT a.grantee, a.privilege_type, a.is_grantable
       FROM _acl_v_clientes_resumen_346 t, aclexplode(t.relacl) a)
  ) THEN
    v_falla := concat_ws('; ', v_falla, 'los permisos de v_clientes_resumen cambiaron al recrearla');
  END IF;

  IF v_falla IS NOT NULL THEN
    RAISE EXCEPTION 'AUTOCHECK 346 FALLÓ: %', v_falla;
  END IF;
END $$;

SELECT 'autocheck 346 OK' AS resultado;

-- ----------------------------------------------------------------------------
-- 6. Solo lectura: comparar con las tablas de FKs del plan
-- ----------------------------------------------------------------------------
-- Una FK NO ACTION o RESTRICT hacia ordenes_servicio que no esté en el plan
-- puede hacer fallar borrar_datos_practica. Revisarla antes de --apply.
SELECT c.confrelid::regclass::text AS apunta_a,
       c.conrelid::regclass::text  AS tabla,
       a.attname                   AS columna,
       CASE c.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL'
                          WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
                          WHEN 'd' THEN 'SET DEFAULT' END AS on_delete
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
 WHERE c.contype = 'f'
   AND c.confrelid IN ('public.clientes'::regclass, 'public.ordenes_servicio'::regclass)
 ORDER BY 1, 2, 3;

-- Un cliente real con teléfono vacío choca con el de práctica
-- (UNIQUE(organization_id, telefono)). Esperado: 0.
SELECT COUNT(*) AS clientes_reales_con_telefono_vacio
  FROM clientes WHERE telefono = '' AND NOT es_practica;

-- Permisos de la vista recreada (iguales a los de antes, ver autocheck (f)).
SELECT relacl::text AS acl_v_clientes_resumen
  FROM pg_class WHERE oid = 'public.v_clientes_resumen'::regclass;
```

- [ ] **Step 2: Static checks on the migration**

Run: `rg -n "^\s*BEGIN\s*;" supabase/migrations/346_orden_practica_onboarding.sql`
Expected: no output. A bare `BEGIN;` line would make `db-run.mjs` treat the file as owning its transaction, and the dry-run would commit.

Run: `rg -c "es_practica" supabase/migrations/346_orden_practica_onboarding.sql`
Expected: a count above 20.

- [ ] **Step 3: Write the rollback**

Create `supabase/migrations/rollback/346_rollback.sql`:

```sql
-- Rollback de 346_orden_practica_onboarding.sql
--
-- PIERDE DATOS. Borra las prácticas que existan (orden + cliente sin uso real)
-- y las columnas onboarding_progress.camino / practica_completada_at, que son la
-- única traza del camino que tomó cada taller en el wizard. Exportar antes:
--
--   SELECT organization_id, camino, practica_completada_at
--     FROM onboarding_progress
--    WHERE camino IS NOT NULL OR practica_completada_at IS NOT NULL;
--
-- Hacer rollback solo si el código del PR 1 se revierte también: el código
-- filtra y selecciona es_practica, y sin la columna esas queries fallan.
-- La vista vuelve a la definición de 294:55-85 con los mismos permisos que
-- tenga al momento del rollback.

-- 1. Borrar las prácticas ANTES de soltar la columna: sin el flag, una
--    práctica pasaría a contar como orden y cliente reales.
SELECT o.id AS organization_id, borrar_datos_practica(o.id) AS resultado
  FROM organizations o
 WHERE EXISTS (SELECT 1 FROM ordenes_servicio s WHERE s.organization_id = o.id AND s.es_practica)
    OR EXISTS (SELECT 1 FROM clientes c WHERE c.organization_id = o.id AND c.es_practica);

DROP FUNCTION IF EXISTS borrar_datos_practica(TEXT);
DROP FUNCTION IF EXISTS registrar_camino_onboarding(TEXT, TEXT);

-- 2. Triggers de cupo: cuerpos de 167:67-131, sin el salto de práctica.
CREATE OR REPLACE FUNCTION update_ordenes_count()
RETURNS TRIGGER AS $$
DECLARE
  v_new_count INTEGER;
  v_limit INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO organization_usage (organization_id, ordenes_count, ordenes_mes_actual, periodo_inicio)
    VALUES (NEW.organization_id, 1, 1, DATE_TRUNC('month', NOW()))
    ON CONFLICT (organization_id)
    DO UPDATE SET
      ordenes_count = organization_usage.ordenes_count + 1,
      ordenes_mes_actual = CASE
        WHEN organization_usage.periodo_inicio < DATE_TRUNC('month', NOW())
        THEN 1
        ELSE organization_usage.ordenes_mes_actual + 1
      END,
      periodo_inicio = CASE
        WHEN organization_usage.periodo_inicio < DATE_TRUNC('month', NOW())
        THEN DATE_TRUNC('month', NOW())
        ELSE organization_usage.periodo_inicio
      END
    RETURNING ordenes_mes_actual INTO v_new_count;

    v_limit := get_plan_limit(NEW.organization_id, 'ordenes');

    IF v_limit IS NOT NULL AND v_new_count > v_limit THEN
      RAISE EXCEPTION 'PLAN_LIMIT_EXCEEDED:ordenes:%:%', v_new_count, v_limit
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_clientes_count()
RETURNS TRIGGER AS $$
DECLARE
  v_new_count INTEGER;
  v_limit INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO organization_usage (organization_id, clientes_count)
    VALUES (NEW.organization_id, 1)
    ON CONFLICT (organization_id)
    DO UPDATE SET clientes_count = organization_usage.clientes_count + 1
    RETURNING clientes_count INTO v_new_count;

    v_limit := get_plan_limit(NEW.organization_id, 'clientes');
    IF v_limit IS NOT NULL AND v_new_count > v_limit THEN
      RAISE EXCEPTION 'PLAN_LIMIT_EXCEEDED:clientes:%:%', v_new_count, v_limit
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE organization_usage
    SET clientes_count = GREATEST(0, clientes_count - 1)
    WHERE organization_id = OLD.organization_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_clientes_count ON clientes;
CREATE TRIGGER trigger_clientes_count
  AFTER INSERT OR DELETE ON clientes
  FOR EACH ROW EXECUTE FUNCTION update_clientes_count();

-- 3. La vista depende de c.*: se suelta antes de las columnas y se recrea al
--    final con la definición vieja (294:55-85) y los mismos permisos.
CREATE TEMP TABLE _acl_v_clientes_resumen_346r ON COMMIT DROP AS
  SELECT relacl FROM pg_class WHERE oid = 'public.v_clientes_resumen'::regclass;

DROP VIEW IF EXISTS v_clientes_resumen;

DROP INDEX IF EXISTS ordenes_servicio_practica_idx;
DROP INDEX IF EXISTS clientes_practica_idx;
ALTER TABLE ordenes_servicio DROP COLUMN IF EXISTS es_practica;
ALTER TABLE clientes DROP COLUMN IF EXISTS es_practica;
ALTER TABLE onboarding_progress DROP CONSTRAINT IF EXISTS onboarding_progress_camino_check;
ALTER TABLE onboarding_progress DROP COLUMN IF EXISTS camino;
ALTER TABLE onboarding_progress DROP COLUMN IF EXISTS practica_completada_at;

CREATE VIEW v_clientes_resumen AS
SELECT
  c.*,
  COALESCE(agg.ordenes_count, 0)   AS ordenes_count,
  agg.ultima_visita                AS ultima_visita,
  COALESCE(agg.deuda_pendiente, 0) AS deuda_pendiente,
  sec.sectores_texto               AS sectores_texto
FROM clientes c
LEFT JOIN (
  SELECT
    cliente_id,
    COUNT(*)            AS ordenes_count,
    MAX(fecha_ingreso)  AS ultima_visita,
    SUM(
      CASE WHEN estado_cobro IN ('PENDIENTE','PARCIAL')
                AND estado IN ('REPARADO','ENTREGADO')
        THEN GREATEST(
          COALESCE(costo_final, 0)
          - COALESCE(descuento_cobro, 0)
          - COALESCE(total_cobrado, 0), 0)
        ELSE 0 END
    ) AS deuda_pendiente
  FROM ordenes_servicio
  GROUP BY cliente_id
) agg ON agg.cliente_id = c.id
LEFT JOIN (
  SELECT cliente_id, string_agg(nombre, ' ') AS sectores_texto
  FROM sectores_cliente
  WHERE activo = true
  GROUP BY cliente_id
) sec ON sec.cliente_id = c.id;

-- Mismo procedimiento que la 346: sacar los default privileges y volver a dar
-- exactamente lo que la vista tenía antes del DROP.
DO $$
DECLARE
  r RECORD;
  v_owner OID;
BEGIN
  SELECT relowner INTO v_owner FROM pg_class WHERE oid = 'public.v_clientes_resumen'::regclass;

  FOR r IN
    SELECT DISTINCT a.grantee
      FROM pg_class c, aclexplode(c.relacl) a
     WHERE c.oid = 'public.v_clientes_resumen'::regclass AND a.grantee <> v_owner
  LOOP
    EXECUTE format('REVOKE ALL ON public.v_clientes_resumen FROM %s',
      CASE WHEN r.grantee = 0 THEN 'PUBLIC'
           ELSE (SELECT quote_ident(rolname) FROM pg_roles WHERE oid = r.grantee) END);
  END LOOP;

  FOR r IN
    SELECT a.grantee, a.privilege_type, a.is_grantable
      FROM _acl_v_clientes_resumen_346r t, aclexplode(t.relacl) a
     WHERE a.grantee <> v_owner
  LOOP
    EXECUTE format('GRANT %s ON public.v_clientes_resumen TO %s%s',
      r.privilege_type,
      CASE WHEN r.grantee = 0 THEN 'PUBLIC'
           ELSE (SELECT quote_ident(rolname) FROM pg_roles WHERE oid = r.grantee) END,
      CASE WHEN r.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;
END $$;

SELECT relacl::text AS acl_v_clientes_resumen
  FROM pg_class WHERE oid = 'public.v_clientes_resumen'::regclass;
```

Run: `rg -n "^\s*BEGIN\s*;" supabase/migrations/rollback/346_rollback.sql`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/346_orden_practica_onboarding.sql supabase/migrations/rollback/346_rollback.sql
git commit -m "feat(db): add practice-order flags, plan-limit skip and cleanup function"
```

- [ ] **Step 5: Dry-run (orchestrator, with user approval)**

From `C:\Users\LUIS\Desktop\stapp`:
`node scripts/db-run.mjs .worktrees/onboarding-logo/supabase/migrations/346_orden_practica_onboarding.sql`

Expected:
- `Modo: DRY-RUN (ROLLBACK al final)`
- a result row `autocheck 346 OK`. That covers the trigger skips (a, c, d), the cleanup function (c, d), the view column (e), the grants and privileges (f), and `camino` with the row missing and present (g).
- the FK table, matching Verified Facts §2
- `clientes_reales_con_telefono_vacio = 0`
- `acl_v_clientes_resumen`, the view's ACL, unchanged from before the migration
- then `ROLLBACK`

If the autocheck fails on an assertion, stop and fix the SQL. If it fails while building the fixture (the synthetic org or its sucursal), report the error to the user. Do not weaken the checks.

- [ ] **Step 6: Apply (orchestrator, with the user's explicit OK)**

Same command with `--apply`. Expected: `autocheck 346 OK` and `COMMIT`. Then run the two "VERIFICACIÓN POSTERIOR" queries from the header.

- [ ] **Step 7: Dry-run the rollback (orchestrator, with user approval)**

Right after the apply: `node scripts/db-run.mjs .worktrees/onboarding-logo/supabase/migrations/rollback/346_rollback.sql`
Expected: runs to `ROLLBACK` without errors. This proves the rollback compiles against the applied schema and leaves the migration in place.

---

### Task 2: Practice helpers

**Files:**
- Create: `lib/onboarding/practica-shared.ts`
- Create: `lib/onboarding/practica.ts`
- Modify: `vitest.setup.ts` (append after the `@/lib/supabase` mock, line 88)
- Test: `lib/__tests__/onboarding-practica-shared.test.ts`
- Test: `lib/__tests__/onboarding-practica.test.ts`

**Interfaces:**
- Consumes: the column names from Task 1, and the `borrar_datos_practica(p_org_id)` RPC returning `{ orden_borrada, cliente_conservado }`.
- Produces: every `lib/onboarding/practica*.ts` export in the Interfaces block, plus the default test mocks.

- [ ] **Step 1: Write the failing tests**

Create `lib/__tests__/onboarding-practica-shared.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  ORDEN_PRACTICA_ERROR,
  PRACTICA_NUMERO_ORDEN,
  PRACTICA_PROBLEMAS_GENERICOS,
} from "@/lib/onboarding/practica-shared"

describe("practica-shared", () => {
  it("pins the values PR 2 and PR 3 rely on", () => {
    expect(PRACTICA_NUMERO_ORDEN).toBe(0)
    expect(PRACTICA_PROBLEMAS_GENERICOS).toEqual(["No enciende", "Funciona con fallas", "Hace ruido", "Mantenimiento"])
    expect(ORDEN_PRACTICA_ERROR).toEqual({ error: "Es una orden de práctica", code: "ORDEN_PRACTICA" })
  })

  it("stays client-safe: no server imports", () => {
    const src = readFileSync(join(process.cwd(), "lib/onboarding/practica-shared.ts"), "utf8")
    expect(src).not.toMatch(/from\s+["'][^"']*supabase/)
    expect(src).not.toMatch(/from\s+["']next\/server["']/)
  })
})
```

Create `lib/__tests__/onboarding-practica.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll } from "vitest"
import { ORDEN_PRACTICA_ERROR } from "@/lib/onboarding/practica-shared"

type Practica = typeof import("@/lib/onboarding/practica")

// vitest.setup.ts swaps deletePracticeData and rejectIfPractica for no-op mocks so
// that route suites are not affected; this file needs the real implementations.
let real: Practica
beforeAll(async () => {
  real = await vi.importActual<Practica>("@/lib/onboarding/practica")
})

type Resultado = { data?: unknown; error?: { message: string } | null; count?: number }

function clienteFalso(resultado: Resultado = {}) {
  const final = { data: resultado.data ?? null, error: resultado.error ?? null, count: resultado.count }
  const chain: Record<string, any> = {}
  for (const m of ["select", "eq"]) chain[m] = vi.fn(() => chain)
  chain.maybeSingle = vi.fn(async () => final)
  chain.then = (resolve: (v: typeof final) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(final).then(resolve, reject)
  const client = {
    from: vi.fn(() => chain),
    rpc: vi.fn(async () => ({ data: final.data, error: final.error })),
  }
  return { client: client as any, chain }
}

const fila = {
  id: "ord-p",
  estado: "RECIBIDO",
  public_token: "b".repeat(32),
  tipo_dispositivo: "CELULAR",
  dispositivo: "Moto G",
  problema_reportado: "No enciende",
  costo_final: null,
}

describe("toPracticaOrden", () => {
  it("maps the row to the wizard contract", () => {
    expect(real.toPracticaOrden(fila)).toEqual({
      id: "ord-p",
      estado: "RECIBIDO",
      publicToken: "b".repeat(32),
      tipoDispositivo: "CELULAR",
      dispositivo: "Moto G",
      problemaReportado: "No enciende",
      costoFinal: null,
    })
  })

  it("parses the DECIMAL cost and shows a half-done repair as RECIBIDO", () => {
    expect(real.toPracticaOrden({ ...fila, estado: "EN_REPARACION", costo_final: "15000.00" })).toMatchObject({
      estado: "RECIBIDO",
      costoFinal: 15000,
    })
  })
})

describe("getPracticaOrden", () => {
  it("reads only the caller org's practice row", async () => {
    const { client, chain } = clienteFalso({ data: fila })
    const practica = await real.getPracticaOrden("org-1", client)
    expect(client.from).toHaveBeenCalledWith("ordenes_servicio")
    expect(chain.select).toHaveBeenCalledWith(real.PRACTICA_ORDEN_SELECT)
    expect(chain.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(chain.eq).toHaveBeenCalledWith("es_practica", true)
    expect(practica?.id).toBe("ord-p")
  })

  it("returns null when the org has no practice", async () => {
    const { client } = clienteFalso({ data: null })
    await expect(real.getPracticaOrden("org-1", client)).resolves.toBeNull()
  })

  it("throws on a database error", async () => {
    const { client } = clienteFalso({ error: { message: "boom" } })
    await expect(real.getPracticaOrden("org-1", client)).rejects.toThrow("boom")
  })
})

describe("deletePracticeData", () => {
  it("delegates to borrar_datos_practica and reports a client kept for real work", async () => {
    const { client } = clienteFalso({ data: { orden_borrada: true, cliente_conservado: true } })
    await expect(real.deletePracticeData("org-1", client)).resolves.toEqual({
      ordenBorrada: true,
      clienteConservado: true,
    })
    expect(client.rpc).toHaveBeenCalledWith("borrar_datos_practica", { p_org_id: "org-1" })
  })

  it("reports nothing deleted when the org had no practice", async () => {
    const { client } = clienteFalso({ data: { orden_borrada: false, cliente_conservado: false } })
    await expect(real.deletePracticeData("org-1", client)).resolves.toEqual({
      ordenBorrada: false,
      clienteConservado: false,
    })
  })

  it("throws on an RPC error so each caller decides", async () => {
    const { client } = clienteFalso({ error: { message: "rpc down" } })
    await expect(real.deletePracticeData("org-1", client)).rejects.toThrow("rpc down")
  })
})

describe("rejectIfPractica", () => {
  it("returns 409 ORDEN_PRACTICA for a practice order", async () => {
    const { client, chain } = clienteFalso({ data: { id: "ord-p", es_practica: true } })
    const res = await real.rejectIfPractica("ord-p", "org-1", client)
    expect(res?.status).toBe(409)
    expect(await res?.json()).toEqual(ORDEN_PRACTICA_ERROR)
    expect(chain.select).toHaveBeenCalledWith("id, es_practica")
  })

  it("lets a real order through", async () => {
    const { client } = clienteFalso({ data: { id: "ord-1", es_practica: false } })
    await expect(real.rejectIfPractica("ord-1", "org-1", client)).resolves.toBeNull()
  })

  it("never looks outside the caller's org", async () => {
    // Another org's practice id is "not found" under this org; the route's own 404 handles it.
    const { client, chain } = clienteFalso({ data: null })
    await expect(real.rejectIfPractica("ord-ajena", "org-1", client)).resolves.toBeNull()
    expect(chain.eq).toHaveBeenCalledWith("id", "ord-ajena")
    expect(chain.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("fails open on a database error and logs it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const { client } = clienteFalso({ error: { message: "column missing" } })
    await expect(real.rejectIfPractica("ord-1", "org-1", client)).resolves.toBeNull()
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })
})

describe("countRealOrders", () => {
  it("counts only the org's non-practice orders", async () => {
    const { client, chain } = clienteFalso({ count: 3 })
    await expect(real.countRealOrders("org-1", client)).resolves.toBe(3)
    expect(chain.select).toHaveBeenCalledWith("id", { count: "exact", head: true })
    expect(chain.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(chain.eq).toHaveBeenCalledWith("es_practica", false)
  })

  it("throws on a database error", async () => {
    const { client } = clienteFalso({ error: { message: "boom" } })
    await expect(real.countRealOrders("org-1", client)).rejects.toThrow("boom")
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/__tests__/onboarding-practica-shared.test.ts lib/__tests__/onboarding-practica.test.ts`
Expected: FAIL with "Failed to resolve import "@/lib/onboarding/practica-shared"" (and the same for `practica`).

- [ ] **Step 3: Write the shared contract**

Create `lib/onboarding/practica-shared.ts`:

```ts
/**
 * Practice-order contract shared by the server and the onboarding wizard.
 *
 * Pure on purpose: no supabase or next/server import, so client components can
 * use it. Server helpers live in lib/onboarding/practica.ts.
 */

/**
 * The practice order is numbered 0. get_next_order_number (migration 048) uses
 * GREATEST(next, MAX(numero_orden) + 1), so the first real order is still #1,
 * and UNIQUE(organization_id, numero_orden) allows one practice per org.
 */
export const PRACTICA_NUMERO_ORDEN = 0

export type PracticaEstado = "RECIBIDO" | "REPARADO" | "ENTREGADO_SIN_COBRO"

export interface PracticaOrden {
  id: string
  estado: PracticaEstado
  publicToken: string
  tipoDispositivo: string
  dispositivo: string
  problemaReportado: string
  costoFinal: number | null
}

/** Problem chips for rubros whose tipos have no config.problemasComunes (genérico). */
export const PRACTICA_PROBLEMAS_GENERICOS = ["No enciende", "Funciona con fallas", "Hace ruido", "Mantenimiento"] as const

/** Body of the 409 that money and stock routes return for a practice order. */
export const ORDEN_PRACTICA_ERROR = { error: "Es una orden de práctica", code: "ORDEN_PRACTICA" } as const
```

- [ ] **Step 4: Write the server helpers**

Create `lib/onboarding/practica.ts`:

```ts
import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import {
  ORDEN_PRACTICA_ERROR,
  type PracticaEstado,
  type PracticaOrden,
} from "@/lib/onboarding/practica-shared"

/** codigo_orden of the practice order: TEXT, nullable, not unique (migration 013). */
export const PRACTICA_CODIGO_ORDEN = "PRACTICA"

/** Columns every practice read needs, including what the notification context uses. */
export const PRACTICA_ORDEN_SELECT =
  "id, estado, public_token, tipo_dispositivo, dispositivo, problema_reportado, costo_final, fecha_completado, sucursal_id, cliente_id, clientes (id, nombre, email)"

export interface PracticaOrdenRow {
  id: string
  estado: string
  public_token: string | null
  tipo_dispositivo: string
  dispositivo: string
  problema_reportado: string
  costo_final: string | number | null
  fecha_completado?: string | null
  sucursal_id?: string | null
  cliente_id?: string
  clientes?: { id: string; nombre: string; email: string | null } | null
}

type DbClient = typeof supabaseAdmin

function toPracticaEstado(estado: string): PracticaEstado {
  if (estado === "REPARADO" || estado === "ENTREGADO_SIN_COBRO") return estado
  // EN_REPARACION exists only for an instant inside "reparar". If the second
  // write failed, the wizard must offer "reparar" again.
  return "RECIBIDO"
}

export function toPracticaOrden(row: PracticaOrdenRow): PracticaOrden {
  return {
    id: row.id,
    estado: toPracticaEstado(row.estado),
    publicToken: row.public_token ?? "",
    tipoDispositivo: row.tipo_dispositivo,
    dispositivo: row.dispositivo,
    problemaReportado: row.problema_reportado,
    costoFinal: row.costo_final === null || row.costo_final === undefined ? null : Number(row.costo_final),
  }
}

/** The org's practice order, or null. Throws on a database error. */
export async function getPracticaOrden(
  organizationId: string,
  client: DbClient = supabaseAdmin
): Promise<PracticaOrden | null> {
  const { data, error } = await client
    .from("ordenes_servicio")
    .select(PRACTICA_ORDEN_SELECT)
    .eq("organization_id", organizationId)
    .eq("es_practica", true)
    .maybeSingle()
  if (error) throw new Error(`getPracticaOrden: ${error.message}`)
  return data ? toPracticaOrden(data as unknown as PracticaOrdenRow) : null
}

/**
 * Deletes the org's practice order and its client. The client is kept, and
 * turned into a real one, when anything outside the practice references it.
 * All of it runs in borrar_datos_practica (migration 346), so a cascading FK
 * can never take real data with it. Throws on error; callers decide.
 */
export async function deletePracticeData(
  organizationId: string,
  client: DbClient = supabaseAdmin
): Promise<{ ordenBorrada: boolean; clienteConservado: boolean }> {
  const { data, error } = await client.rpc("borrar_datos_practica", { p_org_id: organizationId })
  if (error) throw new Error(`borrar_datos_practica: ${error.message}`)
  const result = (data ?? {}) as { orden_borrada?: boolean; cliente_conservado?: boolean }
  return {
    ordenBorrada: result.orden_borrada === true,
    clienteConservado: result.cliente_conservado === true,
  }
}

/**
 * 409 when the order is the org's practice order, null otherwise. Fails open on
 * a database error: this guard backs up a read-only UI, and failing closed would
 * block every money route if the column were ever missing.
 */
export async function rejectIfPractica(
  ordenId: string,
  organizationId: string,
  client: DbClient = supabaseAdmin
): Promise<NextResponse | null> {
  const { data, error } = await client
    .from("ordenes_servicio")
    .select("id, es_practica")
    .eq("id", ordenId)
    .eq("organization_id", organizationId)
    .maybeSingle()
  if (error) {
    console.error("[practica] rejectIfPractica could not read the order:", error.message)
    return null
  }
  if ((data as { es_practica?: boolean } | null)?.es_practica === true) {
    return NextResponse.json(ORDEN_PRACTICA_ERROR, { status: 409 })
  }
  return null
}

/** Orders that are not the practice. Throws on a database error. */
export async function countRealOrders(
  organizationId: string,
  client: DbClient = supabaseAdmin
): Promise<number> {
  const { count, error } = await client
    .from("ordenes_servicio")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("es_practica", false)
  if (error) throw new Error(`countRealOrders: ${error.message}`)
  return count ?? 0
}
```

- [ ] **Step 5: Add the default mocks**

Append to `vitest.setup.ts`, after the `@/lib/supabase` mock (after line 88):

```ts
// Practice-order helpers. Every route that creates a real order calls
// deletePracticeData, and every money or stock route calls rejectIfPractica.
// Without these defaults each of those route suites would see an extra rpc() or
// from("ordenes_servicio") call. The helpers' own tests load the real module
// with vi.importActual; route tests override these per case with vi.mocked().
vi.mock('@/lib/onboarding/practica', async () => {
  const actual = await vi.importActual<typeof import('@/lib/onboarding/practica')>('@/lib/onboarding/practica')
  return {
    ...actual,
    deletePracticeData: vi.fn(async () => ({ ordenBorrada: false, clienteConservado: false })),
    rejectIfPractica: vi.fn(async () => null),
  }
})
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run lib/__tests__/onboarding-practica-shared.test.ts lib/__tests__/onboarding-practica.test.ts`
Expected: PASS, 16 tests.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/onboarding/practica-shared.ts lib/onboarding/practica.ts vitest.setup.ts lib/__tests__/onboarding-practica-shared.test.ts lib/__tests__/onboarding-practica.test.ts
git commit -m "feat(onboarding): add practice-order helpers"
```

---

### Task 3: Practice endpoint — GET, POST, DELETE

**Files:**
- Create: `app/api/onboarding/practica/route.ts`
- Test: `__tests__/api/onboarding-practica.test.ts`

**Interfaces:**
- Consumes (Task 2): `getPracticaOrden`, `deletePracticeData`, `countRealOrders`, `toPracticaOrden`, `PRACTICA_ORDEN_SELECT`, `PRACTICA_CODIGO_ORDEN`, `PracticaOrdenRow`, `PRACTICA_NUMERO_ORDEN`. From Task 1: the RPC `registrar_camino_onboarding(p_org_id, p_camino)`. Also `queueNotification` (`lib/notifications/queue.ts:10`) and `sucursalParaEscritura` (`lib/sucursal.ts:103`).
- Produces: `GET`, `POST` and `DELETE` per the HTTP block. Internal helpers `leerJson`, `primerError`, `registrarEvento` and `notificar` are reused by Task 4.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/api/onboarding-practica.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/notifications/queue", () => ({
  queueNotification: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/sucursal", () => ({
  sucursalParaEscritura: vi.fn().mockResolvedValue("suc-1"),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { queueNotification } from "@/lib/notifications/queue"
import { deletePracticeData } from "@/lib/onboarding/practica"
import { GET, POST, DELETE } from "@/app/api/onboarding/practica/route"

const org = {
  nombre: "Taller",
  nombre_mostrar: "Taller Luis",
  slug: "taller",
  moneda: "ARS",
  zona_horaria: "America/Argentina/Buenos_Aires",
}

const filaPractica = {
  id: "ord-p",
  estado: "RECIBIDO",
  public_token: "a".repeat(32),
  tipo_dispositivo: "CELULAR",
  dispositivo: "Moto G",
  problema_reportado: "No enciende",
  costo_final: null,
  fecha_completado: null,
  sucursal_id: "suc-1",
  cliente_id: "cli-p",
  clientes: { id: "cli-p", nombre: "Luis", email: "luis@taller.com" },
}

const cuerpo = { tipoDispositivo: "CELULAR", dispositivo: "Moto G", problemaReportado: "No enciende" }

function prepararAlta(
  opts: { tipo?: unknown; clienteError?: unknown; ordenError?: unknown; ordenesReales?: number; ganadora?: unknown } = {}
) {
  // Base chain: countRealOrders (count) and getPracticaOrden (maybeSingle).
  const ordenes = createChainMock(opts.ganadora ?? null, null, opts.ordenesReales ?? 0)
  const ordenInsertChain = createChainMock(opts.ordenError ? null : filaPractica, opts.ordenError ?? null)
  const ordenInsert = vi.fn().mockReturnValue(ordenInsertChain)
  ordenes.insert = ordenInsert

  const clientes = createChainMock(null)
  const clienteInsertChain = createChainMock(
    opts.clienteError ? null : { id: "cli-p" },
    opts.clienteError ?? null
  )
  const clienteInsert = vi.fn().mockReturnValue(clienteInsertChain)
  clientes.insert = clienteInsert
  const clienteDelete = vi.fn().mockReturnValue(clientes)
  clientes.delete = clienteDelete

  const eventos = createChainMock(null)
  const eventoInsert = vi.fn().mockReturnValue(eventos)
  eventos.insert = eventoInsert

  const tipos = createChainMock(opts.tipo === undefined ? { codigo: "CELULAR" } : opts.tipo)

  mockSupabaseFrom({
    tipos_dispositivo: tipos,
    users: createChainMock({ nombre: "Luis", email: "luis@taller.com" }),
    clientes,
    ordenes_servicio: ordenes,
    orden_eventos: eventos,
    organizations: createChainMock(org),
  })
  return { tipos, clientes, clienteInsert, clienteDelete, ordenes, ordenInsert, eventoInsert }
}

describe("GET /api/onboarding/practica", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("returns 403 for a non-admin", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    expect((await GET()).status).toBe(403)
  })

  it("returns null when the org has no practice, reading only its own practice row", async () => {
    const ordenes = createChainMock(null)
    mockSupabaseFrom({ ordenes_servicio: ordenes })
    const { status, body } = await parseResponse(await GET())
    expect(status).toBe(200)
    expect(body).toEqual({ practica: null })
    expect(ordenes.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(ordenes.eq).toHaveBeenCalledWith("es_practica", true)
  })

  it("returns the practice mapped for the wizard", async () => {
    mockSupabaseFrom({ ordenes_servicio: createChainMock(filaPractica) })
    const { body } = await parseResponse(await GET())
    expect(body.practica).toEqual({
      id: "ord-p",
      estado: "RECIBIDO",
      publicToken: "a".repeat(32),
      tipoDispositivo: "CELULAR",
      dispositivo: "Moto G",
      problemaReportado: "No enciende",
      costoFinal: null,
    })
  })
})

describe("POST /api/onboarding/practica", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
    // registrar_camino_onboarding is the only rpc this route calls.
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: "practica", error: null } as any)
  })

  it("returns 403 for a non-admin", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    expect((await POST(createPostRequest(cuerpo))).status).toBe(403)
  })

  it("rejects a body without a tipo", async () => {
    prepararAlta()
    const { status, body } = await parseResponse(await POST(createPostRequest({})))
    expect(status).toBe(400)
    expect(body.error).toBe("Elegí el tipo de equipo")
  })

  it("rejects a tipo that is not an active tipo of the org", async () => {
    const { tipos, clienteInsert } = prepararAlta({ tipo: null })
    const { status } = await parseResponse(await POST(createPostRequest(cuerpo)))
    expect(status).toBe(400)
    expect(tipos.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(tipos.eq).toHaveBeenCalledWith("activo", true)
    expect(clienteInsert).not.toHaveBeenCalled()
  })

  it("returns 409 when the org already has real orders", async () => {
    const { clienteInsert } = prepararAlta({ ordenesReales: 2 })
    const { status } = await parseResponse(await POST(createPostRequest(cuerpo)))
    expect(status).toBe(409)
    expect(clienteInsert).not.toHaveBeenCalled()
    expect(deletePracticeData).not.toHaveBeenCalled()
  })

  it("creates the practice client without a phone and the practice order numbered 0", async () => {
    const { clienteInsert, ordenInsert } = prepararAlta()
    const { status, body } = await parseResponse(await POST(createPostRequest(cuerpo)))

    expect(status).toBe(201)
    expect(clienteInsert).toHaveBeenCalledWith({
      organization_id: "org-1",
      nombre: "Luis",
      email: "luis@taller.com",
      telefono: "",
      acepta_whatsapp: false,
      es_practica: true,
    })
    const orden = ordenInsert.mock.calls[0][0]
    expect(orden).toMatchObject({
      numero_orden: 0,
      codigo_orden: "PRACTICA",
      es_practica: true,
      organization_id: "org-1",
      sucursal_id: "suc-1",
      cliente_id: "cli-p",
      tipo_dispositivo: "CELULAR",
      dispositivo: "Moto G",
      problema_reportado: "No enciende",
      estado: "RECIBIDO",
      recibido_por: "user-1",
    })
    expect(orden.public_token).toMatch(/^[0-9a-f]{32}$/)
    // Same as POST /api/ordenes (route.ts:389-428): expiry is never set on create.
    expect(orden).not.toHaveProperty("public_token_expires_at")
    expect(body.practica).toMatchObject({ id: "ord-p", estado: "RECIBIDO" })
  })

  it("replaces an existing practice before creating the new one", async () => {
    const { clienteInsert } = prepararAlta()
    await POST(createPostRequest(cuerpo))
    expect(deletePracticeData).toHaveBeenCalledWith("org-1")
    expect(vi.mocked(deletePracticeData).mock.invocationCallOrder[0]).toBeLessThan(
      clienteInsert.mock.invocationCallOrder[0]
    )
  })

  it("writes the creation event and queues one notification", async () => {
    const { eventoInsert } = prepararAlta()
    await POST(createPostRequest(cuerpo))

    expect(eventoInsert).toHaveBeenCalledTimes(1)
    expect(eventoInsert.mock.calls[0][0]).toMatchObject({
      orden_id: "ord-p",
      organization_id: "org-1",
      tipo: "CAMBIO_ESTADO",
      estado_nuevo: "RECIBIDO",
      created_by: "user-1",
    })
    expect(queueNotification).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(queueNotification).mock.calls[0][0]
    expect(arg.tipo).toBe("CAMBIO_ESTADO")
    expect(arg.context.orden).toMatchObject({ numeroOrden: 0, estado: "RECIBIDO", publicToken: "a".repeat(32) })
    expect(arg.context.cliente).toEqual({ id: "cli-p", nombre: "Luis", email: "luis@taller.com", telefono: "" })
  })

  // The onboarding_progress row may be missing (the new wizard no longer calls
  // GET /api/onboarding/progress) or present. Both cases are one SQL statement,
  // registrar_camino_onboarding (an upsert by organization_id). This test pins
  // that the route always uses it, and never a plain UPDATE that silently
  // matches 0 rows when the row is missing. The row-missing and row-present
  // behavior is tested in migration 346, autocheck (g).
  it("records camino practica with the upserting function, whether or not the row exists", async () => {
    prepararAlta()
    await POST(createPostRequest(cuerpo))
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("registrar_camino_onboarding", {
      p_org_id: "org-1",
      p_camino: "practica",
    })
    const tablas = vi.mocked(supabaseAdmin.from).mock.calls.map(([t]) => t)
    expect(tablas).not.toContain("onboarding_progress")
  })

  it("still returns 201 when recording the camino fails", async () => {
    prepararAlta()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: { message: "rpc down" } } as any)
    expect((await POST(createPostRequest(cuerpo))).status).toBe(201)
  })

  it("returns the winning practice on a concurrent double submit", async () => {
    const { ordenInsert } = prepararAlta({ clienteError: { code: "23505", message: "duplicate" }, ganadora: filaPractica })
    const { status, body } = await parseResponse(await POST(createPostRequest(cuerpo)))
    expect(status).toBe(201)
    expect(body.practica.id).toBe("ord-p")
    expect(ordenInsert).not.toHaveBeenCalled()
  })

  it("deletes its own client when the order insert loses the race", async () => {
    const { clienteDelete, clientes } = prepararAlta({
      ordenError: { code: "23505", message: "duplicate" },
      ganadora: filaPractica,
    })
    const { status } = await parseResponse(await POST(createPostRequest(cuerpo)))
    expect(status).toBe(201)
    expect(clienteDelete).toHaveBeenCalled()
    expect(clientes.eq).toHaveBeenCalledWith("id", "cli-p")
    expect(clientes.eq).toHaveBeenCalledWith("es_practica", true)
  })
})

describe("DELETE /api/onboarding/practica", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("deletes the org's practice", async () => {
    const { status, body } = await parseResponse(await DELETE())
    expect(status).toBe(200)
    expect(body).toEqual({ ok: true })
    expect(deletePracticeData).toHaveBeenCalledWith("org-1")
  })

  it("returns 500 when the deletion fails", async () => {
    vi.mocked(deletePracticeData).mockRejectedValueOnce(new Error("rpc down"))
    const { status } = await parseResponse(await DELETE())
    expect(status).toBe(500)
  })

  it("returns 403 for a non-admin", async () => {
    mockAuthSuccess({ role: "TECNICO" })
    expect((await DELETE()).status).toBe(403)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/api/onboarding-practica.test.ts`
Expected: FAIL with "Failed to resolve import "@/app/api/onboarding/practica/route"".

- [ ] **Step 3: Write the route**

Create `app/api/onboarding/practica/route.ts`:

```ts
import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { queueNotification } from "@/lib/notifications/queue"
import { sucursalParaEscritura } from "@/lib/sucursal"
import { PRACTICA_NUMERO_ORDEN } from "@/lib/onboarding/practica-shared"
import {
  PRACTICA_CODIGO_ORDEN,
  PRACTICA_ORDEN_SELECT,
  countRealOrders,
  deletePracticeData,
  getPracticaOrden,
  toPracticaOrden,
  type PracticaOrdenRow,
} from "@/lib/onboarding/practica"

// The onboarding practice order. Every query is scoped to the caller's org AND
// es_practica = true, so this endpoint cannot read or change a real order. It
// deliberately does not reuse PUT /api/ordenes/[id] or POST .../entregar: called
// with sinCobro false, entregar charges cuenta corriente (entregar/route.ts:192-211).

// required_error too: a missing field reports "Required" otherwise, not the min(1) text.
const crearSchema = z.object({
  tipoDispositivo: z.string({ required_error: "Elegí el tipo de equipo" }).trim().min(1, "Elegí el tipo de equipo"),
  dispositivo: z
    .string({ required_error: "Contanos qué equipo es" })
    .trim()
    .min(1, "Contanos qué equipo es")
    .max(120, "El nombre del equipo es muy largo"),
  problemaReportado: z
    .string({ required_error: "Contanos qué le pasa" })
    .trim()
    .min(1, "Contanos qué le pasa")
    .max(500, "La descripción es muy larga"),
})

async function leerJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

function primerError(error: z.ZodError, fallback: string): string {
  // Field messages are ours (Spanish). A missing body has no path, and an unknown
  // discriminator carries zod's English text: both get the fallback.
  return error.errors.find((e) => e.path.length > 0 && e.code !== "invalid_union_discriminator")?.message ?? fallback
}

async function registrarEvento(
  orgId: string,
  userId: string,
  ordenId: string,
  estadoAnterior: string | null,
  estadoNuevo: string,
  descripcion: string,
  metadata?: Record<string, unknown>
) {
  const { error } = await supabaseAdmin.from("orden_eventos").insert({
    orden_id: ordenId,
    organization_id: orgId,
    tipo: "CAMBIO_ESTADO",
    ...(estadoAnterior ? { estado_anterior: estadoAnterior } : {}),
    estado_nuevo: estadoNuevo,
    descripcion,
    created_by: userId,
    ...(metadata ? { metadata } : {}),
  })
  if (error) console.error("[practica] could not insert orden_evento:", error.message)
}

async function notificar(orgId: string, row: PracticaOrdenRow, estado: string, estadoAnterior: string | undefined) {
  const cliente = row.clientes
  if (!cliente) return
  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("nombre, nombre_mostrar, slug, moneda, zona_horaria")
    .eq("id", orgId)
    .single()
  try {
    // Same context shape as POST /api/ordenes (route.ts:573-599). Awaited: the
    // email is the point of the practice, and a fire-and-forget send may be cut
    // off once the response is returned.
    await queueNotification({
      organizationId: orgId,
      sucursalId: row.sucursal_id ?? null,
      ordenId: row.id,
      clienteId: cliente.id,
      tipo: "CAMBIO_ESTADO",
      context: {
        organizationName: org?.nombre_mostrar || org?.nombre || "",
        organizationSlug: org?.slug,
        moneda: org?.moneda || "ARS",
        zonaHoraria: org?.zona_horaria || "America/Argentina/Buenos_Aires",
        // Never the stored phone: the practice must not reach WhatsApp even if
        // the owner later edits the client (send-direct.ts:155 checks it).
        cliente: { id: cliente.id, nombre: cliente.nombre, email: cliente.email, telefono: "" },
        orden: {
          id: row.id,
          numeroOrden: PRACTICA_NUMERO_ORDEN,
          dispositivo: row.dispositivo,
          estado,
          estadoAnterior,
          publicToken: row.public_token,
        },
      },
    })
  } catch (err) {
    console.error("[practica] could not queue notification:", err)
  }
}

// The onboarding_progress row may be missing: signup creates it best-effort
// (app/api/auth/register/route.ts:287-292), and the new wizard no longer calls
// GET /api/onboarding/progress, which used to create it on mount. Both writes
// below therefore upsert by organization_id.

async function registrarCaminoPractica(orgId: string) {
  // Atomic upsert in SQL (migration 346, registrar_camino_onboarding): creates
  // the row when missing; 'practica' always wins. The practice already exists
  // at this point, so a failure here is logged, never returned.
  try {
    const { error } = await supabaseAdmin.rpc("registrar_camino_onboarding", {
      p_org_id: orgId,
      p_camino: "practica",
    })
    if (error) console.error("[practica] could not record camino:", error.message)
  } catch (err) {
    console.error("[practica] could not record camino:", err)
  }
}

async function practicaGanadora(orgId: string) {
  const practica = await getPracticaOrden(orgId)
  if (practica) return NextResponse.json({ practica }, { status: 201 })
  return NextResponse.json(
    { error: "No pudimos preparar la práctica. Probá de nuevo en un momento." },
    { status: 409 }
  )
}

export async function GET() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error
    return NextResponse.json({ practica: await getPracticaOrden(organizationId!) })
  } catch (err) {
    console.error("Error reading the practice order:", err)
    return NextResponse.json({ error: "No pudimos leer la práctica" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { error, session, organizationId, userId, role } = await requireAdmin()
    if (error) return error
    const orgId = organizationId!

    const parsed = crearSchema.safeParse(await leerJson(request))
    if (!parsed.success) {
      return NextResponse.json({ error: primerError(parsed.error, "Datos inválidos") }, { status: 400 })
    }
    const data = parsed.data

    // Reports are not filtered because the practice never coexists with real
    // orders. Refusing it here keeps that true.
    if ((await countRealOrders(orgId)) > 0) {
      return NextResponse.json(
        { error: "Ya cargaste órdenes reales: la práctica es para antes de la primera." },
        { status: 409 }
      )
    }

    const { data: tipo } = await supabaseAdmin
      .from("tipos_dispositivo")
      .select("codigo")
      .eq("organization_id", orgId)
      .eq("codigo", data.tipoDispositivo)
      .eq("activo", true)
      .maybeSingle()
    if (!tipo) {
      return NextResponse.json({ error: "Ese tipo de equipo no está disponible" }, { status: 400 })
    }

    const { data: owner } = await supabaseAdmin
      .from("users")
      .select("nombre, email")
      .eq("id", userId!)
      .eq("organization_id", orgId)
      .maybeSingle()
    if (!owner?.email) {
      return NextResponse.json({ error: "No encontramos el email de tu usuario" }, { status: 400 })
    }

    const sucursalId = await sucursalParaEscritura({
      role,
      organizationId: orgId,
      userSucursalId: session!.user.sucursalId ?? null,
    })
    if (!sucursalId) {
      return NextResponse.json({ error: "La organización no tiene sucursal principal configurada" }, { status: 500 })
    }

    // A second POST replaces the practice.
    await deletePracticeData(orgId)

    const { data: cliente, error: clienteError } = await supabaseAdmin
      .from("clientes")
      .insert({
        organization_id: orgId,
        nombre: owner.nombre || owner.email,
        email: owner.email,
        // telefono is NOT NULL (001_schema.sql:161). Empty, so no WhatsApp path
        // fires: they all check it for truthiness.
        telefono: "",
        acepta_whatsapp: false,
        es_practica: true,
      })
      .select("id")
      .single()
    if (clienteError) {
      // 23505 on UNIQUE(organization_id, telefono): a concurrent submit created
      // the practice client first. Return its practice instead of an error.
      if (clienteError.code === "23505") return await practicaGanadora(orgId)
      throw clienteError
    }

    const { data: orden, error: ordenError } = await supabaseAdmin
      .from("ordenes_servicio")
      .insert({
        numero_orden: PRACTICA_NUMERO_ORDEN,
        codigo_orden: PRACTICA_CODIGO_ORDEN,
        es_practica: true,
        organization_id: orgId,
        sucursal_id: sucursalId,
        cliente_id: cliente.id,
        tipo_dispositivo: data.tipoDispositivo,
        dispositivo: data.dispositivo,
        problema_reportado: data.problemaReportado,
        // Same generator as POST /api/ordenes (route.ts:23-25). Expiry is not
        // set on create there either.
        public_token: randomBytes(16).toString("hex"),
        estado: "RECIBIDO",
        recibido_por: userId,
      })
      .select(PRACTICA_ORDEN_SELECT)
      .single()
    if (ordenError) {
      // Nothing references the client inserted above, so this delete cannot
      // cascade into real data.
      await supabaseAdmin
        .from("clientes")
        .delete()
        .eq("id", cliente.id)
        .eq("organization_id", orgId)
        .eq("es_practica", true)
      // 23505 on UNIQUE(organization_id, numero_orden): the concurrent submit won.
      if (ordenError.code === "23505") return await practicaGanadora(orgId)
      throw ordenError
    }

    const row = orden as unknown as PracticaOrdenRow
    await registrarEvento(orgId, userId!, row.id, null, "RECIBIDO", "Orden de práctica creada")
    await notificar(orgId, row, "RECIBIDO", undefined)
    await registrarCaminoPractica(orgId)

    return NextResponse.json({ practica: toPracticaOrden(row) }, { status: 201 })
  } catch (err) {
    console.error("Error creating the practice order:", err)
    return NextResponse.json({ error: "No pudimos crear la práctica" }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error
    await deletePracticeData(organizationId!)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("Error deleting the practice order:", err)
    return NextResponse.json({ error: "No pudimos borrar la práctica" }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/api/onboarding-practica.test.ts`
Expected: PASS, 17 tests.

Run: `npx tsc --noEmit` and `npx eslint app/api/onboarding __tests__/api/onboarding-practica.test.ts`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add app/api/onboarding/practica/route.ts __tests__/api/onboarding-practica.test.ts
git commit -m "feat(onboarding): create, read and delete the practice order"
```

---

### Task 4: Practice endpoint — PATCH (reparar, entregar)

**Files:**
- Modify: `app/api/onboarding/practica/route.ts`
- Test: `__tests__/api/onboarding-practica-avance.test.ts`

**Interfaces:**
- Consumes (Task 3, same file): `leerJson`, `primerError`, `registrarEvento`, `notificar`. From Task 2: `PRACTICA_ORDEN_SELECT`, `toPracticaOrden`, `PracticaOrdenRow`. Also `MOTIVO_SIN_COBRO_LABELS` (`lib/seguimiento-state.ts:176`).
- Produces: `PATCH` per the HTTP block.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/api/onboarding-practica-avance.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

vi.mock("@/lib/notifications/queue", () => ({
  queueNotification: vi.fn().mockResolvedValue(undefined),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { queueNotification } from "@/lib/notifications/queue"
import { PATCH } from "@/app/api/onboarding/practica/route"

const org = {
  nombre: "Taller",
  nombre_mostrar: "Taller Luis",
  slug: "taller",
  moneda: "ARS",
  zona_horaria: "America/Argentina/Buenos_Aires",
}
const base = {
  id: "ord-p",
  public_token: "a".repeat(32),
  tipo_dispositivo: "CELULAR",
  dispositivo: "Moto G",
  problema_reportado: "No enciende",
  sucursal_id: "suc-1",
  cliente_id: "cli-p",
  clientes: { id: "cli-p", nombre: "Luis", email: "luis@taller.com" },
}
const recibida = { ...base, estado: "RECIBIDO", costo_final: null, fecha_completado: null }
const enReparacion = { ...recibida, estado: "EN_REPARACION" }
const reparada = { ...base, estado: "REPARADO", costo_final: "15000.00", fecha_completado: "2026-10-11T15:00:00.000Z" }
const entregada = { ...reparada, estado: "ENTREGADO_SIN_COBRO" }

function patch(body: unknown) {
  return new Request("http://localhost/api/onboarding/practica", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

// Each maybeSingle() call resolves the next value: the load, then each update.
function preparar(...respuestas: unknown[]) {
  const ordenes = createChainMock(null)
  const maybeSingle = vi.fn()
  for (const data of respuestas) maybeSingle.mockResolvedValueOnce({ data, error: null })
  ordenes.maybeSingle = maybeSingle
  const update = vi.fn().mockReturnValue(ordenes)
  ordenes.update = update

  const eventos = createChainMock(null)
  const eventoInsert = vi.fn().mockReturnValue(eventos)
  eventos.insert = eventoInsert

  const progreso = createChainMock(null)
  const progresoUpsert = vi.fn().mockReturnValue(progreso)
  progreso.upsert = progresoUpsert

  mockSupabaseFrom({
    ordenes_servicio: ordenes,
    orden_eventos: eventos,
    organizations: createChainMock(org),
    onboarding_progress: progreso,
  })
  return { ordenes, maybeSingle, update, eventoInsert, progresoUpsert }
}

describe("PATCH /api/onboarding/practica", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("returns 403 for a non-admin", async () => {
    mockAuthSuccess({ role: "TECNICO" })
    expect((await PATCH(patch({ accion: "entregar" }))).status).toBe(403)
  })

  it("returns 404 when the org has no practice", async () => {
    preparar(null)
    expect((await PATCH(patch({ accion: "entregar" }))).status).toBe(404)
  })

  it("rejects reparar without a positive price before reading the order", async () => {
    const { maybeSingle } = preparar(recibida)
    const { status, body } = await parseResponse(await PATCH(patch({ accion: "reparar", costoFinal: 0 })))
    expect(status).toBe(400)
    expect(body.error).toBe("El precio tiene que ser mayor a cero")
    expect(maybeSingle).not.toHaveBeenCalled()
  })

  it("rejects an unknown accion", async () => {
    preparar(recibida)
    const { status, body } = await parseResponse(await PATCH(patch({ accion: "cobrar" })))
    expect(status).toBe(400)
    expect(body.error).toBe("Acción inválida")
  })

  it("reparar writes EN_REPARACION then REPARADO, one event each, scoped to the org's practice", async () => {
    const { update, ordenes, eventoInsert } = preparar(recibida, { id: "ord-p" }, reparada)
    const { status, body } = await parseResponse(await PATCH(patch({ accion: "reparar", costoFinal: 15000 })))

    expect(status).toBe(200)
    expect(body.practica).toMatchObject({ estado: "REPARADO", costoFinal: 15000 })
    expect(update).toHaveBeenCalledTimes(2)
    expect(update.mock.calls[0][0]).toEqual({ estado: "EN_REPARACION" })
    expect(update.mock.calls[1][0]).toMatchObject({ estado: "REPARADO", costo_final: 15000 })
    expect(typeof update.mock.calls[1][0].fecha_completado).toBe("string")
    expect(ordenes.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(ordenes.eq).toHaveBeenCalledWith("es_practica", true)
    expect(ordenes.eq).toHaveBeenCalledWith("estado", "RECIBIDO")
    expect(ordenes.eq).toHaveBeenCalledWith("estado", "EN_REPARACION")
    expect(eventoInsert.mock.calls.map(([e]: any[]) => [e.estado_anterior, e.estado_nuevo])).toEqual([
      ["RECIBIDO", "EN_REPARACION"],
      ["EN_REPARACION", "REPARADO"],
    ])
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  // Review Focus #5
  it("reparar queues exactly one notification, for REPARADO", async () => {
    preparar(recibida, { id: "ord-p" }, reparada)
    await PATCH(patch({ accion: "reparar", costoFinal: 15000 }))
    expect(queueNotification).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(queueNotification).mock.calls[0][0]
    expect(arg.context.orden).toMatchObject({ estado: "REPARADO", estadoAnterior: "EN_REPARACION", numeroOrden: 0 })
    expect(arg.context.cliente.telefono).toBe("")
  })

  it("reparar resumes an order left in EN_REPARACION without writing EN_REPARACION again", async () => {
    const { update, eventoInsert } = preparar(enReparacion, reparada)
    const { status } = await parseResponse(await PATCH(patch({ accion: "reparar", costoFinal: 15000 })))
    expect(status).toBe(200)
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0][0]).toMatchObject({ estado: "REPARADO" })
    expect(eventoInsert).toHaveBeenCalledTimes(1)
  })

  // Review Focus #5
  it("a second reparar returns 409 and sends nothing", async () => {
    const { update } = preparar(reparada)
    const { status } = await parseResponse(await PATCH(patch({ accion: "reparar", costoFinal: 15000 })))
    expect(status).toBe(409)
    expect(update).not.toHaveBeenCalled()
    expect(queueNotification).not.toHaveBeenCalled()
  })

  it("reparar returns 409 when a concurrent request moved the order first", async () => {
    const { update } = preparar(recibida, null)
    const { status } = await parseResponse(await PATCH(patch({ accion: "reparar", costoFinal: 15000 })))
    expect(status).toBe(409)
    expect(update).toHaveBeenCalledTimes(1)
    expect(queueNotification).not.toHaveBeenCalled()
  })

  it("entregar ends in ENTREGADO_SIN_COBRO as a courtesy and records the practice completion", async () => {
    const { update, eventoInsert, progresoUpsert } = preparar(reparada, entregada)
    const { status, body } = await parseResponse(await PATCH(patch({ accion: "entregar" })))

    expect(status).toBe(200)
    expect(body.practica.estado).toBe("ENTREGADO_SIN_COBRO")
    const cambios = update.mock.calls[0][0]
    expect(cambios).toMatchObject({
      estado: "ENTREGADO_SIN_COBRO",
      motivo_sin_cobro: "CORTESIA",
      entregado_por_user_id: "user-1",
    })
    expect(typeof cambios.fecha_entrega).toBe("string")
    // fecha_completado was set at REPARADO and must not move.
    expect(cambios).not.toHaveProperty("fecha_completado")
    expect(eventoInsert.mock.calls[0][0]).toMatchObject({
      estado_anterior: "REPARADO",
      estado_nuevo: "ENTREGADO_SIN_COBRO",
      metadata: { motivoSinCobro: "CORTESIA" },
    })
    expect(queueNotification).toHaveBeenCalledTimes(1)
    expect(vi.mocked(queueNotification).mock.calls[0][0].context.orden?.estado).toBe("ENTREGADO_SIN_COBRO")
    expect(progresoUpsert).toHaveBeenCalledWith(
      { organization_id: "org-1", practica_completada_at: cambios.fecha_entrega },
      { onConflict: "organization_id" }
    )
  })

  // Review Focus #1
  it("entregar never touches money, stock or warranties", async () => {
    preparar(reparada, entregada)
    await PATCH(patch({ accion: "entregar" }))
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
    const tablas = vi.mocked(supabaseAdmin.from).mock.calls.map(([t]) => t)
    for (const t of ["cobros_orden", "cuenta_corriente", "movimientos_caja", "garantias", "repuestos_orden", "facturas"]) {
      expect(tablas).not.toContain(t)
    }
  })

  it("entregar returns 409 before the repair", async () => {
    const { update } = preparar(recibida)
    expect((await PATCH(patch({ accion: "entregar" }))).status).toBe(409)
    expect(update).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/api/onboarding-practica-avance.test.ts`
Expected: FAIL. `PATCH` is not exported, so the calls throw "PATCH is not a function".

- [ ] **Step 3: Add the PATCH handler**

In `app/api/onboarding/practica/route.ts`, add this import after the `sucursalParaEscritura` import:

```ts
import { MOTIVO_SIN_COBRO_LABELS } from "@/lib/seguimiento-state"
```

Add after `crearSchema`:

```ts
const avanceSchema = z.discriminatedUnion("accion", [
  z.object({
    accion: z.literal("reparar"),
    costoFinal: z
      .number({ required_error: "Ingresá el precio", invalid_type_error: "El precio tiene que ser un número" })
      .positive("El precio tiene que ser mayor a cero")
      .max(99_999_999.99, "El precio es demasiado alto"),
  }),
  z.object({ accion: z.literal("entregar") }),
])

function conflicto() {
  return NextResponse.json({ error: "La práctica ya pasó por este paso" }, { status: 409 })
}

// Upsert by organization_id: the row may be missing (see registrarCaminoPractica).
async function guardarProgreso(orgId: string, campos: { practica_completada_at: string }) {
  const { error } = await supabaseAdmin
    .from("onboarding_progress")
    .upsert({ organization_id: orgId, ...campos }, { onConflict: "organization_id" })
  if (error) console.error("[practica] could not update onboarding_progress:", error.message)
}

async function cargarPractica(orgId: string): Promise<PracticaOrdenRow | null> {
  const { data, error } = await supabaseAdmin
    .from("ordenes_servicio")
    .select(PRACTICA_ORDEN_SELECT)
    .eq("organization_id", orgId)
    .eq("es_practica", true)
    .maybeSingle()
  if (error) throw error
  return (data as unknown as PracticaOrdenRow | null) ?? null
}

// RECIBIDO cannot jump to REPARADO (lib/orden-state-machine.ts:12), so the
// practice walks EN_REPARACION -> REPARADO like a real order. Each write is
// conditional on the expected estado: a double click loses with 409 and sends
// nothing, so the REPARADO email goes out once.
async function reparar(orgId: string, userId: string, actual: PracticaOrdenRow, costoFinal: number) {
  if (actual.estado !== "RECIBIDO" && actual.estado !== "EN_REPARACION") return conflicto()

  if (actual.estado === "RECIBIDO") {
    const { data: movida, error } = await supabaseAdmin
      .from("ordenes_servicio")
      .update({ estado: "EN_REPARACION" })
      .eq("id", actual.id)
      .eq("organization_id", orgId)
      .eq("es_practica", true)
      .eq("estado", "RECIBIDO")
      .select("id")
      .maybeSingle()
    if (error) throw error
    if (!movida) return conflicto()
    await registrarEvento(orgId, userId, actual.id, "RECIBIDO", "EN_REPARACION", "Estado cambiado de RECIBIDO a EN_REPARACION")
  }

  const { data: reparada, error } = await supabaseAdmin
    .from("ordenes_servicio")
    .update({
      estado: "REPARADO",
      // EN_REPARACION -> REPARADO requires costo_final > 0 (orden-state-machine.ts:77-83).
      costo_final: costoFinal,
      fecha_completado: actual.fecha_completado ?? new Date().toISOString(),
    })
    .eq("id", actual.id)
    .eq("organization_id", orgId)
    .eq("es_practica", true)
    .eq("estado", "EN_REPARACION")
    .select(PRACTICA_ORDEN_SELECT)
    .maybeSingle()
  if (error) throw error
  if (!reparada) return conflicto()

  const row = reparada as unknown as PracticaOrdenRow
  await registrarEvento(orgId, userId, row.id, "EN_REPARACION", "REPARADO", "Estado cambiado de EN_REPARACION a REPARADO")
  await notificar(orgId, row, "REPARADO", "EN_REPARACION")
  return NextResponse.json({ practica: toPracticaOrden(row) })
}

// Writes the delivery directly. No cobros_orden, no cargar_deuda_cuenta_corriente,
// no garantía, no stock: the practice must never reach caja, arqueo, ARCA or stock.
async function entregar(orgId: string, userId: string, actual: PracticaOrdenRow) {
  if (actual.estado !== "REPARADO") return conflicto()

  const ahora = new Date().toISOString()
  const { data: entregada, error } = await supabaseAdmin
    .from("ordenes_servicio")
    .update({
      estado: "ENTREGADO_SIN_COBRO",
      motivo_sin_cobro: "CORTESIA",
      fecha_entrega: ahora,
      entregado_por_user_id: userId,
      ...(actual.fecha_completado ? {} : { fecha_completado: ahora }),
    })
    .eq("id", actual.id)
    .eq("organization_id", orgId)
    .eq("es_practica", true)
    .eq("estado", "REPARADO")
    .select(PRACTICA_ORDEN_SELECT)
    .maybeSingle()
  if (error) throw error
  if (!entregada) return conflicto()

  const row = entregada as unknown as PracticaOrdenRow
  await registrarEvento(
    orgId,
    userId,
    row.id,
    "REPARADO",
    "ENTREGADO_SIN_COBRO",
    `Estado cambiado de REPARADO a ENTREGADO_SIN_COBRO · Motivo: ${MOTIVO_SIN_COBRO_LABELS.CORTESIA}`,
    { motivoSinCobro: "CORTESIA" }
  )
  await notificar(orgId, row, "ENTREGADO_SIN_COBRO", "REPARADO")
  await guardarProgreso(orgId, { practica_completada_at: ahora })
  return NextResponse.json({ practica: toPracticaOrden(row) })
}
```

Add after `POST`:

```ts
export async function PATCH(request: Request) {
  try {
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error
    const orgId = organizationId!

    const parsed = avanceSchema.safeParse(await leerJson(request))
    if (!parsed.success) {
      return NextResponse.json({ error: primerError(parsed.error, "Acción inválida") }, { status: 400 })
    }

    const actual = await cargarPractica(orgId)
    if (!actual) {
      return NextResponse.json({ error: "No hay una práctica en curso" }, { status: 404 })
    }

    return parsed.data.accion === "reparar"
      ? await reparar(orgId, userId!, actual, parsed.data.costoFinal)
      : await entregar(orgId, userId!, actual)
  } catch (err) {
    console.error("Error advancing the practice order:", err)
    return NextResponse.json({ error: "No pudimos avanzar la práctica" }, { status: 500 })
  }
}
```

`primerError` (Task 3) returns the first field issue, so a zero price yields "El precio tiene que ser mayor a cero". It skips `invalid_union_discriminator`, so an unknown `accion` gets "Acción inválida", as the 400 test pins.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/api/onboarding-practica-avance.test.ts __tests__/api/onboarding-practica.test.ts`
Expected: PASS, 12 tests in the new file and 17 in the Task 3 file.

Run: `npx tsc --noEmit` and `npx eslint app/api/onboarding __tests__/api/onboarding-practica-avance.test.ts`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add app/api/onboarding/practica/route.ts __tests__/api/onboarding-practica-avance.test.ts
git commit -m "feat(onboarding): repair and deliver the practice order"
```

---

### Task 5: `camino` in `POST /api/onboarding/complete`

**Files:**
- Modify: `app/api/onboarding/complete/route.ts` (whole file, 27 lines)
- Test: `__tests__/api/onboarding-complete.test.ts`

**Interfaces:**
- Consumes: the RPC `registrar_camino_onboarding(p_org_id, p_camino)` and the `camino` CHECK (Task 1).
- Produces: `POST(request)` with optional body `{ camino?: "real" | "omitido" }`. The current caller (`components/onboarding/onboarding-wizard.tsx:212`, no body) keeps working.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/api/onboarding-complete.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"
import { POST } from "@/app/api/onboarding/complete/route"

function preparar() {
  const organizations = createChainMock(null)
  const progreso = createChainMock(null)
  const update = vi.fn().mockReturnValue(progreso)
  progreso.update = update
  mockSupabaseFrom({ organizations, onboarding_progress: progreso })
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: "real", error: null } as any)
  return { organizations, progreso, update }
}

function pedido(body?: string) {
  return new Request("http://localhost/api/onboarding/complete", {
    method: "POST",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body }),
  })
}

describe("POST /api/onboarding/complete", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("completes without a body, as the current wizard calls it", async () => {
    const { organizations, update } = preparar()
    const { status } = await parseResponse(await POST(pedido()))
    expect(status).toBe(200)
    expect(organizations.update).toHaveBeenCalledWith({ onboarding_completed: true })
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0][0]).toHaveProperty("completed_at")
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  // Row missing or present is one SQL statement (registrar_camino_onboarding,
  // an upsert by organization_id), so the route has one path for both. These
  // two tests pin that every camino goes through it, never through a plain
  // UPDATE that matches 0 rows when the row is missing. The row-missing,
  // row-present and "omitido never overwrites" behavior is tested in
  // migration 346, autocheck (g).
  it("records camino real with the upserting function", async () => {
    const { update } = preparar()
    const { status } = await parseResponse(await POST(pedido(JSON.stringify({ camino: "real" }))))
    expect(status).toBe(200)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("registrar_camino_onboarding", {
      p_org_id: "org-1",
      p_camino: "real",
    })
    expect(update.mock.calls.some(([c]: any[]) => "camino" in c)).toBe(false)
  })

  it("records camino omitido with the upserting function", async () => {
    const { update } = preparar()
    await POST(pedido(JSON.stringify({ camino: "omitido" })))
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("registrar_camino_onboarding", {
      p_org_id: "org-1",
      p_camino: "omitido",
    })
    expect(update.mock.calls.some(([c]: any[]) => "camino" in c)).toBe(false)
  })

  it("still completes when recording the camino fails", async () => {
    preparar()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: { message: "rpc down" } } as any)
    expect((await POST(pedido(JSON.stringify({ camino: "real" })))).status).toBe(200)
  })

  it("rejects a camino the wizard cannot send", async () => {
    const { organizations } = preparar()
    const { status } = await parseResponse(await POST(pedido(JSON.stringify({ camino: "practica" }))))
    expect(status).toBe(400)
    expect(organizations.update).not.toHaveBeenCalled()
  })

  it("rejects malformed JSON", async () => {
    preparar()
    expect((await POST(pedido("{"))).status).toBe(400)
  })

  it("returns 403 for a non-admin", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    expect((await POST(pedido())).status).toBe(403)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/api/onboarding-complete.test.ts`
Expected: FAIL. The two "records camino ... with the upserting function" tests fail because `rpc` is never called, and "rejects a camino..." gets 200 instead of 400.

- [ ] **Step 3: Rewrite the route**

Replace `app/api/onboarding/complete/route.ts` with:

```ts
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

// "practica" is not accepted here: only the practice POST sets it.
const completeSchema = z.object({
  camino: z.enum(["real", "omitido"]).optional(),
})

async function leerCuerpo(request: Request): Promise<unknown> {
  const raw = await request.text()
  if (!raw.trim()) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// The onboarding_progress row may be missing: signup creates it best-effort
// (app/api/auth/register/route.ts:287-292), and the new wizard no longer calls
// GET /api/onboarding/progress, which used to create it on mount. So the camino
// goes through registrar_camino_onboarding (migration 346): one upsert by
// organization_id that creates the row when missing, lets "omitido" only fill an
// empty camino, and never overwrites "practica" (a shop that practiced and then
// skipped still counts as practice). The camino is metric data: a failure is
// logged and never fails the completion.
async function guardarCamino(organizationId: string, camino: "real" | "omitido") {
  try {
    const { error } = await supabaseAdmin.rpc("registrar_camino_onboarding", {
      p_org_id: organizationId,
      p_camino: camino,
    })
    if (error) console.error("[onboarding] could not record camino:", error.message)
  } catch (err) {
    console.error("[onboarding] could not record camino:", err)
  }
}

export async function POST(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const parsed = completeSchema.safeParse(await leerCuerpo(request))
    if (!parsed.success) {
      return NextResponse.json({ error: "Camino inválido" }, { status: 400 })
    }

    // Marcar onboarding como completado
    await supabaseAdmin
      .from("organizations")
      .update({ onboarding_completed: true })
      .eq("id", organizationId!)

    await supabaseAdmin
      .from("onboarding_progress")
      .update({ completed_at: new Date().toISOString() })
      .eq("organization_id", organizationId!)

    if (parsed.data.camino) await guardarCamino(organizationId!, parsed.data.camino)

    return NextResponse.json({ message: "Onboarding completado" })
  } catch (err) {
    console.error("Error completing onboarding:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/api/onboarding-complete.test.ts __tests__/components/onboarding-wizard-primera-orden.test.tsx`
Expected: PASS. The wizard suite mocks `fetch` and must stay green.

Run: `npx tsc --noEmit` and `npx eslint app/api/onboarding __tests__/api/onboarding-complete.test.ts`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add app/api/onboarding/complete/route.ts __tests__/api/onboarding-complete.test.ts
git commit -m "feat(onboarding): record the wizard path on completion"
```

---

### Task 6: Delete the practice after every real-order insert

**Files:**
- Modify: `app/api/ordenes/route.ts` (import; hook after line 471)
- Modify: `app/api/recepciones/route.ts` (import; hook after line 129)
- Modify: `app/api/cotizaciones/[id]/convertir-orden/route.ts` (import; hook after line 185)
- Modify: `app/api/ordenes/[id]/reingreso/route.ts` (import; hook after line 105)
- Modify: `app/api/garantias/[id]/reclamos/route.ts` (import; hook after line 162)
- Test: `__tests__/lib/practica-borrado-sweep.test.ts` (create)
- Test: `__tests__/api/ordenes.test.ts`, `__tests__/api/recepcion-multiple-atomica.test.ts`, `__tests__/api/cotizaciones-convertir-orden.test.ts`, `__tests__/api/reingreso.test.ts` (modify)
- Test: `__tests__/api/garantias-reclamos-practica.test.ts` (create)

**Interfaces:**
- Consumes (Task 2): `deletePracticeData(organizationId)`. It is globally mocked in tests and resolves `{ ordenBorrada: false, clienteConservado: false }`.
- Produces: the invariant "a real order never coexists with the practice" (Review Focus #3). See Decision needed #1.

- [ ] **Step 1: Write the failing sweep test**

Create `__tests__/lib/practica-borrado-sweep.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

// Every code path that inserts real orders must delete the onboarding practice
// afterwards (spec: "deleted when the first real order is created").
const ROOT = process.cwd()
const SCAN = ["app", "lib"]
const INSERTA_ORDEN = /\.from\(\s*["']ordenes_servicio["']\s*\)\s*\.insert\(|rpc\(\s*["']crear_recepcion_multiple["']/

// Inserts that are not a shop's real work.
const EXENTOS = new Set([
  "app/api/onboarding/practica/route.ts", // the practice itself
  "app/api/onboarding/seed-demo-data/route.ts", // demo data, explicit action
  "lib/onboarding/sample-data.ts", // sample data, explicit action
])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".") || name === "__tests__") continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

describe("real-order insert paths", () => {
  it("all call deletePracticeData", () => {
    const sinBorrado = SCAN.flatMap((d) => walk(join(ROOT, d)))
      .map((f) => ({ rel: relative(ROOT, f).split(sep).join("/"), src: readFileSync(f, "utf8") }))
      .filter(({ rel, src }) => INSERTA_ORDEN.test(src) && !EXENTOS.has(rel) && !src.includes("deletePracticeData("))
      .map(({ rel }) => rel)
      .sort()
    expect(sinBorrado).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/lib/practica-borrado-sweep.test.ts`
Expected: FAIL. The received array lists `app/api/cotizaciones/[id]/convertir-orden/route.ts`, `app/api/garantias/[id]/reclamos/route.ts`, `app/api/ordenes/[id]/reingreso/route.ts`, `app/api/ordenes/route.ts` and `app/api/recepciones/route.ts`.

- [ ] **Step 3: Write the per-path failing tests**

In `__tests__/api/ordenes.test.ts`, add `import { deletePracticeData } from "@/lib/onboarding/practica"` after line 49. Add inside `describe("POST /api/ordenes", ...)`, after the "creates an order successfully" test:

```ts
  it("deletes the onboarding practice once a real order is created", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      ordenes_servicio: createChainMock({ id: "o-real", numero_orden: 1, public_token: "t", estado: "RECIBIDO", clientes: { id: "c1", nombre: "Juan" } }),
      organizations: createChainMock({ nombre: "Mi Taller", nombre_mostrar: "Mi Taller Pro" }),
    })

    const response = await POST(
      createPostRequest({ clienteId: "c1", dispositivo: "iPhone 14", tipoDispositivo: "CELULAR", problemaReportado: "No enciende" })
    )

    expect(response.status).toBe(201)
    expect(deletePracticeData).toHaveBeenCalledTimes(1)
    expect(deletePracticeData).toHaveBeenCalledWith("org-1")
  })

  it("still returns 201 when deleting the practice fails", async () => {
    mockAuthSuccess()
    vi.mocked(deletePracticeData).mockRejectedValueOnce(new Error("rpc down"))
    mockSupabaseFrom({
      ordenes_servicio: createChainMock({ id: "o-real", numero_orden: 1, public_token: "t", estado: "RECIBIDO", clientes: { id: "c1", nombre: "Juan" } }),
      organizations: createChainMock({ nombre: "Mi Taller", nombre_mostrar: "Mi Taller Pro" }),
    })

    const response = await POST(
      createPostRequest({ clienteId: "c1", dispositivo: "iPhone 14", tipoDispositivo: "CELULAR", problemaReportado: "No enciende" })
    )

    expect(response.status).toBe(201)
  })

  it("does not delete the practice when the order is not created", async () => {
    mockAuthSuccess()
    vi.mocked(enforcePlanLimit).mockResolvedValueOnce(
      NextResponse.json({ error: "Límite de órdenes alcanzado" }, { status: 403 }) as any
    )

    const response = await POST(
      createPostRequest({ clienteId: "c1", dispositivo: "iPhone 14", tipoDispositivo: "CELULAR", problemaReportado: "No enciende" })
    )

    expect(response.status).toBe(403)
    expect(deletePracticeData).not.toHaveBeenCalled()
  })
```

In `__tests__/api/recepcion-multiple-atomica.test.ts`, add `import { deletePracticeData } from "@/lib/onboarding/practica"` after line 25. Add at the end of the `describe`:

```ts
  it("borra la práctica del onboarding cuando la recepción crea órdenes reales", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: rpcOk, error: null } as any)
    const res = await POST(createPostRequest(body))
    expect(res.status).toBe(201)
    expect(deletePracticeData).toHaveBeenCalledWith("org-1")
  })

  it("no borra la práctica si la RPC falla", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: { message: "error" } } as any)
    const res = await POST(createPostRequest(body))
    expect(res.status).toBe(500)
    expect(deletePracticeData).not.toHaveBeenCalled()
  })
```

In `__tests__/api/cotizaciones-convertir-orden.test.ts`, add `import { deletePracticeData } from "@/lib/onboarding/practica"` after line 27. Add inside the `describe`:

```ts
  it("deletes the onboarding practice after converting the presupuesto", async () => {
    mockAuthSuccess()
    vi.mocked(sucursalParaEscritura).mockResolvedValue("suc-A")
    const eventosChain = createChainMock(null)
    const cotizUpdateChain = createChainMock(null)
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "cotizaciones") {
        const chain: any = createChainMock(mockCotizacion)
        chain.update = vi.fn().mockReturnValue(cotizUpdateChain)
        return chain
      }
      if (table === "ordenes_servicio") {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: mockOrden, error: null }),
          }),
        } as any
      }
      if (table === "orden_eventos") return eventosChain as any
      return createChainMock(null) as any
    })

    const response = await POST(createPostRequest({}), createParams("cot-1"))

    expect(response.status).toBe(201)
    expect(deletePracticeData).toHaveBeenCalledWith("org-1")
  })
```

In `__tests__/api/reingreso.test.ts`, add `import { deletePracticeData } from "@/lib/onboarding/practica"` after line 29. Add inside the `describe`:

```ts
  it("deletes the onboarding practice after creating the reingreso", async () => {
    mockAuthSuccess()
    const ordenChain = createChainMock(null)
    let singleCallCount = 0
    ordenChain.single = vi.fn().mockImplementation(() => {
      singleCallCount++
      if (singleCallCount === 1) return Promise.resolve({ data: createMockOrdenOriginal({ estado: "ENTREGADO" }), error: null })
      return Promise.resolve({ data: { id: "o2", numero_orden: 2, codigo_orden: "CEL-002", clientes: { id: "c1", nombre: "Juan" } }, error: null })
    })
    mockSupabaseFrom({ ordenes_servicio: ordenChain, orden_eventos: createChainMock(null) })

    const response = await POST(createPostRequest({ problemaReportado: "Problema recurrente" }), createParams("o1"))

    expect(response.status).toBe(201)
    expect(deletePracticeData).toHaveBeenCalledWith("org-1")
  })
```

Create `__tests__/api/garantias-reclamos-practica.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom } from "./helpers"

vi.mock("@/lib/counters", () => ({
  getNextOrderNumber: vi.fn().mockResolvedValue(7),
}))

import { deletePracticeData } from "@/lib/onboarding/practica"
import { PUT } from "@/app/api/garantias/[id]/reclamos/route"

const reclamo = {
  id: "r1",
  garantia_id: "g1",
  descripcion: "Volvió a fallar",
  orden_reparacion_id: null,
  garantias: {
    id: "g1",
    ordenes_servicio: {
      id: "o1",
      organization_id: "org-1",
      cliente_id: "c1",
      dispositivo: "iPhone 13",
      tipo_dispositivo: "CELULAR",
      numero_orden: 3,
    },
  },
}

describe("PUT /api/garantias/[id]/reclamos — practice cleanup", () => {
  beforeEach(() => vi.clearAllMocks())

  it("deletes the onboarding practice after creating the repair order", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      reclamos_garantia: createChainMock(reclamo),
      ordenes_servicio: createChainMock({ id: "ord-r" }),
      orden_eventos: createChainMock(null),
    })

    const res = await PUT(
      new Request("http://localhost/api/garantias/g1/reclamos?reclamoId=r1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: "ACEPTADO", crearOrden: true }),
      }),
      { params: Promise.resolve({ id: "g1" }) }
    )

    expect(res.status).toBe(200)
    expect(deletePracticeData).toHaveBeenCalledWith("org-1")
  })
})
```

- [ ] **Step 4: Run them to verify they fail**

Run: `npx vitest run __tests__/api/ordenes.test.ts __tests__/api/recepcion-multiple-atomica.test.ts __tests__/api/cotizaciones-convertir-orden.test.ts __tests__/api/reingreso.test.ts __tests__/api/garantias-reclamos-practica.test.ts`
Expected: FAIL. Each new "deletes the onboarding practice..." test fails with "expected "spy" to be called with arguments: [ 'org-1' ]". The "does not delete" and "no borra" tests already pass, which is correct.

- [ ] **Step 5: Add the hook to the five paths**

Add the import `import { deletePracticeData } from "@/lib/onboarding/practica"` to each of the five route files, next to their other `@/lib` imports.

In `app/api/ordenes/route.ts`, insert after line 471 (the closing `}` of `if (turnoOrigen) { ... }`), before `// Si hay seña, crear cobro_orden y actualizar total_cobrado`:

```ts
    // The first real order replaces the onboarding practice. A failure never
    // affects this order: the next real order retries.
    try {
      await deletePracticeData(organizationId!)
    } catch (err) {
      console.error("[practica] automatic deletion failed:", err)
    }
```

In `app/api/recepciones/route.ts`, insert the same block after line 129 (after the `if (rpcError) { ... }` block, before `const recepcion = rpcResult.recepcion ...`).

In `app/api/cotizaciones/[id]/convertir-orden/route.ts`, insert the same block after line 185 (after `if (ordenError) { throw ordenError }`, before `// Crear garantía si corresponde`).

In `app/api/ordenes/[id]/reingreso/route.ts`, insert the same block after line 105 (`if (insertError) throw insertError`).

In `app/api/garantias/[id]/reclamos/route.ts`, insert after line 162 (`ordenReparacionId = nuevaOrden.id`). This route's org variable is `orgId`:

```ts
      // The first real order replaces the onboarding practice. A failure never
      // affects this order: the next real order retries.
      try {
        await deletePracticeData(orgId)
      } catch (err) {
        console.error("[practica] automatic deletion failed:", err)
      }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run __tests__/lib/practica-borrado-sweep.test.ts __tests__/api/ordenes.test.ts __tests__/api/recepcion-multiple-atomica.test.ts __tests__/api/recepcion-firma-unica.test.ts __tests__/api/recepcion-multiple-gate.test.ts __tests__/api/cotizaciones-convertir-orden.test.ts __tests__/api/reingreso.test.ts __tests__/api/reingreso-sucursal.test.ts __tests__/api/garantias-reclamos-practica.test.ts __tests__/api/ordenes-recibido-por.test.ts __tests__/api/ordenes-recepcion-null.test.ts __tests__/api/turnos-pr2.test.ts __tests__/api/comisiones-integridad.test.ts`
Expected: PASS. The last four are existing suites of the same routes and must stay green.

Run: `npx tsc --noEmit` and `npx eslint app/api/ordenes app/api/recepciones app/api/cotizaciones app/api/garantias __tests__/api __tests__/lib`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add app/api/ordenes/route.ts app/api/recepciones/route.ts "app/api/cotizaciones/[id]/convertir-orden/route.ts" "app/api/ordenes/[id]/reingreso/route.ts" "app/api/garantias/[id]/reclamos/route.ts" __tests__/lib/practica-borrado-sweep.test.ts __tests__/api/ordenes.test.ts __tests__/api/recepcion-multiple-atomica.test.ts __tests__/api/cotizaciones-convertir-orden.test.ts __tests__/api/reingreso.test.ts __tests__/api/garantias-reclamos-practica.test.ts
git commit -m "feat(ordenes): delete the onboarding practice on the first real order"
```

---

### Task 7: 409 guards on money, stock, quote and invoice routes

**Files:**
- Modify: the 9 route files of Verified Facts §3 (10 handlers)
- Test: `__tests__/api/practica-guards.test.ts` (create)

**Interfaces:**
- Consumes (Task 2): `rejectIfPractica(ordenId, organizationId)`. It is globally mocked in tests and resolves `null`.
- Produces: 409 `ORDEN_PRACTICA_ERROR` from each guarded handler for a practice order.

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/practica-guards.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"
import { mockAuthSuccess, createChainMock, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { rejectIfPractica } from "@/lib/onboarding/practica"
import { ORDEN_PRACTICA_ERROR } from "@/lib/onboarding/practica-shared"
import { PUT as actualizarOrden } from "@/app/api/ordenes/[id]/route"
import { POST as entregarOrden } from "@/app/api/ordenes/[id]/entregar/route"
import { POST as cobrarOrden } from "@/app/api/ordenes/[id]/cobros/route"
import { POST as agregarRepuesto } from "@/app/api/ordenes/[id]/repuestos/route"
import { POST as agregarServicio, PATCH as aplicarServicios } from "@/app/api/ordenes/[id]/servicios/route"
import { POST as crearReingreso } from "@/app/api/ordenes/[id]/reingreso/route"
import { POST as crearCotizacion } from "@/app/api/cotizaciones/route"
import { POST as generarFactura } from "@/app/api/facturacion/generar/route"
import { POST as crearGarantia } from "@/app/api/garantias/route"

const ORDEN = "ord-practica"
const ctx = () => ({ params: Promise.resolve({ id: ORDEN }) })

const casos: Array<[string, () => Promise<Response>]> = [
  ["PUT /api/ordenes/[id]", () => actualizarOrden(createPostRequest({ estado: "EN_REPARACION" }), ctx())],
  ["POST /api/ordenes/[id]/entregar", () => entregarOrden(createPostRequest({}), ctx())],
  ["POST /api/ordenes/[id]/cobros", () => cobrarOrden(createPostRequest({ pagos: [{ monto: 100, metodo: "EFECTIVO" }] }), ctx())],
  ["POST /api/ordenes/[id]/repuestos", () => agregarRepuesto(createPostRequest({ tipo: "manual", nombre: "Pantalla", cantidad: 1, precioUnitario: 10 }), ctx())],
  ["POST /api/ordenes/[id]/servicios", () => agregarServicio(createPostRequest({ tipo: "manual", nombre: "Mano de obra", cantidad: 1, precioUnitario: 100 }), ctx())],
  ["PATCH /api/ordenes/[id]/servicios", () => aplicarServicios(new Request("http://localhost/api/test", { method: "PATCH" }), ctx())],
  ["POST /api/ordenes/[id]/reingreso", () => crearReingreso(createPostRequest({ problemaReportado: "Volvió a fallar" }), ctx())],
  ["POST /api/cotizaciones", () => crearCotizacion(createPostRequest({ tipo: "ORDEN", ordenId: ORDEN, items: [{ descripcion: "Pantalla", cantidad: 1, precioUnitario: 100 }] }))],
  ["POST /api/facturacion/generar", () => generarFactura(createPostRequest({ ordenId: ORDEN }))],
  ["POST /api/garantias", () => crearGarantia(createPostRequest({ ordenId: ORDEN }))],
]

describe("money, stock, quote and invoice routes reject the practice order", () => {
  let chain: ReturnType<typeof createChainMock>

  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
    chain = createChainMock({ id: ORDEN, organization_id: "org-1", estado: "REPARADO", es_practica: true })
    vi.mocked(supabaseAdmin.from).mockImplementation(() => chain as any)
    vi.mocked(rejectIfPractica).mockImplementation(async () => NextResponse.json(ORDEN_PRACTICA_ERROR, { status: 409 }))
  })

  it.each(casos)("%s returns 409 ORDEN_PRACTICA and writes nothing", async (_nombre, llamar) => {
    const { status, body } = await parseResponse(await llamar())
    expect(status).toBe(409)
    expect(body).toEqual(ORDEN_PRACTICA_ERROR)
    expect(rejectIfPractica).toHaveBeenCalledWith(ORDEN, "org-1")
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
    for (const m of ["insert", "update", "upsert", "delete"]) {
      expect(chain[m]).not.toHaveBeenCalled()
    }
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/api/practica-guards.test.ts`
Expected: FAIL, 10 cases, each with "expected "spy" to be called with arguments: [ 'ord-practica', 'org-1' ]" or a status other than 409.

- [ ] **Step 3: Add the guards**

Add `import { rejectIfPractica } from "@/lib/onboarding/practica"` to each of the 9 files. The guard block is always:

```ts
    const practica = await rejectIfPractica(<orden id variable>, organizationId!)
    if (practica) return practica
```

Exact placement:

1. `app/api/ordenes/[id]/route.ts`, in `PUT`. Insert directly after `const { id } = await params` (line 217) and before `const body = await request.json()`. Variable: `id`.
2. `app/api/ordenes/[id]/entregar/route.ts`. Insert after `const { id } = await params` (line 40) and before `const body = await request.json()`. Variable: `id`.
3. `app/api/ordenes/[id]/cobros/route.ts`, in `POST` only. Insert after `const { id: ordenId } = await params` (line 124), the one that follows the "Solo administradores pueden registrar cobros" check, and before `const body = await request.json()`. Variable: `ordenId`.
4. `app/api/ordenes/[id]/repuestos/route.ts`, in `POST`. Insert after `const { id: ordenId } = await params` (line 47), before `const body = await request.json()` and `const data = repuestoSchema.parse(body)`. Variable: `ordenId`.
5. `app/api/ordenes/[id]/servicios/route.ts`, in `POST`. Insert after `const { id: ordenId } = await params` (line 40), before `const parsed = lineaSchema.parse(await request.json())`. Variable: `ordenId`.
6. Same file, in `PATCH`. Insert after `const { id: ordenId } = await params` (line 195), before the `aplicar_monto_servicios_orden` RPC call. Variable: `ordenId`.
7. `app/api/ordenes/[id]/reingreso/route.ts`. Insert after `const { id: ordenOrigenId } = await params` (line 28), before `const body = await request.json()`. Variable: `ordenOrigenId`.
8. `app/api/cotizaciones/route.ts`, in `POST`. Insert as the first statements inside `if (data.ordenId) {` (line 334), before `// Verificar que la orden existe y pertenece a la organización`. Variable: `data.ordenId`.
9. `app/api/facturacion/generar/route.ts`. Insert after `const { ordenId } = parsedBody` (line 52). Variable: `ordenId`.
10. `app/api/garantias/route.ts`, in `POST`. Insert after `const data = garantiaSchema.parse(body)` (line 116), before `// Verificar que la orden existe, está entregada y pertenece a la org`. Variable: `data.ordenId`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/api/practica-guards.test.ts`
Expected: PASS, 10 cases.

Run the existing suites of the guarded routes. With the default mock, `rejectIfPractica` resolves null, so they must stay green:

`npx vitest run __tests__/api/ordenes-update.test.ts __tests__/api/ordenes-labor.test.ts __tests__/api/ordenes-detail-cost-gating.test.ts __tests__/api/entregar.test.ts __tests__/api/entregar-total-repuestos.test.ts __tests__/api/entregar-pendiente-cobro.test.ts __tests__/api/entregar-fecha-completado.test.ts __tests__/api/entregar-consumo-reservas.test.ts __tests__/api/cobros.test.ts __tests__/api/cobros-orden-atomico.test.ts __tests__/api/cc-fiado.test.ts __tests__/api/cc-reversibilidad.test.ts __tests__/api/repuestos-precio-venta.test.ts __tests__/api/repuestos-cantidad.test.ts __tests__/api/orden-servicios.test.ts __tests__/api/orden-servicios-monto.test.ts __tests__/api/reingreso.test.ts __tests__/api/reingreso-sucursal.test.ts __tests__/api/cotizaciones-feature-gating.test.ts __tests__/api/cotizaciones-post-cost-provenance.test.ts __tests__/api/cotizaciones-informe-tecnico.test.ts __tests__/api/cotizaciones-servicio-item.test.ts __tests__/api/facturacion.test.ts __tests__/api/factura-creacion-atomica.test.ts __tests__/api/factura-iva-per-org.test.ts __tests__/api/factura-venta.test.ts __tests__/api/factura-numero-unique.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit` and `npx eslint app/api/ordenes app/api/cotizaciones app/api/facturacion app/api/garantias __tests__/api/practica-guards.test.ts`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add "app/api/ordenes/[id]/route.ts" "app/api/ordenes/[id]/entregar/route.ts" "app/api/ordenes/[id]/cobros/route.ts" "app/api/ordenes/[id]/repuestos/route.ts" "app/api/ordenes/[id]/servicios/route.ts" "app/api/ordenes/[id]/reingreso/route.ts" app/api/cotizaciones/route.ts app/api/facturacion/generar/route.ts app/api/garantias/route.ts __tests__/api/practica-guards.test.ts
git commit -m "feat(ordenes): reject money and stock writes on the practice order"
```

---

### Task 8: Activity filters

**Files:**
- Modify: `app/(dashboard)/dashboard/page.tsx:329-336`
- Modify: `app/api/onboarding/status/route.ts:18-29`
- Modify: `app/api/cron/recordatorios/route.ts:89`
- Modify: `app/api/superadmin/organizations/[id]/route.ts:148`
- Code-only (no existing suite; the spec exempts them): `app/api/superadmin/stats/engagement/route.ts:54`, `app/api/superadmin/stats/feature-usage/route.ts:105,116`, `app/api/superadmin/email-campaigns/route.ts:84,90`, `app/api/superadmin/subscriptions/route.ts:148`, `app/api/cron/lifecycle-emails/route.ts:232`, `app/api/cron/re-engagement/route.ts:62`, `app/api/cron/trial-management/route.ts:83`, `app/api/cron/auto-archive-dormant/route.ts:87`, `app/api/cron/engagement/route.ts:29,31`, `app/api/cron/feature-usage/route.ts:16-36,79,90`
- Test: `__tests__/api/onboarding-status.test.ts` (create)
- Test: `__tests__/api/cron-recordatorios.test.ts`, `__tests__/api/superadmin-organization-detail.test.ts` (modify)

**Interfaces:**
- Consumes (Task 2): `countRealOrders(organizationId)`, already unit-tested in Task 2. That test pins the dashboard redirect's filter.
- Produces: none. Reports and dashboard stats are deliberately NOT filtered (spec "Activity filters").

- [ ] **Step 1: Write the failing tests**

Create `__tests__/api/onboarding-status.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"
import { GET } from "@/app/api/onboarding/status/route"

describe("GET /api/onboarding/status", () => {
  beforeEach(() => vi.clearAllMocks())

  it("ignores the practice order and the practice client", async () => {
    mockAuthSuccess()
    const clientes = createChainMock(null, null, 0)
    const ordenes = createChainMock(null, null, 0)
    mockSupabaseFrom({
      clientes,
      inventario: createChainMock(null, null, 0),
      ordenes_servicio: ordenes,
      organizations: createChainMock({ logo_url: null }),
    })

    const { status, body } = await parseResponse(await GET())

    expect(status).toBe(200)
    expect(ordenes.eq).toHaveBeenCalledWith("es_practica", false)
    expect(clientes.eq).toHaveBeenCalledWith("es_practica", false)
    expect(body.hasFirstOrder).toBe(false)
    expect(body.hasClients).toBe(false)
  })
})
```

In `__tests__/api/cron-recordatorios.test.ts`, add inside the top-level `describe`, after "no encola si ya se envio recordatorio hoy":

```ts
  it("no le recuerda el retiro a la orden de práctica", async () => {
    const { ordenesChain } = mockTables([mockOrg], [mockOrden])
    await GET(new Request("http://localhost/api/cron/recordatorios"))
    expect(ordenesChain.eq).toHaveBeenCalledWith("es_practica", false)
  })
```

In `__tests__/api/superadmin-organization-detail.test.ts`, add inside the `describe`:

```ts
  it("counts only real orders in the activity series", async () => {
    const ordenes = createChainMock([])
    mockSupabaseFrom({
      organizations: createChainMock({ id: "o1", nombre: "Guru", slug: "guru", activo: true }),
      users: createChainMock([]),
      organization_usage: createChainMock(null),
      subscriptions: createChainMock(null),
      subscription_payments: createChainMock([]),
      ordenes_servicio: ordenes,
      organization_limit_overrides: createChainMock(null),
    })

    await GET(createGetRequest("http://localhost/api/superadmin/organizations/o1"), ctx("o1"))

    expect(ordenes.eq).toHaveBeenCalledWith("es_practica", false)
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run __tests__/api/onboarding-status.test.ts __tests__/api/cron-recordatorios.test.ts __tests__/api/superadmin-organization-detail.test.ts`
Expected: FAIL, 3 new tests, each with "expected "spy" to be called with arguments: [ 'es_practica', false ]".

- [ ] **Step 3: Add the filters**

`app/(dashboard)/dashboard/page.tsx`: add `import { countRealOrders } from "@/lib/onboarding/practica"` to the imports. Replace lines 329-336:

```ts
  // Redirect a onboarding si no fue completado (solo para admins con < 5 órdenes)
  if (orgData && orgData.onboarding_completed === false && session.user?.role === "ADMIN") {
    const { count: orderCount } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)

    if ((orderCount ?? 0) < 5) {
```

with:

```ts
  // Redirect a onboarding si no fue completado (solo para admins con < 5 órdenes
  // reales: la orden de práctica del wizard no cuenta)
  if (orgData && orgData.onboarding_completed === false && session.user?.role === "ADMIN") {
    // A failed count lands the admin in the wizard, as before.
    const orderCount = await countRealOrders(organizationId).catch(() => 0)

    if (orderCount < 5) {
```

`app/api/onboarding/status/route.ts`: in the `clientes` query (lines 18-21) and the `ordenes_servicio` query (lines 26-29), append `.eq("es_practica", false)` after `.eq("organization_id", organizationId!)`. The practice client must not tick "first client" either.

`app/api/cron/recordatorios/route.ts`: after `.eq("estado", "REPARADO")` (line 89), add `.eq("es_practica", false)`. An abandoned practice in REPARADO would otherwise email the owner "pasá a retirar".

`app/api/superadmin/organizations/[id]/route.ts`: after `.eq("organization_id", id)` (line 148, in the `ordenes_servicio` query), add `.eq("es_practica", false)`.

Code-only sites. Each gets `.eq("es_practica", false)` on its `ordenes_servicio` query:

- `app/api/superadmin/stats/engagement/route.ts`: after `.select("organization_id, estado, created_at, updated_at")` (line 54).
- `app/api/superadmin/stats/feature-usage/route.ts`: line 105 becomes `supabaseAdmin.from("ordenes_servicio").select("organization_id").in("organization_id", orgIds).eq("es_practica", false),`. Line 116 becomes `supabaseAdmin.from("ordenes_servicio").select("organization_id").in("organization_id", orgIds).not("public_token", "is", null).eq("es_practica", false),`.
- `app/api/superadmin/email-campaigns/route.ts`: after `.select("organization_id")` in the `sevenDaysAgo` query (line 84) and in the `thirtyDaysAgo` query (line 90).
- `app/api/superadmin/subscriptions/route.ts`: after `.in("organization_id", matureOrgIds)` (line 148).
- `app/api/cron/lifecycle-emails/route.ts`: after `.in("organization_id", orgIds)` (line 232).
- `app/api/cron/re-engagement/route.ts`: after `.in("organization_id", orgIds)` (line 62).
- `app/api/cron/trial-management/route.ts`: line 83 becomes `supabaseAdmin.from("ordenes_servicio").select("organization_id").in("organization_id", orgIds).eq("es_practica", false).gte("created_at", lookbackDate.toISOString()),`.
- `app/api/cron/auto-archive-dormant/route.ts`: after `.in("organization_id", orgIds)` (line 87).
- `app/api/cron/engagement/route.ts`: on lines 29 and 31, insert `.eq("es_practica", false)` right after `.eq("organization_id", org.id)`.
- `app/api/cron/feature-usage/route.ts`: replace `countRows` (lines 16-36) with:

```ts
async function countRows(
  table: string,
  orgId: string,
  extraFilter?: { column: string; op: "eq" | "not_null"; value?: string },
  opts: { soloReales?: boolean } = {}
): Promise<number> {
  let query = supabaseAdmin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)

  if (extraFilter) {
    if (extraFilter.op === "eq" && extraFilter.value !== undefined) {
      query = query.eq(extraFilter.column, extraFilter.value)
    } else if (extraFilter.op === "not_null") {
      query = query.not(extraFilter.column, "is", null)
    }
  }

  // The onboarding practice order is not activity.
  if (opts.soloReales) query = query.eq("es_practica", false)

  const { count } = await query
  return count ?? 0
}
```

  Then change line 79 to `countRows("ordenes_servicio", o, undefined, { soloReales: true }),` and line 90 to `countRows("ordenes_servicio", o, { column: "public_token", op: "not_null" }, { soloReales: true }),`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/api/onboarding-status.test.ts __tests__/api/cron-recordatorios.test.ts __tests__/api/superadmin-organization-detail.test.ts __tests__/api/superadmin-organizations.test.ts lib/__tests__/onboarding-practica.test.ts`
Expected: PASS.

Verify every listed site carries the filter:
Run: `rg -n "es_practica" "app/(dashboard)/dashboard/page.tsx" app/api/onboarding/status app/api/superadmin app/api/cron`
Expected: one hit each in `stats/engagement`, `organizations/[id]`, `subscriptions`, `lifecycle-emails`, `re-engagement`, `trial-management`, `auto-archive-dormant`, `recordatorios` and `onboarding/status` (two there); two each in `stats/feature-usage`, `email-campaigns` and `cron/engagement`; one in `cron/feature-usage` (inside `countRows`). The dashboard page shows none: it uses `countRealOrders`.

Run: `rg -n "countRealOrders" "app/(dashboard)/dashboard/page.tsx"`
Expected: 2 hits (import and call).

Run: `npx tsc --noEmit` and `npx eslint "app/(dashboard)/dashboard" app/api/onboarding app/api/superadmin app/api/cron __tests__/api`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/dashboard/page.tsx" app/api/onboarding/status/route.ts app/api/cron app/api/superadmin __tests__/api/onboarding-status.test.ts __tests__/api/cron-recordatorios.test.ts __tests__/api/superadmin-organization-detail.test.ts
git commit -m "feat(onboarding): exclude practice rows from activity signals"
```

---

### Task 9: `esPractica` in order and client responses

**Files:**
- Modify: `lib/db-utils.ts:153` (`formatOrden`) and `lib/db-utils.ts:182` (`formatCliente`)
- Test: `lib/__tests__/db-utils.test.ts` (the exact `toEqual` at 189-206 and new tests)
- Test: `__tests__/api/clientes.test.ts`, `__tests__/api/ordenes.test.ts`, `__tests__/api/ordenes-detail-cost-gating.test.ts`

**Interfaces:**
- Consumes: `ordenes_servicio.es_practica` (read through `*` in `app/api/ordenes/route.ts:114-121` and `app/api/ordenes/[id]/route.ts:63-107`) and `clientes.es_practica` (read through the recreated `v_clientes_resumen`, `app/api/clientes/route.ts:71`).
- Produces: camelCase `esPractica: boolean` on `formatOrden` and `formatCliente` output. PR 3 reads it from `GET /api/ordenes` `data[]`, `GET /api/ordenes/[id]` and `GET /api/clientes` `data[]` for the badge and the read-only detail.
- Note: the clientes test's mock returns `es_practica` whatever the view holds. That the recreated view really exposes the column is pinned by migration 346, autocheck (e).

- [ ] **Step 1: Write the failing tests**

In `lib/__tests__/db-utils.test.ts`, add `esPractica: false,` to the expected object of "formatea cliente correctamente" (after `aceptaWhatsapp: true,`, line 199). Then add inside `describe('formatCliente', ...)`:

```ts
  it('exposes the onboarding practice flag', () => {
    expect(formatCliente({ id: '1', nombre: 'Luis', telefono: '', es_practica: true })?.esPractica).toBe(true)
    expect(formatCliente({ id: '2', nombre: 'Ana', telefono: '1' })?.esPractica).toBe(false)
  })
```

Add inside `describe('formatOrden', ...)`:

```ts
  it('exposes the onboarding practice flag', () => {
    expect(formatOrden({ id: 'ord-p', es_practica: true })?.esPractica).toBe(true)
    expect(formatOrden({ id: 'ord-1' })?.esPractica).toBe(false)
  })
```

In `__tests__/api/clientes.test.ts`, add inside `describe("GET /api/clientes", ...)`:

```ts
  it("exposes the practice flag as esPractica", async () => {
    mockAuthSuccess()
    const chain = createChainMock(
      [
        { id: "c1", nombre: "Luis", telefono: "", es_practica: true },
        { id: "c2", nombre: "Ana", telefono: "1", es_practica: false },
      ],
      null,
      2
    )
    mockSupabaseFrom({ v_clientes_resumen: chain })

    const { body } = await parseResponse(await GET(createGetRequest("http://localhost:3000/api/clientes")))

    expect(body.data[0].esPractica).toBe(true)
    expect(body.data[1].esPractica).toBe(false)
  })
```

In `__tests__/api/ordenes.test.ts`, add inside `describe("GET /api/ordenes", ...)`:

```ts
  it("exposes the practice flag as esPractica", async () => {
    mockAuthSuccess()
    const filas = [{ id: "ord-p", numero_orden: 0, codigo_orden: "PRACTICA", es_practica: true, clientes: { id: "c1", nombre: "Luis" } }]
    const chain = createChainMock(filas, null, 1)
    chain.then = (resolve: any) => resolve({ data: filas, error: null, count: 1 })
    mockSupabaseFrom({ clientes: createChainMock([]), ordenes_servicio: chain })

    const { body } = await parseResponse(await GET(createGetRequest("http://localhost:3000/api/ordenes")))

    expect(body.data[0].esPractica).toBe(true)
  })
```

In `__tests__/api/ordenes-detail-cost-gating.test.ts`, add inside `describe("GET /api/ordenes/[id] — inventario purchase cost visibility", ...)`:

```ts
  it("exposes the practice flag as esPractica on the detail", async () => {
    mockRole("ADMIN")
    mockSupabaseFrom({
      ordenes_servicio: createChainMock({ ...ordenRow, es_practica: true }),
      orden_eventos: createChainMock(null),
      organizations: createChainMock({ vendedores_administran_inventario: false }),
    })

    const { status, body } = await parseResponse(await GET(createGetRequest(), ctx()))

    expect(status).toBe(200)
    expect(body.esPractica).toBe(true)
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run lib/__tests__/db-utils.test.ts __tests__/api/clientes.test.ts __tests__/api/ordenes.test.ts __tests__/api/ordenes-detail-cost-gating.test.ts`
Expected: FAIL. "formatea cliente correctamente" fails on the missing `esPractica`, and the new tests fail with "expected undefined to be true".

- [ ] **Step 3: Map the flag**

In `lib/db-utils.ts`, `formatOrden`, after `esReingreso: orden.es_reingreso || false,` (line 153):

```ts
    // Onboarding practice order (migration 346): the UI shows a badge and a read-only detail.
    esPractica: orden.es_practica === true,
```

In `formatCliente`, after `aceptaWhatsapp: cliente.acepta_whatsapp ?? true,` (line 182):

```ts
    esPractica: cliente.es_practica === true,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/__tests__/db-utils.test.ts __tests__/api/clientes.test.ts __tests__/api/clientes-filtros.test.ts __tests__/api/ordenes.test.ts __tests__/api/ordenes-list-cost-gating.test.ts __tests__/api/ordenes-detail-cost-gating.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit` and `npx eslint lib/db-utils.ts lib/__tests__ __tests__/api`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add lib/db-utils.ts lib/__tests__/db-utils.test.ts __tests__/api/clientes.test.ts __tests__/api/ordenes.test.ts __tests__/api/ordenes-detail-cost-gating.test.ts
git commit -m "feat(api): expose the practice flag on orders and clients"
```

---

### Task 10: Branch verification gate

**Files:** none changed.

- [ ] **Step 1: Run every suite this PR touches**

Run: `npx vitest run lib/__tests__ __tests__/api __tests__/lib __tests__/components/onboarding-wizard-logo.test.tsx __tests__/components/onboarding-wizard-primera-orden.test.tsx`
Expected: PASS, no failures. A failure in a suite this plan did not list means a hidden dependency on a changed route. Fix it in the owning task's file and re-run.

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint lib app/api "app/(dashboard)/dashboard" __tests__/api __tests__/lib vitest.setup.ts`
Expected: no errors.

- [ ] **Step 3: Contract spot checks**

Run: `rg -n "export (const|type|interface|async function|function)" lib/onboarding/practica-shared.ts lib/onboarding/practica.ts`
Expected: exactly the exports in the Interfaces block, with no renamed contract name.

Run: `rg -n "deletePracticeData\(" app --glob '!**/*.test.*'`
Expected: 7 hits across 6 files: the 5 insert paths, plus the practice route's POST and DELETE.

Run: `rg -n "rejectIfPractica\(" app --glob '!**/*.test.*'`
Expected: 10 hits across 9 files.

- [ ] **Step 4: Hand off (orchestrator)**

Confirm with the user that migration 346 is applied (Task 1, Step 6) before the branch is pushed. Then request the fresh-context review required before any PR, and resolve Decision needed #2 (PR size) before opening it.

---

## Self-Review Notes

- **Spec coverage:**

  | Spec section | Task |
  |---|---|
  | Data model | 1 |
  | `POST` / `PATCH` / `DELETE` practice | 3, 4 |
  | `POST /api/onboarding/complete` | 5 |
  | `deletePracticeData` | 1 (SQL), 2 (TS) |
  | Automatic deletion | 6, widened to 5 paths (Decision needed #1) |
  | Guards | 7 |
  | Activity filters | 8, including the `recordatorios` cron |
  | Success-metric query excludes `es_practica` | not code in this repo; the metric query must add `AND NOT es_practica` |
  | Error-handling table | 3 (double submit, reused client), 6 (deletion failure), 7 (409) |
  | Testing | as listed per task |
  | Migration dry-run with the trigger check | Task 1, Steps 5-6 |

  `PUT /api/onboarding/rubro`, the wizard UI and the badges belong to PR 2 and PR 3.
- **Refinements beyond the literal spec, flagged for review:**
  - The practice POST returns 409 when real orders exist. This keeps the spec's "never coexists" invariant, on which unfiltered reports rely.
  - `/complete` never overwrites `practica`, not only "never overwrites with `omitido`".
  - "No phone" is `telefono = ''` plus `acepta_whatsapp = false`, because the column is NOT NULL.
  - `onboarding/status` also filters the practice client.
  - Both `camino` writes go through one SQL upsert (`registrar_camino_onboarding`), so they create the `onboarding_progress` row when it is missing without depending on `GET /api/onboarding/progress`. A read-then-write from TypeScript would race.
- **Known limitations:**
  - A real client with an empty phone blocks practice creation in that org (409). The dry-run counts such clients.
  - Emails read "Orden #0".
  - The practice in REPARADO shows as owed in `ordenes-pendientes` for the practice client until delivered, and the guard blocks any cobro.
