# Revising an accepted cotización — Design

Date: 2026-08-25
Status: Approved by user (2026-08-25 conversation: chose approach A — revision as a
superseding cotización row — over in-place versioning and over additive-only quotes;
approved that the orden keeps advancing while a revision awaits signature, shown with a
visible warning; approved making the query-consolidation refactor a prerequisite slice)

## Problem

An `ACEPTADA` cotización cannot be changed. The server refuses item edits on it
(`app/api/cotizaciones/[id]/route.ts:316`) and the UI hides the edit affordance. That
refusal is correct as far as it goes: accepting a cotización is not a status change, it
is three coupled side effects.

1. It stores the customer's signature — `firma_aprobacion` / `firma_mime`, written in the
   same transaction as the state change by `aprobar_cotizacion_atomica` (migration 246).
   That signature attests to *those* items at *that* price.
2. It reserves stock. Migration 246 runs `reservar_items_cotizacion` inside the approval
   transaction precisely so a cotización cannot be `ACEPTADA` without its stock reserved,
   and the reverse path releases those reservations when it later becomes `RECHAZADA`
   (`route.ts:606`).
3. It drives the orden to `APROBADO`, to the point where deleting the last cotización of
   an approved orden is blocked (`route.ts:737-770`).

Editing such a row in place would leave a signature describing one document attached to a
different one, with stock reservations pointing at items that no longer exist. The
problem is therefore not a missing permission. It is a missing concept: there is no way
to say "this is what the customer agreed to, and this is what we agreed to instead."

Four situations produce this need in the shop, and they are not equivalent:

| Situation | Money changes | Already possible today |
|---|---|---|
| New fault found once the device is open | Total goes up | Yes — see below |
| Item or price entered wrong | Total moves either way | No |
| Customer withdraws part of the job | Total goes down | No |
| Notes, terms, item wording | No | No |

**One of these is already solved.** An orden accepts several cotizaciones, and the server
already sums every non-rejected one into the orden's `presupuesto`
(`route.ts:636-648`); the "Nueva Cotización" button carries no state gate. So new work
found mid-repair can be quoted as a *second* cotización, signed on its own, leaving the
original signature untouched. This design does not replace that path and should not
discourage it — it is the better fit whenever the change is genuinely additive.

The remaining three are corrections, not additions. A mis-entered price is not fixed by
adding another line, and withdrawing work would require a negative amount.

## Decisions

### The customer re-signs whenever the total changes

Any change to the amount requires a fresh signature; the previously accepted version is
frozen as the record of what was agreed before. Changes that do not touch the total
(notes, terms, item wording) do not require re-approval.

This is the constraint the rest of the design serves.

### The orden keeps advancing while a revision awaits signature

The orden does not change state and does not lose its reservations. It displays a visible
warning that an unsigned revision exists.

Freezing the orden was considered and rejected. The typical trigger is a technician who
already has the device open; stopping the orden does not reassemble it, and it would
release reservations for parts that may already be installed. The governing principle:

> **The orden advances on what was approved. The revision governs only the delta.**

Work the customer already signed for proceeds and is billed. New work does not execute
until signed. A shop that chooses to start anyway is taking its own commercial risk — not
a decision the system should make on its behalf.

### A revision is a new cotización row, not a mutation

Approach A of three considered.

**A. Superseding row (chosen).** A new `cotizaciones` row carries the edited items; the
accepted one is frozen and marked as superseded. It reuses every existing mechanism —
send, public link, signature capture, `aprobar_cotizacion_atomica`, PDF — because a
revision *is* a cotización. In particular the approval RPC requires `estado = 'ENVIADA'`,
which is exactly what a revision is before signing, so the customer re-signs through the
existing path with no new screen. Cost: superseded rows must be excluded from the
orden's budget sum, or the orden double-counts.

**B. In-place versioning with history table.** One row is edited and the signed version is
snapshotted elsewhere. The budget sum keeps working untouched, but the public link the
customer already holds silently starts showing different content, and reconstructing
"what exactly was signed" — including its PDF — becomes a new read path. The signature
stops living next to what it signs, which is the very problem being solved.

**C. Additive-only.** Already possible today; covers new work and nothing else.

### Superseded is a nullable pointer, not a state

```sql
ALTER TABLE cotizaciones
  ADD COLUMN reemplazada_por TEXT REFERENCES cotizaciones(id);
```

