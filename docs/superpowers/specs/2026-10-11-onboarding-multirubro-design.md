# Rubro-aware onboarding with a practice order — Design

Date: 2026-10-11
Status: Approved by user in conversation (2026-10-11), pending review of this document.
Sub-project 1 of 6 of the multi-rubro onboarding redesign (0 was PR #445).

Decisions taken in the conversation, in order:

- Practice order model: **C**. Ask first whether there is a real device to load; practice only for those who have none.
- Practice depth: **B**. Full cycle inside the wizard (receive, repair, deliver) in under two minutes.
- Notice channel: **A**. Email to the owner's own inbox, plus a button that opens the public tracking page.
- Practice lifetime: **C**. It stays visible with a badge and is deleted automatically when the first real order is created. It can also be deleted by hand.
- Rubro in the wizard: **A**. Shown in the business step and changeable while the shop has no real orders.
- Architecture: **approach 1**. A real row flagged `es_practica`, filtered only where activity is measured.

## Problem

Since 2026-08-23 the signup asks for the rubro and seeds the org from a pack (#325-#328). The wizard that follows still behaves as if every shop repaired phones:

- It never reads the rubro (`components/onboarding/onboarding-wizard.tsx`).
- Its sample data is iPhones and PCs regardless of the rubro (`lib/onboarding/sample-data.ts`).
- The rubro chosen at signup cannot be changed afterwards.

Measured in production on 2026-10-11 (read-only queries):

| Signal | Value |
|---|---|
| Signups since 08-23 choosing a non-electronics rubro | 30% (27 of 91) |
| Electrodomésticos signups with ≥1 real order | 2 of 9 (22%) |
| Orgs whose first order came < 30 min after signup, reaching 5 orders | 8 of 45 (18%) |
| Orgs whose first order came 30 min–24 h after signup, reaching 5 orders | 14 of 24 (58%) |
| Orgs that loaded passive sample data and stayed | worst cohort (2 of 16) |

Two conclusions drive the design:

1. **The first order is contaminated by test orders.** Shops that create a throwaway order right after signing up rarely come back. The signal of retention is coming back another day with real work.
2. **Passive sample data does not teach.** Watching pre-made iPhone orders retained worst. The shop that has a real device waiting is the one that stays, and the wizard should not stand in its way.

## Goal and success metric

Goal: more shops of any rubro reach real, repeated use.

**Metric:** the shop creates real orders on at least **2 distinct days within its first 14 days**. Practice orders are excluded.

- A baseline is taken before launch.
- The metric is compared on the cohort of signups in the 4 weeks after launch.
- Because practice orders are deleted, the path each shop took is recorded separately (see `onboarding_progress` below), so it can still be measured afterwards.

## Non-goals

These belong to later sub-projects or were explicitly left out:

- Faster real-order form, auto-selecting a single tipo, removing hardcoded labels in `orden-form.tsx`: sub-project 2.
- Return nudges, and connecting WhatsApp after the shop has seen the value: sub-project 3.
- Changing the rubro of a shop that already has real data, the TV/audio pack, a richer genérico pack: sub-project 4.
- Landing and SEO by rubro: sub-project 5.
- Adding the tracking link to customer notification emails. Today no email has it, for any shop. It is a cheap follow-up, out of this scope.
- Removing the sample-data feature. Its routes stay for orgs that already use it; only the wizard stops offering it.

## User flow

The wizard is shown, as today, to ADMIN users of orgs with `onboarding_completed = false` and fewer than 5 real orders. "Omitir" stays available on every step.

1. **Bienvenida.**
2. **Tu negocio.**
   - Name and logo, saved with the single `PUT /api/configuracion` from #443.
   - The current rubro, shown as "Tu rubro: Electrodomésticos · Cambiar".
   - Choosing genérico asks for the trade text (`rubro_detalle`), as the signup does.
   - If the org has real orders, "Cambiar" is disabled with a one-line reason.
3. **"¿Tenés un {equipo} para cargar ahora?"** The word comes from the org's terminology, so it can read vehículo, pieza and so on.
   - "Sí, tengo uno" marks onboarding complete and navigates once to `/ordenes?nueva=1`.
   - "Todavía no, quiero practicar" goes to step 4.
4. **Práctica.** A tracker shows Recibida → Reparada → Entregada.
   - **a) Recibir.**
     - Tipo: preselected with the org's first active tipo.
     - Device: free text, with brand chips from the tipo's `config.marcas`.
     - Problem: chips from `config.problemasComunes`. Genérico has none, so it uses the fixed list "No enciende", "Funciona con fallas", "Hace ruido", "Mantenimiento".
     - Client: fixed and read-only, "Vos · {email}".
     - On submit the wizard says "Le mandamos un email a {email}: así se entera tu cliente" and shows **Ver lo que ve tu cliente**, which opens `/seguimiento/{public_token}` in a new tab.
   - **b) Reparar.** "¿Cuánto cobrarías?" (required, > 0), then the second email goes out.
   - **c) Entregar.** The copy says "En la práctica no se cobra nada. En una orden real, acá registrás el pago." Then the third email goes out.
