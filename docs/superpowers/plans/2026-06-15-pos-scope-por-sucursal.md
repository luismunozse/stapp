# POS scoped por sucursal — Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development o executing-plans.

**Goal:** POS scoped a la sucursal activa (stock propio, sin picker); venta strict en el depósito de esa sucursal (server-resolved); ver stock en otras sucursales read-only.

**Strict TDD** donde aplica (helpers/routes). POS UI por build+smoke.

**Spec:** `docs/superpowers/specs/2026-06-15-pos-scope-por-sucursal-design.md`. Sin migración.

**BOM watch:** ningún archivo debe arrancar con BOM (`head -c3` ≠ efbbbf). Usar Write/Edit.

---

## Task 1: Helper `getDepositoDeSucursal` (TDD)
**Files:** `lib/sucursal.ts` (agregar); Test `lib/__tests__/sucursal-deposito.test.ts` (o el test existente de sucursal).
- [ ] Test: mock supabase → sucursal con depósito principal → devuelve su id; sin → null.
- [ ] Implementar: `export async function getDepositoDeSucursal(organizationId: string, sucursalId: string): Promise<string|null>` → `supabaseAdmin.from("depositos").select("id").eq("organization_id",org).eq("sucursal_id",sucursalId).eq("principal",true).is("deleted_at",null).maybeSingle()` → `data?.id ?? null`.
- [ ] Commit: `feat(sucursal): helper getDepositoDeSucursal`

## Task 2: `/api/inventario/search` scoped por sucursal (TDD)
**Files:** `app/api/inventario/search/route.ts`; Test `__tests__/api/inventario-search.test.ts`
- [ ] Test: con sucursal resuelta (VENDEDOR con userSucursalId) → la query usa stock del depósito de esa sucursal y excluye ítems sin stock ahí; ADMIN "ver todas" → agregado (comportamiento actual). Seguir patrón del test existente; mockear `getCookieSucursalId` + supabase.
- [ ] Implementar: resolver sucursal (`requireAuth` da role+userSucursalId; `getCookieSucursalId()`; `resolveSucursalLectura`). Si `verTodas` → query actual. Si `sucursalId` → `depId = getDepositoDeSucursal(org, sucursalId)`; query embebe `inventario_depositos!inner(stock, stock_reservado)` filtrado `deposito_id = depId` + `stock > 0` (salvo includeZeroStock); `stock` del payload = el del depósito. Mantener search nombre/código.
- [ ] Commit: `feat(inventario): search devuelve stock de la sucursal activa`

## Task 3: `/api/inventario/barcode` scoped por sucursal
**Files:** `app/api/inventario/barcode/route.ts`
- [ ] Mismo patrón: resolver sucursal → depósito; devolver stock de ese depósito (0 si no hay fila). Test si el archivo tiene; si no, build + smoke.
- [ ] Commit: `feat(inventario): barcode devuelve stock de la sucursal activa`

## Task 4: `app/api/ventas` strict en depósito de sucursal (TDD)
**Files:** `app/api/ventas/route.ts`; Test `__tests__/api/ventas.test.ts`
- [ ] Test: el RPC recibe `p_deposito_id` = depósito de la sucursal activa (no `data.depositoId`). Mock `getDepositoDeSucursal`.
- [ ] Implementar: tras resolver `sucursalId` (sucursalParaEscritura, ya existe), `const depId = await getDepositoDeSucursal(organizationId, sucursalId)`; `rpcParams.p_deposito_id = depId` (en vez de `data.depositoId ?? null`). Si `depId` null → fallback `null` + log.
- [ ] Commit: `feat(ventas): descuenta del deposito de la sucursal activa (strict server-side)`

## Task 5: POS — quitar selector de depósito
**Files:** `components/pos/pos-terminal.tsx`, `components/pos/pos-payload.ts`, `pos-checkout-dialog.tsx`
- [ ] Quitar: estado `depositoId`, fetch `/api/depositos`, `multiDepositoEnabled`/`showDepositoSelector`, el `<Select>` de depósito (~650-662), y la prop/uso `depositoId` en checkout/payload. El payload deja de enviar `depositoId`.
- [ ] La búsqueda ya queda scoped por server; quitar cualquier `depositoId` que el POS pasara al search.
- [ ] `npm run build` → ok.
- [ ] Commit: `feat(pos): saca el selector de deposito (scope por sucursal del usuario)`

## Task 6: Vista "ver en otras sucursales" (read-only)
**Files:** `components/pos/pos-product-search.tsx` (o nuevo `pos-stock-otras-sucursales.tsx`)
- [ ] Acción por ítem "Ver en otras sucursales" → fetch `/api/inventario/[id]/depositos` → popover/modal listando por sucursal/depósito la cantidad disponible. SIN botón agregar. Mapear deposito→nombre de sucursal (si el endpoint no lo trae, extenderlo para incluir el nombre de la sucursal/depósito).
- [ ] `npm run build` → ok.
- [ ] Commit: `feat(pos): ver stock en otras sucursales (read-only)`

## Task 7: Verificación
- [ ] `npm run test:run` completo → verde. `npx tsc --noEmit` limpio.
- [ ] Smoke prod: logueado en Sucursal X → POS lista solo productos con stock en X; producto de otra sucursal → "ver en otras sucursales" lo muestra, no se puede agregar; venta descuenta del depósito de X (strict). ADMIN "todas" → ve agregado.
- [ ] PR (fresh review).

## Self-Review
- Cobertura spec: helper → T1; search scope → T2; barcode → T3; venta strict server-resolved → T4; sacar picker → T5; cross-sucursal read-only → T6. Sin migración. Strict por sucursal preservado (server pasa depósito explícito).
- Riesgo: el embedding PostgREST de inventario_depositos en el search (T2) — el implementer ajusta el filtro real; contrato = stock del depósito de la sucursal. Y la ruta de ventas vuelve a tocar resolución de depósito (T4) — sin migración, bajo riesgo.