`NULL` means current. A value means this row was replaced by that revision.

A `REEMPLAZADA` state was rejected. That row *was* accepted and signed — a historical fact
that overwriting `estado` would erase. The state enum also appears in the zod schema
(`route.ts:55`), the UI's `estadoConfig` map and six queries; adding a value touches all
of them, while a nullable column touches none.

The inverse direction ("which revision replaced this one?") resolves with
`WHERE reemplazada_por = <id>`, so no second column is stored. The revision number is
counted by walking the chain rather than persisted.

`numero_cotizacion` (column `n`) carries no unique constraint, so a revision keeps the
base number and is displayed as *rev. 2*. For the customer that reads more clearly than an
unrelated new number.

## Flow

1. Revising an `ACEPTADA` never touches it. A new row is created with the items copied, in
   `BORRADOR`, pointing at the original.
2. On send, the original receives `reemplazada_por = <new id>` and the revision becomes
   `ENVIADA`.
3. The customer signs through the existing path. `aprobar_cotizacion_atomica` accepts it
   unchanged, because it demands `ENVIADA` and that is what a revision is.
4. On approval, reservations are **reconciled**: the superseded row's reservations are
   released and the revision's are taken, in one transaction — mirroring
   `convertir_cotizacion_venta_atomica`, which wraps `liberar` and `crear` together
   specifically to prevent the phantom-reservation bug documented in migration 246.

Throughout, the orden holds its state and its reservations, showing only the pending
revision warning.

## Prerequisite: consolidate the budget queries

Six places ask "which cotizaciones count for this orden":

- `app/api/cotizaciones/[id]/route.ts` — lines 125, 641, 754, 797
- `app/api/cotizaciones/[id]/enviar/route.ts`
- `app/api/cotizaciones/route.ts`

Adding `.is("reemplazada_por", null)` to five of them and missing the sixth double-counts
the orden's budget. That is the principal risk of approach A, and the mitigation is
structural rather than diligence.

A helper already exists — `recalcPresupuestoOrden` (`route.ts:119`) — but only one caller
uses it (`route.ts:602`); the other five copied the query inline. **The duplication
predates this feature.** It is inherited, not introduced.

So slice 0 routes all six through a single place, with **no behavior change**. They are not
identical: five of them sum the total (`route.ts` 125, 641 and 797, plus the inline copies
in `enviar/route.ts:143` and `cotizaciones/route.ts:479`), while `route.ts:754` counts
whether any active cotización remains. The shared unit is therefore not the sum but the question beneath it — *which
cotizaciones of this orden are current* — with the sum and the count built on top.

Only then does the feature add its condition, in one place instead of six.

## UI

- On an `ACEPTADA`, the hidden control returns as **"Revisar"**, not "Editar". It opens the
  form with items copied and states plainly that this creates a new version the customer
  must sign again.
- The superseded row renders collapsed, labelled as a previous version, its signature
  intact and inspectable.
- The orden shows a **revision pending signature** warning while the new row sits in
  `ENVIADA`.

## Testing

In priority order:

1. **Refactor equivalence.** An orden's budget is identical before and after slice 0.
   Nothing else proceeds until this holds. A moved assertion means the refactor is wrong,
   not the test.
2. **No double count.** An orden holding a superseded accepted row plus its revision
   reports the revision's total, not the sum of both. This is the failure mode most worth
   guarding.
3. **Signature preserved.** After a revision is created, the superseded row still carries
   its `firma_aprobacion` and its original items.
4. **Reservation reconciliation.** Approving a revision leaves `stock_reservado` at the
   revision's quantities, not the sum of both versions.
5. **In-place edit still refused.** The server guard at `route.ts:316` is not relaxed.
   Revising creates a row; it never mutates the signed one.

## Risks and non-goals

**Two subsystems write `presupuesto`.** The servicios RPCs (migrations 303, 304) also write
`ordenes_servicio.presupuesto`, summing *servicios* rather than cotizaciones. That tension
exists today and is out of scope here; this design neither creates nor resolves it. Worth
knowing before debugging a budget that disagrees with its cotizaciones.

**Revising is not the default answer.** Where a change is additive, a second cotización
remains the better instrument: it needs no new concept and leaves the original signature
untouched by construction.

**Multi-level revision chains** (a revision of a revision) fall out of the model for free,
but the UI only needs to render the immediate previous version. Full chain history is not
a goal of this slice.