5. **Listo.**
   - Primary button: "Cargar mi primera orden real", to `/ordenes?nueva=1`.
   - Secondary button: "Ir al panel".
   - Note: "La práctica queda en tu lista hasta que cargues tu primera orden real."

If the user leaves mid-practice, the wizard resumes at the practice sub-step the order is in.

## Data model

One migration. Its number is assigned at merge, per the repo convention. It ships with a rollback file.

```sql
ALTER TABLE ordenes_servicio ADD COLUMN es_practica boolean NOT NULL DEFAULT false;
ALTER TABLE clientes        ADD COLUMN es_practica boolean NOT NULL DEFAULT false;
CREATE INDEX ordenes_servicio_practica_idx ON ordenes_servicio (organization_id) WHERE es_practica;
CREATE INDEX clientes_practica_idx        ON clientes (organization_id)        WHERE es_practica;

ALTER TABLE onboarding_progress ADD COLUMN camino text
  CHECK (camino IN ('real', 'practica', 'omitido'));
ALTER TABLE onboarding_progress ADD COLUMN practica_completada_at timestamptz;
```

- **Plan-limit triggers** skip rows with `es_practica = true`. That means `update_ordenes_count` (latest in migration 167, lines 67-100) and the client-count enforcement in the same migration. A practice order must not use 1 of the 15 Free orders a month, and the practice client must not use 1 of the 30 Free clients. The delete path never gives a slot back, so skipping at insert is the only fix.
- **Numbering:** the practice order is inserted with `numero_orden = 0`. The counter RPC (`get_next_order_number`, migration 048) uses `GREATEST(next, MAX(numero_orden) + 1)`, so the first real order is still #1. `UNIQUE(organization_id, numero_orden)` guarantees at most one practice order per org.
- **`codigo_orden`:** the value is decided at plan time, after checking the column's type and constraints. Preferred is `PRACTICA`; the fallback is `{prefijo_orden}000`.

## Server

### `app/api/onboarding/practica/route.ts`

The endpoint requires `requireAdmin`. Every query is scoped to the caller's `organization_id` and to `es_practica = true`. By construction, it cannot read or change a real order.

**`POST`** creates the practice client and order.

- If a practice already exists, it is deleted first and created again.
- Client:
  - Name: the owner's `users.nombre`. Email: `users.email`, read server-side by `session.user.id`.
  - **No phone.** If the shop's WhatsApp is connected, a phone would get a real message.
  - `es_practica = true`.
- Order:
  - `es_practica = true`, `numero_orden = 0`, estado `RECIBIDO`.
  - `public_token` and its expiry, generated exactly as `POST /api/ordenes` does (`app/api/ordenes/route.ts:23-25,341`).
  - Tipo, device and problem from the body. The tipo must be one of the org's active tipos.
- Side effects:
  - It writes the `orden_eventos` row.
  - It queues the `CAMBIO_ESTADO` notification through `queueNotification`, as the create route does (`route.ts:570-600`).
  - It sets `onboarding_progress.camino = 'practica'`.
- It skips the counter, the plan-limit pre-check, seña, photos and technician resolution.

**`PATCH { accion: "reparar", costoFinal }`**

- Requires the order to be in `RECIBIDO` and `costoFinal > 0`.
- Writes `EN_REPARACION`, then `REPARADO`, with an `orden_eventos` row for each step.
- Sets `costo_final` and `fecha_completado`.
- Queues **one** notification, the one for `REPARADO`.

**`PATCH { accion: "entregar" }`**

- Requires the order to be in `REPARADO`.
- Writes `ENTREGADO_SIN_COBRO` with `motivo_sin_cobro = 'CORTESIA'` and `fecha_entrega`, plus an `orden_eventos` row.
- Queues the notification.
- Sets `onboarding_progress.practica_completada_at`.

This endpoint has **no code path** that writes `cobros_orden`, calls `cargar_deuda_cuenta_corriente`, creates a garantía, or reserves or consumes stock. It deliberately does not reuse `PUT /api/ordenes/[id]` or `POST .../entregar`. Called with `sinCobro: false`, `entregar` charges the practice client's cuenta corriente (`entregar/route.ts:192-211`). A narrow endpoint cannot make that mistake.

