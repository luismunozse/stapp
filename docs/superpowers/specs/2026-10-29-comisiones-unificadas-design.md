# Commissions: one calculation, frozen payouts — Design

Date: 2026-10-29
Status: Approach and closed-payout rule approved by the user in conversation (2026-10-29). The calls listed at the end are still open to objection.
Trigger: a customer reported wrong commission amounts and asked for commissions on repairs once they are delivered and collected.

## Decisions taken in the conversation

- **Who earns on a repair.** Both the person who handled the reception of the device and the technician who repaired it (the user's words).
- **Approach.** The amount owed is computed live by one single definition for each document, person and role. Only payouts are stored, and they are frozen. Pending = owed − paid. This is the "calculate live, freeze only what was paid" approach the user approved.
  - Rejected alternative: an event ledger that writes a row each time something happens. Every path that changes a sale or an order would need a hook: three delivery paths, cobros, fiado, express, returns, credit notes, annulment and technician changes. One forgotten hook makes a commission vanish without any error. The codebase already has bugs of exactly that class: fiado orders never reach COBRADO, and `fecha_completado` is never written on some paths.
- **Business rules belong to the shop.** Standing product rule: every business choice is configurable per organization, with a default, and the screen shows what the choice implies.
- **What has been paid is closed** (confirmed by the user on 2026-10-29).
  - Formula changes, rule changes and technician reassignments never claw back or top up a paid row.
  - Only events after the payment (returns, credit notes, annulments) and explicit manual adjustments change what a person is owed.
- **Delivery.** In slices, in the order given in "Slices" below. The first slice changes no numbers.

## Problem

Measured on origin/main `27267e53` (read-only code review), plus read-only queries in production.

1. **There is no single formula.**
   - Commission is computed in four places, and each gives a different answer:
     - `v_comisiones_ordenes` (119) plus filters in `app/api/comisiones/route.ts:56-57`;
     - `v_comisiones_ventas` (333);
     - JS in `app/api/reportes/estado-resultados/route.ts`;
     - JS in `app/api/reportes/tendencia-financiera/route.ts`.
   - Two more files recompute the technician part: `rentabilidad` and `rentabilidad-tecnicos`. The order card also recomputes on the client (`components/ordenes/orden-comision-card.tsx:57`).
   - Examples of disagreement:
     - The seller base is net of IVA minus returns in estado-resultados, but `total × %` (with IVA, without returns) in tendencia-financiera.
     - The technician part requires COBRADO on the commission screen, but not in the reports.
2. **"Paid" is a mutable boolean with no amount.**
   - `comision_pagada` on `ventas` and `ordenes_servicio` can be unset without an audit trail.
   - The order amount behind a paid flag keeps moving when `costo_final` or the parts change.
   - The pay endpoints do not check that the document is commissionable (`app/api/comisiones/pagar/route.ts:17-27`).
3. **Rates.**
   - One column, `users.porcentaje_comision`, is shared by sellers and technicians, so a technician who sells on the POS earns their technician rate.
   - Each document copies the rate when it is created: sales through the trigger in 122:30-47, orders on technician assignment.
   - Changing a person's rate never reaches existing documents, and the change is not logged.
   - The customer case: a 5% rate was first typed as 0.05, then 0.5, then 5. Three sales kept the wrong rate and were paid at 1–10% of what they should have been.
4. **Repairs pay only the technician.** The person who received the device earns nothing, and a shop without technicians gets no repair commission at all.
5. **The technician base is wrong.**
   - `costo_final − parts cost` ignores the collection discount (`descuento_cobro`) and credit notes.
   - It also ignores batch deliveries that collect less than `costo_final`: `entregar_lote_recepcion` (354:141) turns the shortfall into a discount.
6. **Some repairs can never commission.**
   - Fiado deliveries and express repairs never reach `estado_cobro = COBRADO`. Their debt lives in the cuenta corriente and is settled there (349:197, `entregar/route.ts:139-161`).
   - Express repairs also have no technician.
7. **Sales from quotes.**
   - The seller recorded is whoever clicked "convert", not the quote's author (`cotizaciones.created_by`, 084:2).
   - `iva_neto` is never written (`convertir-venta/route.ts:354-365`), so the commission is on the IVA-inclusive total.
8. **Returns.** `v_comisiones_ventas` subtracts every `devoluciones_venta` row, including annulled and rejected ones (333 does not filter `anulada` or `estado`).
9. **Screens.**
   - No pagination, so the PostgREST cap of 1000 rows can silently truncate totals.
   - The period is cut without a timezone.
   - The commission screens have no branch filter, while the reports do.

## Goals

- One definition of what each person is owed, used by every screen, report, export and the order card. Nothing recomputes commission on its own.
- Payouts are stored with their amounts and never change. Unpaying is an explicit, audited annulment by an admin.
- Repairs pay two roles: reception and technician.
- After any change to a document (return, credit note, annulment, technician change, discount), the difference shows up by itself as a positive or negative pending amount.
- A shop can change a person's rate "from today" or "from date X", sees the impact before confirming, and the past documents follow.
- Every business rule listed below is configurable per organization, with the stated default.

## Non-goals (this project)

- Pools split between participants. Each role has its own independent rate.
- Rates per product or category.
- A fixed amount per repair. It is a possible later technician base option.
- Commission for the person who delivered the device (`entregado_por_user_id`).
- Payroll or salary integration.
- Removing the legacy `comision_pagada*` columns. They stay, kept in sync, until a later cleanup.

## Anti-goals (a failure even if it technically works)

- An amount that changes after it was paid, without a visible adjustment row.
- A commission that disappears because some write path did not record something.
- The commission screen and a report showing different commission for the same person and period.
- A shop seeing someone else's data, or a non-admin paying or unpaying.

## Model

### Vocabulary

- **Document:** `VENTA` (a `ventas` row) or `ORDEN` (an `ordenes_servicio` row).
- **Role:**
  - `VENDEDOR`: the seller on a sale.
  - `RECEPCION`: the person who handled the reception of an order.
  - `TECNICO`: the technician who repaired an order.
- **Principle.** What happens automatically is computed. What a person decides (payouts, manual adjustments) is stored.
- **Commission row.** One row per (document, beneficiary, role, kind), carrying `base`, `porcentaje`, `monto`, `fecha_devengo` and `sucursal_id`. There are four kinds:
  - `ORIGINAL`: the commission earned by the document itself, dated at its accrual.
  - `AJUSTE_DEVOLUCION`: a negative row per sale return or order credit note, dated at that event.
  - `AJUSTE_ANULACION`: a negative row reversing an annulled sale, dated at the annulment.
  - `AJUSTE_MANUAL`: rows stored in `comisiones_ajustes` (see below), dated when they were created.
- **Before payment.** The row is live: a later change to the document, the rules or the rate recomputes it.
- **After payment the row is closed.**
  - Once a row has a non-annulled payout item, its amount and beneficiary are the payout item's.
  - A later formula change, rule change or technician reassignment does not touch it.
  - Only new events after the payment (a return, a credit note, an annulment, a manual adjustment) add new rows. A row that a payout has closed is never edited.
- **Pending:** a row's amount minus what was paid for it. The sum across rows can be negative, for example when a sale was returned after its commission was paid.
- **Rows not shown:** rows of amount 0 that have no payout.

### The single definition

- One SQL view holds the owed rows (working name `v_comisiones_devengadas`). A second view joins it with the payouts and exposes `pagado` and `pendiente` (working name `v_comisiones_saldo`).
- Both follow the existing pattern from 347: `security_invoker` plus a grant to `service_role` only. Every query filters by `organization_id`.
- **Builder's call:** view vs. SQL function, as long as there is exactly one definition. Every consumer reads it: APIs, reports, exports, the order card, "Mis comisiones".
- A sweep test enumerates the consumers and fails if any file outside the allowed list computes commission.

### Payouts

New tables (working names):

- **`comisiones_pagos`:**
  - `id`, `organization_id`, `beneficiario_id`, `fecha_pago`, `pagado_por`, `notas`, `total`;
  - `anulado`, `anulado_por`, `anulado_at`, `motivo_anulacion`, `created_at`.
- **`comisiones_pagos_items`:**
  - `id`, `pago_id`, `organization_id`, `documento_tipo`, `documento_id`, `rol`, `tipo` (the row kind), `ajuste_ref` (identifies the event or manual adjustment for the `AJUSTE_*` kinds), `base`, `porcentaje`, `monto`.
  - Index on (`organization_id`, `documento_tipo`, `documento_id`, `rol`).
- **`comisiones_ajustes`:**
  - `id`, `organization_id`, `beneficiario_id`, `documento_tipo`, `documento_id` (nullable), `rol`, `monto` (signed), `motivo`, `origen` (`MANUAL`, `CAMBIO_TASA`), `created_by`, `created_at`.
  - Admin-only, audited. It also receives the rate-change tool's adjustments for already-paid rows.

Rules:

- **Paying.**
  - It runs as one atomic RPC, ADMIN only, for one beneficiary and a selection of rows.
  - The client sends every row it displayed with its amount. The server recomputes each row; if any row differs, it rejects with 409 so the admin reloads. A matching total alone is not enough.
  - It then writes the payout plus one item per row, at exactly those amounts.
  - Negative rows can be included; they net against positive ones.
- **Unpaying.**
  - ADMIN only. It is a soft annulment with a reason, and it writes `audit_logs`.
  - An annulled payout counts as unpaid.
- **Legacy flags.**
  - The same RPC keeps `ventas.comision_pagada` / `fecha_pago_comision` / `comision_pago_notas` and the equivalent order columns in sync. A flag is true when a non-annulled payout item exists for that document in its legacy role (VENDEDOR for sales, TECNICO for orders).
  - `editar_venta_atomica` (372:127) and the order card still read those flags.
- **Legacy flags: which role drives them.** Only the VENDEDOR role drives the flag on sales, and only the TECNICO role on orders. Reception payouts never touch the order's flag.
- **Backfill.**
  - Every document with `comision_pagada = true` becomes one `ORIGINAL` payout item, in the legacy role (VENDEDOR or TECNICO), at the amount the current view shows at migration time.
  - The beneficiary is the current `vendedor_id` or `tecnico_id`. There is no history, so this is my call.
  - Items are grouped into one payout per (beneficiary, day of `fecha_pago_comision` in the org timezone, `comision_pago_notas`). A NULL `fecha_pago_comision` uses the migration date.
  - For orders this freezes today's live amount. The true historical amount was never stored, so this is the best available value.
  - A sale return created after `fecha_pago_comision` becomes an `AJUSTE_DEVOLUCION` row (pending, negative). A return created before it does not; under the closed-row rule, what was paid stays.
  - The migration ships with a dry-run check:
    - per beneficiary, the sum of the items equals the paid total the current screens show;
    - the post-payment return rows it creates are listed.

### Rates

- **Each (document, role) carries its own rate snapshot:**
  - `ventas.porcentaje_comision` (exists; trigger at insert).
  - `ordenes_servicio.porcentaje_comision` for TECNICO (exists; copied on assignment).
  - New `ordenes_servicio.porcentaje_comision_recepcion` for RECEPCION. It is set by a BEFORE INSERT trigger from the receiver's reception rate, so all five creation paths are covered by one place: POST, recepción múltiple, express, reingreso, práctica. When the receiver has no rate of their own, the trigger copies the org default at insert time. It never stores NULL to be resolved later.
- **Rates per person and concept:**
  - New `users.porcentaje_comision_recepcion`, nullable. NULL means "use the org default for reception".
  - Slice 2 adds the field to the seller and technician forms, next to the existing rate.
  - The shared `users.porcentaje_comision` keeps its current meaning until the sales slice. That slice introduces a separate sales rate, so a technician on the POS stops earning their technician rate. Until then, today's behaviour stays; that is my call.
- **Organization level.** Configuration is per organization, not per branch. Plan gating of the commission screens stays exactly as it is today.
- **Deviation from what was said in conversation.** The conversation said "the rate in force when the commission is generated". This design keeps the rate as of document creation (or technician assignment) and adds the "from date X" tool instead.
  - Why: a rate at accrual time would need either a write at accrual (an event hook, which is what we rejected) or a rate history to replay, and the existing snapshots cannot be turned into a reliable history.
  - The tool gives the shop the same control explicitly.
- **Changing a rate (the tool).**
  - When an admin changes a person's rate for a concept, the form asks: from today, which affects only new documents, or from date X.
  - For "from date X" it previews how many of that person's documents in that role from X onwards would change, and the money difference, split into pending and already-paid.
  - On confirm, for unpaid rows it rewrites the documents' snapshots, in one transaction with `audit_logs`.
  - Paid rows stay closed. Only if the admin ticks "also the ones already paid" does the tool write one `comisiones_ajustes` row per paid document (`origen = CAMBIO_TASA`), with the difference, dated at the change.
  - This is how the customer's three sales get fixed without editing data by hand.
  - Document date: `ventas.created_at` for sales, `ordenes_servicio.fecha_ingreso` for orders.

### Org rules

- New table `comisiones_config` (one row per organization, defaults when the row is missing). It avoids adding columns to `organizations`, which has to be added to three config cascades every time.
- The existing `organizations.comision_aplica_sin_reparacion` (257) stays where it is, and the definition reads it.

| Rule | Options | Default |
|---|---|---|
| When an order commissions (`orden_devengo`) | delivered AND fully collected · delivered · fully collected | delivered AND fully collected |
| Technician base (`tecnico_base`) | labour = order amount − parts cost · order amount | labour |
| Reception base (`recepcion_base`) | order amount · labour | order amount |
| Default reception rate (`recepcion_porcentaje_default`) | 0..100 | 0 |
| Warranty re-entries commission (`reingreso_comisiona`) | yes · no | no |
| Delivered without repair | existing flag 257, now for both order roles | existing value |

Definitions behind the rules:

- **Order amount** = `GREATEST(costo_final − descuento_cobro − Σ non-annulled notas_credito.monto, 0)`.
  - It is what the shop actually keeps once discounts and credit notes are applied.
  - The card surcharge inside `cobros_orden.monto` is not part of it. That is my call; it matches the technician base today.
- **Parts cost** = `Σ repuestos_orden.cantidad × precio_unitario` (the cost; 286), as today.
- **Delivered** = `estado` in ENTREGADO, plus ENTREGADO_SIN_REPARACION when flag 257 is on.
  - ENTREGADO_SIN_COBRO never commissions.
  - CANCELADO never commissions.
  - `es_practica` orders never commission.
- **Fully collected** = `estado_cobro = 'COBRADO'`, which `recalcular_estado_cobro` (360) keeps up to date through triggers. Fiado and express repairs are the known exception; see Slice 7.
- **`fecha_devengo` for orders:**
  - delivered AND collected: the later of `fecha_entrega` and the last non-annulled `cobros_orden.created_at`;
  - delivered: `fecha_entrega`;
  - collected: the last non-annulled cobro.
  - **Builder's call:** how to date an order that reached COBRADO only through invoice payments (345).
- **Order credit notes.** A non-annulled `notas_credito` row reduces the order amount while the `ORIGINAL` row is unpaid. Once that row is paid, each credit note created after the payment is an `AJUSTE_DEVOLUCION` row instead.
- **`fecha_devengo` for sales:** `ventas.created_at`. The slice 5 "as it is paid" option dates each portion at its payment.
- **Annulment date.** A sale annulment needs a date. `ventas` has no annulment timestamp today; slice 1 adds `fecha_anulacion`, set by a trigger when `estado` becomes ANULADA. For existing annulled sales, the backfill uses `updated_at`.
- **Participants:**
  - TECNICO is `tecnico_id` at evaluation time while the row is unpaid. After payment the row is closed: a technician change gives the new technician nothing for that order, and takes nothing back from the old one.
  - RECEPCION is `recibido_por`, which is never edited after creation. When it is NULL (legacy orders before 260, and reingresos), there is no reception commission.
  - One person can hold both roles on the same order and earns both.

### Sales (slice 5 rules)

| Rule | Options | Default |
|---|---|---|
| Who earns on a converted quote | quote author · person who converted | quote author |
| Sales base | net of IVA · total with IVA | net of IVA (today's behaviour) |
| Card surcharge | included · excluded | included (it is inside `precio_unitario` today) |
| Margin base | off · price − `costo_unitario_snapshot` | off |
| When a sale commissions | at sale · as it is paid (fiado) | at sale |

Other behaviours of the sales slice:

- Deleting a sale that has non-annulled payout items is refused, so its `AJUSTE_ANULACION` row cannot disappear.
- Sales with no seller produce no commission row. Today they show up as "Sin nombre" with nobody to pay; slice 1 already drops them.

Fixes in that slice:

- Returns count only rows with `estado = 'COMPLETADA' AND NOT anulada`.
- Converted sales get `iva_neto` and a real link to their quote.
- The seller gets a separate sales rate.

## Integration map

Each slice must update every consumer it touches, with a test.

| Module | Today | After |
|---|---|---|
| `/comisiones` technician tab (`comisiones-view.tsx`, `app/api/comisiones/route.ts`) | v119 + API filters | single definition; filters by person, role, period (org timezone) and branch; paginated |
| `/comisiones` seller tab (`comisiones-vendedores-view.tsx`, `app/api/comisiones/vendedores/route.ts`) | v333 | single definition; reception rows appear per person with their role |
| Pay/unpay (`comisiones/pagar`, `comisiones/vendedores/pagar`, `vendedores/[id]/comisiones/liquidar`) | flip flags | thin wrappers over the payout RPC (URLs kept) |
| Seller detail (`app/api/vendedores/[id]/route.ts:59-94`, `liquidar-comisiones-dialog.tsx`) | v333, unbounded | single definition |
| Technician "Mis comisiones" (`tecnico-comisiones.tsx`, `tecnicos/[id]`) | `/api/comisiones` | same API, own rows only (existing guard) |
| Order card (`orden-comision-card.tsx`, `lib/db-utils.ts:130-132`) | client recompute | reads the definition's rows for the order (both roles) |
| Reports (`estado-resultados`, `tendencia-financiera`, `rentabilidad`, `rentabilidad-tecnicos`) | own formulas | read the definition (slice 4); per-period commission = owed by `fecha_devengo` |
| Rate writers (`vendedores[/id]`, `tecnicos[/id]`, `usuarios/[id]/rol`) | write the % silently | write `audit_logs`; the change offers "from date X" (slice 3) |
| Edit-sale guard (328/372, `lib/ventas/bloqueos.ts`) | reads `ventas.comision_pagada` | unchanged; the flag is kept in sync |
| Exports (technician CSV, `tecnicos-ranking` CSV) | own data | rows from the definition |
| Multi-branch scope (`lib/ordenes/alcance-lectura.ts`) | none on commission screens | ADMIN switcher narrows; non-admins see only their own rows |

## Slices

1. **Foundation, with no number changes on unpaid rows.**
   - Contents: the single definition, with today's two formulas plus the API filters for `ORIGINAL` rows; adjustment rows; payout and adjustment tables; the RPC; the backfill; `fecha_anulacion`; every current commission screen and API reading the definition; pagination.
   - Oracle: for every unpaid document, the sum of its rows equals today's view amount. That includes today's bugs: annulled returns still subtract, and that gets fixed in slice 5.
   - Paid documents equal their backfilled payout. The only expected difference is the post-payment return rows, which the dry-run lists.
2. **Repairs: reception plus technician on the real order amount** (the customer's request).
   - `comisiones_config`, reception rate and snapshot trigger, the new order rules, the order card with both roles, the screen showing reception rows.
   - Changes technician numbers on orders with discounts or credit notes. That is intended, and the PR lists how many orders change in production.
3. **Rate changes "from date X"** with preview and audit, for all roles. The same slice delivers the admin screen for manual adjustments (`comisiones_ajustes`, `origen = MANUAL`): signed amount, mandatory reason, audited.
4. **Reports read the single definition.**
   - Until this lands, the reports keep their own formulas: today's divergence plus reception rows missing from them.
5. **Sales rules:** the table above.
6. **Payout experience:** a printable receipt, an optional till expense (caja egreso) for the payout, branch filter and org-timezone periods on every commission screen.
7. **Fiado and express repairs.**
   - These need a rule for when a cuenta corriente payment settles a specific order.
   - That allocation does not exist today, so this slice starts with an investigation.

Each slice is its own PR, or chained PRs where it exceeds the 400-line review budget.

## Left to the builder

- View vs. SQL function for the single definition; exact names.
- Payout RPC signature and error codes, within the rules above.
- How the reception rows sit in the screen layout, within the integration map.
- Dating of orders collected only through invoices.
- Migration numbering: take the next free number at merge time.

## Calls I made (for the user to check)

- The rate is snapshotted at document creation or technician assignment, plus the "from date X" tool, instead of a rate at accrual time. See "Rates".
- The order amount excludes the card surcharge.
- A return made before payment, on a sale already paid under today's bug, is not clawed back.
- The backfill beneficiary is the current seller or technician.
- Paying requires a per-row match, not a total match.
- Orders received before the feature get no reception commission, unless the shop uses "from date X".
- Reports switch in slice 4, not slice 1, so slice 1 stays a pure refactor.
