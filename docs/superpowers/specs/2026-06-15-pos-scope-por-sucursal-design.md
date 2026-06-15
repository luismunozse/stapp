# POS scoped por sucursal (stock propio) + visibilidad cross-sucursal

**Fecha:** 2026-06-15 · **Estado:** Diseño aprobado

## Problema

Con 3 sucursales (cada una con su depósito principal), el POS muestra stock **agregado** (de toda la org) y tiene un **selector libre de depósito**. Resultado: muestra "3 disponible" aunque el depósito de la sucursal activa tenga 0 → la venta strict falla. El usuario quiere: cada sucursal vende SU stock; ver (no vender) lo que hay en otras sucursales.

## Objetivo

- POS scoped a la **sucursal activa del usuario** (auto, sin picker): lista solo productos con stock en el depósito de esa sucursal; esos son vendibles.
- **Ver stock en otras sucursales** (read-only) para un producto, sin poder agregarlo/venderlo.
- Venta sigue **strict** en el depósito de la sucursal activa (resuelto server-side) — no drena de otras.

## Decisiones (cerradas)

1. **Sacar el selector libre de depósito** del POS. El depósito = principal de la sucursal activa, resuelto del contexto (sesión/cookie), no elegido a mano.
2. **Strict server-authoritative:** la ruta de ventas resuelve el depósito de la sucursal activa y lo pasa como `p_deposito_id` explícito (→ strict). El POS NO manda depositoId. (Si no se mandara nada, el RPC caería a drain y vendería de otras sucursales — lo evitamos.)
3. **Cross-sucursal = read-only**, usando el endpoint existente `/api/inventario/[id]/depositos`.
4. Sin migración (usa tablas/funciones existentes).

## Arquitectura

### Helper TS — resolver depósito de sucursal
`lib/sucursal.ts` (o nuevo): `getDepositoDeSucursal(organizationId, sucursalId): Promise<string|null>` → query `depositos WHERE organization_id, sucursal_id, principal=true, deleted_at IS NULL`. (Espeja la SQL `get_deposito_de_sucursal` pero del lado TS para las rutas.)

### `/api/inventario/search` (scope por sucursal)
- Resolver la sucursal de lectura: `requireAuth` da role + userSucursalId; leer cookie con `getCookieSucursalId()`; `resolveSucursalLectura({role, userSucursalId, cookieSucursalId})`.
- Si `verTodas` (ADMIN sin cookie / 'todas') → comportamiento actual (stock agregado, filtra `stock>0`). Ven todo.
- Si hay `sucursalId` → `depId = getDepositoDeSucursal(org, sucursalId)`; la búsqueda devuelve `stock` = stock en `depId` (join a `inventario_depositos` por `deposito_id=depId`), `stockReservado` de esa fila, y filtra `stock_en_deposito > 0` (salvo `includeZeroStock`). Mantener el search por nombre/código sobre `inventario`.
  - Implementación PostgREST: embeber `inventario_depositos!inner(stock, stock_reservado, deposito_id)` con `.eq("inventario_depositos.deposito_id", depId)` y `.gt("inventario_depositos.stock", 0)`; mapear `stock` desde la fila embebida. (El implementer ajusta el embedding/filtro real; el contrato es: `stock` = el del depósito de la sucursal.)

### `/api/inventario/barcode` (scope por sucursal)
- Igual: resolver sucursal activa → depósito; devolver stock de ese depósito; si 0 ahí → tratar como "sin stock en esta sucursal" (el POS ya rechaza stock 0).

### `app/api/ventas/route.ts` (strict por sucursal, server-resolved)
- Ya resuelve `sucursalId` con `sucursalParaEscritura`. Agregar: `const depId = await getDepositoDeSucursal(organizationId, sucursalId)`; pasar `rpcParams.p_deposito_id = depId` (explícito → strict). **Dejar de usar `data.depositoId`** del cliente (el picker se va). Si `depId` es null (sucursal sin depósito principal — no debería pasar), fallback a comportamiento actual (null → drain) con log.

### POS (`pos-terminal.tsx`, `pos-payload.ts`, `pos-checkout-dialog.tsx`)
- **Quitar** el selector de depósito (estado `depositoId`, fetch `/api/depositos`, `showDepositoSelector`, el `<Select>` ~650-662) y dejar de pasar/enviar `depositoId` en el payload.
- La búsqueda de productos (`pos-product-search` / el fetch a `/api/inventario/search`) ya queda scoped por la sucursal del usuario (lo hace el server) — sin cambios de params salvo quitar cualquier `depositoId` que mandara.
- **Vista cross-sucursal (read-only):** en el resultado de búsqueda o en una acción por ítem, un botón "Ver en otras sucursales" → fetch `/api/inventario/[id]/depositos` → modal/popover que lista por sucursal/depósito la cantidad. Sin botón de agregar. (Mapear deposito→sucursal: el endpoint o un join devuelve el nombre de la sucursal.)

## Edge cases
- ADMIN en "ver todas" → search agregado (ve todo); para vender igual se resuelve un depósito (sucursal principal por `sucursalParaEscritura`).
- Producto sin fila en `inventario_depositos` para el depósito de la sucursal → no aparece en el POS de esa sucursal (stock 0 ahí) — correcto. Aparece en "ver en otras sucursales" si está en otra.
- Usuario VENDEDOR con sucursal fija → siempre scoped a su sucursal (ignora cookie).

## Testing
- `/api/inventario/search`: con sucursal resuelta → devuelve stock del depósito de esa sucursal y excluye ítems con 0 ahí; en "ver todas" → agregado. (Mock supabase + `getCookieSucursalId`/auth.)
- `app/api/ventas/route.ts`: el RPC recibe `p_deposito_id` = depósito de la sucursal activa (no el del cliente). (Extender `ventas.test.ts`.)
- POS: sin unit test del picker removido; build + smoke.
- `getDepositoDeSucursal`: helper testeable (mock supabase) — sucursal con principal → id; sin → null.

## Fuera de alcance
- Transferir stock entre sucursales desde el POS (existe UI de transferencias aparte).
- Multi-depósito DENTRO de una sucursal (varios depósitos por sucursal) — el POS usa el principal de la sucursal.
- Cambiar el modo strict/drain del RPC (se mantiene; el server fuerza strict pasando el depósito explícito).