The accepted cost: if the real routes gain new side effects, the practice will not show them. For a demo, that is fine.

**`DELETE`** deletes the practice through the shared helper below. It backs the "Borrar práctica" button.

### `POST /api/onboarding/complete`

It accepts an optional `camino` and stores it in `onboarding_progress.camino`:

- `real` from "Sí, tengo uno"
- `omitido` from "Omitir"

The practice path sets `practica` from the practice `POST`. An existing value is never overwritten with `omitido`. A shop that practiced and then skipped the last step still counts as `practica`.

### Shared helper: `deletePracticeData(organizationId)`

Lives in `lib/onboarding/practica.ts`. It uses `supabaseAdmin`, so it works whoever created the real order.

1. Delete the `user_notifications` rows of the practice order. Their FK is `ON DELETE SET NULL`, so otherwise the bell would keep a link to a deleted order.
2. Delete the practice order. `orden_eventos`, `cobros_orden`, `fotos_orden` and the rest cascade.
3. Delete the practice client **only if nothing outside the practice order references it**. Otherwise set its `es_practica = false`: the owner reused it for real work, and it became a real client.
   - The plan must list every FK to `clientes` and its delete action before implementing this step. A cascading FK would turn the delete into data loss.

### Automatic deletion in `POST /api/ordenes`

After the INSERT of a real order succeeds, the route calls `deletePracticeData(orgId)`.

- A failure is logged and swallowed. The real order is never affected.
- The next real order retries.
- The call is skipped when the org has no practice row: a cheap `count` with the partial index.

### `PUT /api/onboarding/rubro`

The endpoint requires `requireAdmin`. Body: `{ rubro, rubroDetalle? }`.

It returns 409 if the org has any order with `es_practica = false`. Otherwise it runs, in this order:

1. `deletePracticeData(orgId)`.
2. Seed the new pack's tipos and checklists. If seeding the tipos fails, abort with nothing else changed.
3. Deactivate (`activo = false`) the org's `es_base` tipos whose `codigo` is not in the new pack.
   - The upsert in `seed.ts` uses `ignoreDuplicates`. It neither deactivates old tipos nor reactivates a code that was deactivated before, so tipos in the new pack are explicitly set `activo = true`.
4. Delete or deactivate the checklist templates seeded by the **previous** pack, matched by the previous pack's checklist names. `sembrarChecklists` only inserts, so without this step templates would be duplicated.
5. Write `organizations.terminologia` as the new pack's terminology, **including `{}`**. `sembrarVocabulario` skips the write when the pack has no overrides, so a shop moving from electrodomésticos to electrónica would otherwise keep saying "Artefacto".
6. Update `organizations.rubro` and `rubro_detalle`.

`seedOrganizationFromRubro` is not changed for signup. The fixes for steps 3-5 live in the rubro-change path, or in an explicit `replace` mode of the seed helpers, whichever the plan finds cleaner.

### Guards on money and stock routes

Every route that writes money, stock, warranties, quotes or invoices for an order returns **409** "Es una orden de práctica" when the order has `es_practica = true`. That includes:

- order cobros and seña
- `entregar`
- state changes through `PUT /api/ordenes/[id]`
- parts, stock reservations
- creating a cotización from the order
- creating a factura from the order

The plan enumerates the exact routes. This is defense in depth behind the read-only UI. A practice order must never reach caja, arqueo, ARCA or stock.

## Activity filters

`ordenes_servicio` appears in about 90 query sites. Only the ones that judge activity are filtered, because the practice never coexists with real orders: it is deleted with the first one.

A report on a shop with zero real orders carries no information either way, so reports and dashboard stats are left alone.

| Site | Why |
|---|---|
| `app/(dashboard)/dashboard/page.tsx:330-345` (fewer than 5 orders redirect) | Practice must not count toward leaving the wizard |
| `app/api/onboarding/status/route.ts:26-39` (`hasFirstOrder`) | Same |
| Plan-limit triggers | In the migration, see above |
| `app/api/superadmin/stats/engagement`, `stats/feature-usage`, `organizations/[id]`, `email-campaigns`, `subscriptions` | Practice must not make an inactive org look active |
| Crons `lifecycle-emails`, `re-engagement`, `trial-management`, `auto-archive-dormant`, `engagement`, `feature-usage` | Same |
| Cron `recordatorios` | An abandoned practice in `REPARADO` would email the owner "pasá a retirar" |

The success-metric query also excludes `es_practica`.

## UI

**Wizard.** It moves to `components/onboarding/wizard/`:

- a shell
- one file per step: `negocio-step`, `pregunta-step`, `practica-step`, `listo-step`
- a rubro selector, reusing the signup's picker if it fits

`app/(dashboard)/onboarding/page.tsx` becomes the data source. Today it renders `<OnboardingWizard />` with no props. It now queries, server-side, and passes as props:

- org name and logo, `rubro`, `rubro_detalle`
- the owner's `nombre` and `email` from `users`
- the active tipos, with `config.marcas` and `config.problemasComunes`
- the resolved terminology
- the real-order count
- the practice order, if any, with its estado and `public_token`

**Orders list and detail.**

- A practice order shows the badge "Práctica · se borra cuando cargues tu primera orden real" and a "Borrar práctica" button.
- The detail is **read-only**: no state change, cobro, seña, parts, cotización or factura actions.

**Clients list.** The practice client shows the same "Práctica" badge.

**Removed from the wizard:** the "Cargar datos de ejemplo" button and the "Primer cliente" step.

## Error handling

| Case | Behavior |
|---|---|
| Practice create or advance fails | Inline `role="alert"` with "Reintentar". "Omitir" still works |
| Notification email not delivered (suppression list, provider down) | Not surfaced. The wizard never depends on it, and "Ver lo que ve tu cliente" still works |
| Automatic deletion fails | Logged. The real order succeeds. Retried with the next real order |
| Rubro change fails during seeding | Aborts before deactivating anything; nothing changed |
| Rubro change requested with real orders | 409, and the UI explains it |
| Double submit on "Recibir" | `UNIQUE(organization_id, numero_orden)` rejects the concurrent insert (23505). The endpoint returns the row that won instead of an error |
| Practice client reused for a real order, sale or quote | `deletePracticeData` keeps it and clears its flag |
| Practice order touched through a money or stock route | 409 |

## Testing

Strict TDD. Every behavior below gets a failing test first.

- **Practice API.**
  - Only ADMIN.
  - Only `es_practica` rows of the caller's org.
  - `numero_orden = 0`, and the client has no phone.
  - `reparar` requires `costoFinal > 0` and sends one notification.
  - `entregar` ends in `ENTREGADO_SIN_COBRO`.
  - No path calls `cobros_orden`, `cargar_deuda_cuenta_corriente`, garantías or stock RPCs.
  - Re-POST replaces the existing practice.
- **`deletePracticeData`.**
  - Deletes the order, its client and its notifications.
  - Keeps and clears the flag on a client that is still referenced.
- **`POST /api/ordenes`.**
  - A real order deletes the practice.
  - A deletion failure does not fail the order.
- **Rubro change.**
  - 409 with real orders.
  - One test each for the three `seed.ts` gaps: old tipos left active, terminology not reset to `{}`, duplicated checklists.
  - Genérico with `rubroDetalle`.
- **Guards.** Each money or stock route returns 409 for a practice order.
- **Filters.** The dashboard redirect, `onboarding/status` and `recordatorios` ignore practice rows. Other filtered sites get a test where a suite already exists.
- **Wizard.**
  - The "Sí" path navigates once to `/ordenes?nueva=1`.
  - The full practice cycle.
  - Resume mid-practice.
  - Rubro change.
  - Genérico fixed suggestions.
  - The existing `onboarding-wizard-logo` and `onboarding-wizard-primera-orden` suites updated for the new props.
- **Migration.** Dry-run against production inside a ROLLBACK transaction with `scripts/db-run.mjs`, including a check that the triggers skip practice rows.
- **Manual.** One full pass on the Vercel preview with a real inbox, before PR 3 merges.

## Delivery

The change exceeds the 400-line review budget, so it ships as three chained PRs, merged to `main` in order.

1. **Server foundation:**
   - the migration
   - the practice endpoint and `deletePracticeData`
   - automatic deletion in `POST /api/ordenes`
   - guards on money and stock routes
   - activity filters

   Nothing is visible yet. The migration is applied to production before this PR merges.
2. **Rubro change:** `PUT /api/onboarding/rubro` and the seed fixes.
3. **Wizard and UI:**
   - the new wizard and the server-fed page
   - badges and the read-only practice detail
   - removal of sample data from the wizard

## To verify at plan time

- The type and constraints of `codigo_orden`, to choose `PRACTICA` or `{prefijo}000`.
- Every FK referencing `clientes` and `ordenes_servicio`, and its delete action.
- The exact list of money and stock routes that need the guard.
- Where `public_token_expires_at` is set on create.
- That `queueNotification` can be called from the practice endpoint with the same context shape the create route builds.
- Whether the signup's rubro picker can be reused as is.
