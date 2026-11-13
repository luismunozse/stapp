# Multimoneda S5: el POS vende productos con precio en USD o EUR (plan de implementación)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que el POS pueda vender productos con precio en la divisa de la organización, convirtiendo cada línea a moneda local con la cotización que resuelve el servidor, guardando la foto de origen por línea y la cotización en la venta, y rechazando con 409 una venta confirmada con una cotización vieja.

**Architecture:** una función pura (`lib/currency/venta-divisa.ts`) decide, con el catálogo, la configuración y la cotización, cómo queda cada línea (moneda y precio de origen tomados del ítem, precio y costo en local) o por qué no se puede vender; la usan `POST /api/ventas` y el POS. El carrito guarda `moneda` y `precioOrigen` por línea y su `precioUnitario` ya convertido, así que todo el cálculo de totales existente (`calcularTotalesVenta`) sigue igual. La migración 410 reemplaza `crear_venta_atomica` y `editar_venta_atomica` con la **misma firma**: los campos de origen viajan dentro de cada ítem de `p_items`.

**Tech Stack:** Next.js 16 App Router, Supabase (supabaseAdmin), zod, SWR, vitest + Testing Library, SQL a mano con `scripts/db-run.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-11-multimoneda-design.md` (REQ-3.1 a REQ-3.7, REQ-6.1, REQ-6.3, REQ-6.6; §6 entrega S5; §7 pruebas)

## Global Constraints

- Los montos de siempre (`precio_unitario`, `subtotal`, `total`, `costo_unitario_snapshot`, pagos) **siempre en moneda local** (D5). La divisa vive en el catálogo y en la foto de origen de cada línea (`items_venta.moneda_origen`, `precio_origen`, `tipo_cambio`).
- La `moneda` de una línea de inventario la decide el servidor leyendo `inventario.moneda`; la que mande el cliente se ignora (REQ-3.1). El precio de origen es el del request cuando viene (el cajero lo editó en divisa, REQ-3.6, con la misma confianza que hoy tiene el precio local editable) y si no, `inventario.precio_venta`. En ambos casos se redondea a 2 decimales (`round2`) antes de convertir, porque `precio_origen` es `NUMERIC(12,2)`.
- Conversión: `convertirALocal(origen, tc, unidadRedondeo(config.redondeoConversion, config.monedaLocal))`. El costo se convierte con la misma cotización y la misma unidad (REQ-3.3). Orden REQ-3.2: conversión → recargo → descuentos → IVA → redondeo de efectivo; una venta sin líneas en divisa da exactamente lo mismo que hoy.
- Una línea en divisa solo se vende si la función está habilitada, su `moneda` es la `monedaExtranjera` actual y hay cotización disponible. Si no, 409 con el motivo (ver Task 1). Las líneas en moneda local nunca se ven afectadas.
- La cotización la resuelve el servidor (`resolverTipoCambio`, REQ-1.8). El POS manda la que usó; si difiere de la del servidor → 409 `COTIZACION_CAMBIO` (REQ-3.4). Comparación exacta de números.
- Migraciones: re-ejecutables, `SET LOCAL lock_timeout = '3s'`, sin `BEGIN/COMMIT`, rollback y probes propios. Número: **410** (409 = S4, 408 = rama `feat/diagrama-danos`); verificar antes de commitear que nadie lo tomó en `origin/main`. Misma firma que hoy en las dos funciones: `CREATE OR REPLACE`, sin `DROP`, sin cambios de grants.
- La 410 se aplica en producción **antes** de mergear el código (el código nuevo manda costos convertidos que la función vieja ignoraría y guardaría el costo crudo en divisa).
- Textos de UI y errores en español rioplatense (vos).
- Todo trabajo en la rama `feat/multimoneda-s5` (worktree en el scratchpad), nunca en el checkout principal. Ningún subagente se conecta a la base.
- Fuera de alcance: órdenes (S6) y cotizaciones (S7) siguen rechazando ítems en divisa (guarda 10b de S4); `PUT /api/ventas/[id]` también la conserva para líneas **nuevas** en divisa; comprobantes/PDF/ticket con el detalle de la conversión (D3); cobros en divisa (fase 2); E2E con Playwright (ver Ruling al final).

## Review Focus

1. **La cotización en vivo cambia entre que el cajero arma el carrito y confirma** → 409 `COTIZACION_CAMBIO`; el POS adopta la nueva, reconvierte las líneas en divisa, muestra el total nuevo y el segundo "Confirmar" vende. Tests en Tasks 3 y 5.
2. **Una venta apartada se recupera después de que cambió la cotización, o la org pasó de USD a EUR, o apagó la función** → las líneas en divisa se reconvierten con la cotización actual, o se quitan del carrito avisando el motivo; nunca se cobra el precio viejo. Test en Task 5.
3. **Recargo por método de pago y descuento por línea en una línea en USD** → la conversión va antes del recargo y el descuento se aplica en local (REQ-3.2): US$ 10 × 1.200 = $12.000, +10 % = $13.200, −10 % de descuento por línea = $11.880. Test en Task 3.
4. **Se apaga la función (o se queda sin cotización) con un producto en USD en el carrito** → al confirmar, 409 con el nombre del producto y el motivo; el POS lo muestra y no vende. Tests en Tasks 3 y 5.
5. **Editar una venta pasada que tiene una línea en USD** (`PUT /api/ventas/[id]`) → si la línea queda con el mismo precio conserva su foto de origen; si el precio cambió, la foto se borra (pasa a ser una línea local); el costo nunca se reemplaza por el `precio_compra` crudo en divisa. Probes y test estático en Task 2.

---

### Task 1: decisión pura de las líneas de una venta (`lib/currency/venta-divisa.ts`)

**Files:**
- Create: `lib/currency/venta-divisa.ts`
- Test: `__tests__/lib/currency-venta-divisa.test.ts`

**Interfaces:**
- Consumes: `ConfigMoneda` (`lib/currency/config-moneda.ts`), `ResultadoTipoCambio` (`lib/currency/tipo-cambio.ts`), `convertirALocal`, `unidadRedondeo` (`lib/currency/convert.ts`), `round2` (`lib/ventas/totales.ts`), `MonedaCatalogo` (`lib/currency/catalogo.ts`).
- Produces:
  - `type MotivoNoVendible = "DESHABILITADA" | "OTRA_DIVISA" | "SIN_COTIZACION"`
  - `motivoNoVendible(moneda: MonedaCatalogo, config: ConfigMoneda | null | undefined, tc: ResultadoTipoCambio | null | undefined): MotivoNoVendible | null` — `null` para local; para divisa: config ausente o `!habilitada` → `"DESHABILITADA"`; `moneda !== config.monedaExtranjera` → `"OTRA_DIVISA"`; `!tc?.disponible` → `"SIN_COTIZACION"`.
  - `mensajeNoVendible(motivo: MotivoNoVendible, nombre: string, moneda: "USD" | "EUR"): string` — textos exactos:
    - DESHABILITADA: `"\"{nombre}\" tiene precio en {moneda} y la moneda extranjera está deshabilitada."`
    - OTRA_DIVISA: `"\"{nombre}\" tiene precio en {moneda}, que ya no es la divisa de la organización."`
    - SIN_COTIZACION: `"No hay cotización de {moneda} disponible para vender \"{nombre}\". Cargá una manual en Configuración → Operativa."`
  - `interface ItemCatalogoVenta { id: string; nombre: string; moneda: MonedaCatalogo; precioVenta: number; precioCompra: number | null }`
  - `interface LineaPedidaDivisa { inventarioId?: string | null; precioOrigen?: number | null }`
  - `type ResultadoLineasDivisa = { ok: true; lineas: Array<{ moneda: "USD" | "EUR"; precioOrigen: number; precioLocal: number; costoLocal: number | null } | null>; tipoCambio: number | null } | { ok: false; motivo: MotivoNoVendible; mensaje: string }`
  - `resolverLineasDivisa(params: { lineas: LineaPedidaDivisa[]; catalogo: Map<string, ItemCatalogoVenta>; config: ConfigMoneda | null; tc: ResultadoTipoCambio | null }): ResultadoLineasDivisa` — una entrada por línea pedida, en el mismo orden: `null` para líneas locales o libres (sin `inventarioId`, o ítem con `moneda` null, o id que no está en el catálogo); objeto para las de divisa. `precioOrigen` = `round2(linea.precioOrigen)` si es número finito > 0, si no `round2(item.precioVenta)`. `costoLocal` = `convertirALocal(round2(precioCompra), tc, unidad)` o `null` si `precioCompra` es null/negativo/no finito. `tipoCambio` = `tc.valor` si hubo al menos una línea en divisa, si no `null`. La primera línea no vendible corta con `ok: false`.
  - `aplicarCotizacionLineas<T extends { moneda?: "USD" | "EUR" | null; precioOrigen?: number | null; precioUnitario: number }>(lineas: T[], tc: number, unidad: number): T[]` — para el POS: recalcula `precioUnitario = convertirALocal(precioOrigen, tc, unidad)` en las líneas con `moneda` y `precioOrigen` válidos; las demás quedan idénticas (misma referencia).

- [ ] **Step 1: tests que fallan** en `__tests__/lib/currency-venta-divisa.test.ts`, con `config = { habilitada: true, monedaExtranjera: "USD", monedaLocal: "ARS", redondeoConversion: 10, ... }` y `tc = { disponible: true, valor: 1200, fuente: "BLUE", moneda: "USD", en: "...", estado: "vivo" }`:
  - `motivoNoVendible(null, config, tc)` → `null`; `("USD", {...config, habilitada:false}, tc)` → `"DESHABILITADA"`; `("EUR", config, tc)` → `"OTRA_DIVISA"`; `("USD", config, {disponible:false, motivo:"SIN_COTIZACION"})` → `"SIN_COTIZACION"`; `("USD", undefined, tc)` → `"DESHABILITADA"`.
  - `mensajeNoVendible("SIN_COTIZACION", "Funda", "USD")` contiene `"Configuración → Operativa"` y `"\"Funda\""`.
  - `resolverLineasDivisa`: catálogo con `a` local (precioVenta 500) y `u` USD (precioVenta 10, precioCompra 6.04): líneas `[{inventarioId:"a"}, {inventarioId:"u"}, {inventarioId:null}]` → `lineas[0] === null`, `lineas[2] === null`, `lineas[1]` = `{ moneda:"USD", precioOrigen:10, precioLocal:12000, costoLocal:7250 }` (6.04×1200 = 7248 → unidad 10 → 7250), `tipoCambio: 1200`.
  - El precio de origen del request gana y se redondea: `{inventarioId:"u", precioOrigen: 12.346}` → `precioOrigen: 12.35`, `precioLocal: 14820`.
  - `precioOrigen: 0` o negativo en el request → se usa el del catálogo (10).
  - `precioCompra: null` → `costoLocal: null`.
  - Sin líneas en divisa → `ok: true`, `tipoCambio: null`, todas `null` (aunque la función esté apagada).
  - Función apagada con una línea USD → `ok:false, motivo:"DESHABILITADA"`, `mensaje` con el nombre.
  - `aplicarCotizacionLineas([{moneda:"USD", precioOrigen:10, precioUnitario:1}, local], 1300, 10)` → primera `precioUnitario: 13000`; la local es la misma referencia.
- [ ] **Step 2:** `npx vitest run __tests__/lib/currency-venta-divisa.test.ts` → FAIL (módulo inexistente).
- [ ] **Step 3:** implementar `lib/currency/venta-divisa.ts` (puro: sin imports de servidor; lo importa el POS).
- [ ] **Step 4:** mismo comando → PASS.
- [ ] **Step 5:** commit `feat(multimoneda): decisión pura de líneas en divisa para ventas`.

---

### Task 2: migración 410 (`crear_venta_atomica` y `editar_venta_atomica` guardan la foto de origen)

**Files:**
- Create: `supabase/migrations/410_multimoneda_ventas.sql`, `supabase/migrations/rollback/410_rollback.sql`, `supabase/migrations/verify/410_probes.sql`
- Test: `__tests__/multimoneda-ventas-migration.test.ts`
- Read (fuente de los cuerpos): `supabase/migrations/406_pos_no_vende_stock_reservado.sql` (`crear_venta_atomica` vigente), `supabase/migrations/372_editar_venta_factura_anulada.sql` (`editar_venta_atomica` vigente), `supabase/migrations/409_multimoneda_catalogo.sql` y `verify/409_probes.sql` (estilo de probes con `pg_temp.probe`).

**Interfaces:**
- Produces (contrato de `p_items`, claves nuevas y opcionales por ítem): `monedaOrigen` (`'USD'|'EUR'`), `precioOrigen` (numeric), `tipoCambio` (numeric > 0), `tipoCambioFuente` (text), `costoUnitario` (numeric local, puede faltar o ser null). Un ítem sin `monedaOrigen` es local y se comporta exactamente como hoy, salvo la regla de costo de abajo.

- [ ] **Step 1: test estático que falla** (`__tests__/multimoneda-ventas-migration.test.ts`, mismo estilo que `__tests__/multimoneda-catalogo-migration.test.ts`): el archivo 410 existe; tiene `SET LOCAL lock_timeout = '3s'`; no tiene `BEGIN`/`COMMIT` ni `DROP FUNCTION`; contiene `CREATE OR REPLACE FUNCTION public.crear_venta_atomica(` con **la misma lista de parámetros que la 406** (comparar el texto de la firma extraído de ambos archivos) y `CREATE OR REPLACE FUNCTION editar_venta_atomica(` con la misma firma que la 372; el `INSERT INTO items_venta` de ambas incluye `moneda_origen, precio_origen, tipo_cambio`; `crear_venta_atomica` inserta `tipo_cambio, tipo_cambio_fuente` en `ventas`; existe el `RAISE` `'TIPO_CAMBIO_MIXTO'`; el rollback recrea las dos funciones con los cuerpos de 406 y 372 (comparar que contenga sus firmas y no mencione `moneda_origen`); los probes empiezan con `BEGIN` y terminan con `ROLLBACK`.
- [ ] **Step 2:** `npx vitest run __tests__/multimoneda-ventas-migration.test.ts` → FAIL.
- [ ] **Step 3: escribir la 410** copiando los dos cuerpos vigentes y cambiando solo esto:
  - `crear_venta_atomica`, antes del `INSERT INTO ventas`: recorrer `p_items`; si algún ítem trae `monedaOrigen`, todos los que lo traen deben tener la misma `monedaOrigen` y el mismo `tipoCambio` > 0, si no `RAISE EXCEPTION 'TIPO_CAMBIO_MIXTO' USING ERRCODE = '22023'`. Guardar `v_tc` y `v_tc_fuente` del primero; el `INSERT INTO ventas` agrega `tipo_cambio, tipo_cambio_fuente` (`NULL` si no hay líneas en divisa).
  - `crear_venta_atomica`, costo por ítem: si trae `monedaOrigen` → `v_inv_costo := NULLIF(v_item->>'costoUnitario','')::DECIMAL` (sin mirar el inventario). Si no trae: como hoy, pero la lectura del inventario es `SELECT precio_compra, moneda` y si `moneda IS NOT NULL` el costo queda `NULL` (y no se toma el `costo` del ítem): nunca se guarda un costo crudo en divisa como local.
  - `crear_venta_atomica`, `INSERT INTO items_venta`: agrega `moneda_origen, precio_origen, tipo_cambio` desde las claves del ítem (`NULL` si no vienen).
  - `editar_venta_atomica`: junto a `v_costos`, armar `v_origenes` (misma clave por producto o descripción) con `moneda_origen, precio_origen, tipo_cambio, precio_unitario` de las líneas viejas con `moneda_origen IS NOT NULL`. Al reinsertar, si hay origen para la clave **y** el `precioUnitario` nuevo es igual al `precio_unitario` viejo, se copian los tres campos; si no, quedan `NULL`. El costo de fallback desde el inventario sigue la misma regla: `NULL` si `inventario.moneda IS NOT NULL`. Si la venta no conserva ninguna línea con origen, `ventas.tipo_cambio` y `tipo_cambio_fuente` quedan como estaban (no se tocan).
  - Rollback: los dos `CREATE OR REPLACE` con los cuerpos exactos de 406 y 372.
  - Probes (con una org de prueba creada en el archivo, al estilo de `verify/409_probes.sql`): una venta con una línea local y una USD (`monedaOrigen USD, precioOrigen 10, tipoCambio 1200, costoUnitario 7250`) guarda en `ventas` `tipo_cambio 1200` y la fuente, en la línea USD los tres campos y `costo_unitario_snapshot 7250`, en la local los tres en NULL; dos líneas con `tipoCambio` distinto → `22023 TIPO_CAMBIO_MIXTO`; un ítem de inventario en USD sin `monedaOrigen` → `costo_unitario_snapshot` NULL; editar la venta sin cambiar el precio de la línea USD conserva la foto; editarla cambiando el precio la pone en NULL; una venta sin divisa da `ventas.tipo_cambio` NULL y los mismos `subtotal/total` que antes; el rehearsal del rollback deja las funciones sin mención a `moneda_origen`.
- [ ] **Step 4:** mismo comando → PASS.
- [ ] **Step 5:** commit `feat(multimoneda): migración 410 (la venta guarda la foto de origen y la cotización)`.

---

### Task 3: `POST /api/ventas` convierte las líneas en divisa

**Files:**
- Modify: `app/api/ventas/route.ts`
- Test: `__tests__/api/ventas-multimoneda.test.ts` (nuevo); ajustar los mocks de `__tests__/api/ventas*.test.ts` que se rompan por la lectura nueva de inventario.

**Interfaces:**
- Consumes: Task 1 (`resolverLineasDivisa`, `ItemCatalogoVenta`), `cargarConfigMoneda`, `resolverTipoCambio` (`lib/currency/tipo-cambio.server.ts`), `calcularTotalesMultimoneda` (`lib/currency/convert.ts`), Task 2 (claves de `p_items`).
- Produces (contrato con el POS, Task 4 y 5):
  - Request: cada ítem acepta `precioOrigen?: number` (> 0) y el body `tipoCambio?: number | null`. Cualquier `moneda` que mande el cliente se ignora (no está en el schema).
  - 409 `{ error, code: "COTIZACION_CAMBIO", anterior: number | null, nueva: ResultadoTipoCambio }` con `error` = `"La cotización cambió de {anterior} a {nueva}. Revisá el total y confirmá de nuevo."` (números con `formatCurrencyValue` en la moneda local; `anterior` ausente → `"La venta necesita la cotización vigente ({nueva}). Revisá el total y confirmá de nuevo."`).
  - 409 `{ error: mensajeNoVendible(...), code: "DIVISA_NO_DISPONIBLE", motivo }` cuando una línea en divisa no se puede vender.
  - La respuesta 201 no cambia de forma (los ítems de `formatVenta` ya traen lo que trae la fila).

- [ ] **Step 1: tests que fallan** (`__tests__/api/ventas-multimoneda.test.ts`, mocks con `__tests__/api/helpers.ts`; `cargarConfigMoneda` y `resolverTipoCambio` mockeados como en `__tests__/api/inventario-valuacion-moneda.test.ts`):
  - USD habilitada, tc 1200, unidad 10; ítem `u` USD (precio_venta 10, precio_compra 6.04): body con `tipoCambio: 1200` y el ítem con `precioUnitario: 1` (mentira del cliente) → 201; el RPC recibe el ítem con `precioUnitario: 12000`, `monedaOrigen: "USD"`, `precioOrigen: 10`, `tipoCambio: 1200`, `tipoCambioFuente: "BLUE"`, `costoUnitario: 7250`, y `p_total` 12000.
  - `precioOrigen: 12` en el ítem → `precioUnitario: 14400`, `precioOrigen: 12`.
  - Review Focus 3: método con recargo 10 % (mock de `getRecargosMetodo` como en `ventas-recargo-metodo.test.ts`) → el ítem con `precioUnitario` 13200 y `p_total` 13200; con además un descuento por línea `PORCENTAJE` 10 → `p_total` 11880.
  - `tipoCambio: 1100` con servidor en 1200 → 409 `COTIZACION_CAMBIO`, `anterior: 1100`, `nueva.valor: 1200`, y el RPC no se llamó. Sin `tipoCambio` en el body y con una línea USD → mismo 409 con `anterior: null`.
  - Review Focus 4: función apagada (o `resolverTipoCambio` → `{disponible:false, motivo:"SIN_COTIZACION"}`) con la línea USD → 409 `DIVISA_NO_DISPONIBLE` con el nombre, RPC no llamado.
  - Regresión: una venta solo con ítems locales (sin `tipoCambio` en el body) da el mismo `p_total`, `p_subtotal` y `p_items` que antes de este cambio (sin claves nuevas en los ítems) y **no** llama a `resolverTipoCambio`.
  - Un ítem que no es de la org (no vuelve en la lectura de inventario) se trata como hoy (línea local con el precio del request).
- [ ] **Step 2:** `npx vitest run __tests__/api/ventas-multimoneda.test.ts` → FAIL.
- [ ] **Step 3: implementar en la ruta:**
  - Quitar la llamada a `rechazarItemsEnDivisa` del POST (la guarda queda en el resto de las rutas).
  - Después de validar el body, una sola lectura `inventario` `select("id, nombre, moneda, precio_venta, precio_compra").in("id", ids).eq("organization_id", org)` con los `inventarioId` distintos del pedido (un carrito no pasa de unas decenas). Error `42703` → tratar todo como local.
  - Si algún ítem leído tiene `moneda` no nula: `cargarConfigMoneda` + `resolverTipoCambio` (una vez), `resolverLineasDivisa`; `ok:false` → 409 `DIVISA_NO_DISPONIBLE`; `tipoCambio` del body distinto de `tc.valor` → 409 `COTIZACION_CAMBIO`. Si ninguno tiene moneda, no se llama a nada de esto.
  - Totales con `calcularTotalesMultimoneda({ lineas, tipoCambio, redondeoConversion, monedaLocal, global, fiscal, roundCash, factor })` donde cada línea en divisa lleva `moneda` y `precioOrigen` del resultado de Task 1; usar `resultado.lineas[i].precioUnitario` para armar `pItems` (con `lineaConRecargo` como hoy). Las líneas en divisa agregan a `pItems` `monedaOrigen`, `precioOrigen`, `tipoCambio`, `tipoCambioFuente` (`tc.fuente`) y `costoUnitario` (`costoLocal`, puede ser null) y nunca el `costo` del request.
- [ ] **Step 4:** mismo comando → PASS; `npx vitest run __tests__/api/ventas` sin regresiones (listar cada mock ajustado en el reporte).
- [ ] **Step 5:** commit `feat(multimoneda): POST /api/ventas convierte las líneas en divisa con la cotización del servidor`.

---

### Task 4: datos del POS (tipos, payload, búsqueda y apartadas)

**Files:**
- Modify: `components/pos/pos-types.ts`, `components/pos/pos-payload.ts`, `app/api/inventario/search/route.ts`, `app/api/inventario/check-stock/route.ts`
- Test: `components/pos/__tests__/pos-payload-divisa.test.ts` (nuevo), `__tests__/api/inventario-search*.test.ts` y `__tests__/api/inventario-check-stock.test.ts` (extender)

**Interfaces:**
- Consumes: Task 3 (contrato del request).
- Produces:
  - `PosCartItem` suma `moneda?: "USD" | "EUR" | null` y `precioOrigen?: number | null` (en una línea en divisa `precioUnitario` es el local ya convertido).
  - `InventarioResult` suma `moneda?: "USD" | "EUR" | null`.
  - `BuildVentaPayloadInput` suma `tipoCambio?: number | null`; `VentaPayload` suma `tipoCambio?: number` (solo si algún ítem tiene `moneda`) y cada ítem `precioOrigen?: number` (solo en líneas con `moneda`).
  - `GET /api/inventario/search` devuelve `moneda` en cada resultado (agregar `moneda` a los dos `select` de la línea 18-20 y al objeto de respuesta; `null` si falta).
  - `POST /api/inventario/check-stock` con `precios: true` agrega `monedas: Record<string, "USD" | "EUR" | null>` (misma lectura, `select("id, precio_venta, moneda")`).
- [ ] **Step 1: tests que fallan:** `buildVentaPayload` con una línea USD (`moneda:"USD", precioOrigen:10, precioUnitario:12000`) y `tipoCambio: 1200` → el ítem lleva `precioOrigen: 10`, el payload `tipoCambio: 1200`; sin líneas en divisa → ni `tipoCambio` ni `precioOrigen` en el JSON (igual que hoy). Search devuelve `moneda: "USD"` para una fila USD y `null` para una local. Check-stock con `precios: true` devuelve `monedas`.
- [ ] **Step 2:** correr esos tests → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** PASS; `npx vitest run components/pos __tests__/api/inventario-search __tests__/api/inventario-check-stock` sin regresiones.
- [ ] **Step 5:** commit `feat(multimoneda): el POS conoce la moneda de cada producto y la manda al vender`.

---

### Task 5: POS — cotización en uso, líneas en divisa y 409

**Files:**
- Create: `components/moneda/chip-cotizacion.tsx`
- Modify: `components/pos/pos-terminal.tsx`, `components/pos/pos-cart.tsx`, `components/pos/pos-checkout-dialog.tsx`, `components/pos/pos-product-search.tsx`, `components/pos/pos-variantes-sheet.tsx`
- Test: `components/pos/__tests__/pos-divisa.test.tsx` (nuevo), `components/moneda/__tests__/chip-cotizacion.test.tsx` (nuevo)

**Interfaces:**
- Consumes: `useMoneda()` (`hooks/use-moneda.ts`), Task 1 (`motivoNoVendible`, `mensajeNoVendible`, `aplicarCotizacionLineas`), `unidadRedondeo`, `etiquetaFuente`, `PrecioEnMoneda` (`components/moneda/precio-en-moneda.tsx`), Task 3 (409), Task 4 (tipos).
- Produces: `ChipCotizacion({ tipoCambio, monedaLocal }: { tipoCambio: ResultadoTipoCambio | undefined; monedaLocal: string })` — `null` si no hay datos o `motivo: "DESHABILITADA"`; si `disponible`: `"{moneda} {fuente} · {valor en moneda local} · hace {antigüedad}"` (antigüedad como `hace()` de `components/configuracion/moneda-config.tsx`: moverla a `lib/currency/antiguedad.ts` como `antiguedad(en: string, ahora?: Date): string` y usarla en los dos lugares), con estilo de advertencia si `estado === "referencia"`; si `SIN_COTIZACION`: `"Sin cotización de {moneda}"` con link a `/configuracion` (pestaña Operativa, la misma ruta que usa el resto de la app para esa pestaña).

Comportamiento:
- El terminal usa `useMoneda()`; la cotización en uso del carrito es `tipoCambio.valor` (estado propio `tcCarrito`, inicializado con la del hook y actualizado cuando el hook trae una nueva o llega un 409). Cada vez que `tcCarrito` cambia, `setCartItems(items => aplicarCotizacionLineas(items, tcCarrito, unidad))`.
- `addProduct`: si `product.moneda` y `motivoNoVendible(...)` no es null → `showError(mensajeNoVendible(...))` y no agrega. Si se puede: la línea nace con `moneda`, `precioOrigen = product.precioVenta` y `precioUnitario = convertirALocal(...)`. Mismo camino para el escaneo de código de barras (usa `addProduct`).
- Búsqueda y hoja de variantes: un resultado en divisa muestra el precio con `PrecioEnMoneda` y, si no es vendible, aparece deshabilitado con el motivo como texto secundario (REQ-6.3).
- Carrito: una línea en divisa muestra `"US$ 50 → $ 60.000"` (REQ-3.4); el campo "Precio unit." de esa línea edita `precioOrigen` en la divisa (prefijo con el código) y reconvierte (REQ-3.6). El chip va arriba del carrito cuando hay alguna línea en divisa o la función está habilitada.
- Checkout: `buildVentaPayload({..., tipoCambio: tcCarrito })`. Ante 409 `COTIZACION_CAMBIO`: llamar a una prop nueva `onCotizacionCambiada(nueva: number)` (el terminal la guarda en `tcCarrito`, lo que reconvierte), mostrar `error` y dejar el diálogo abierto con el total recalculado; el idempotencyKey no cambia. Ante 409 `DIVISA_NO_DISPONIBLE`: mostrar `error` y dejar el diálogo abierto.
- Venta apartada recuperada (`recallSale`): las líneas en divisa se reconvierten con `tcCarrito`; las no vendibles se quitan y se avisa con `mensajeNoVendible` por cada una. `avisarCambiosApartada` compara el precio de lista contra `precioOrigen` en las líneas en divisa (y usa `monedas` de check-stock para avisar si el producto cambió de moneda).

- [ ] **Step 1: tests que fallan** (`pos-divisa.test.tsx`, con `useMoneda` y `fetch` mockeados como en los tests existentes de `components/pos/__tests__/`):
  - agregar un producto USD 10 con tc 1200 / unidad 10 → el carrito muestra "US$ 10" y "$ 12.000" y el total $ 12.000.
  - con la función apagada → no se agrega y se ve el mensaje DESHABILITADA.
  - editar el precio de la línea a 12 → total $ 14.400.
  - Review Focus 1: el POST responde 409 `COTIZACION_CAMBIO` con `nueva.valor: 1300` → el diálogo sigue abierto, se ve el mensaje y el total pasa a $ 13.000; el segundo confirmar manda `tipoCambio: 1300` y el mismo `idempotencyKey`.
  - Review Focus 2: recuperar una apartada con una línea USD cuando el hook ya trae tc 1300 → total $ 13.000; con la función apagada → la línea se quita y se avisa.
  - `chip-cotizacion.test.tsx`: vivo, referencia (clase de advertencia) y sin cotización (link a configuración).
- [ ] **Step 2:** correr → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** PASS; `npx vitest run components/pos components/moneda components/configuracion` sin regresiones (`pos-terminal-escaneo` es inestable por carga: si falla, correrlo solo).
- [ ] **Step 5:** commit `feat(multimoneda): el POS vende productos en divisa con la cotización a la vista`.

---

### Task 6: verificación completa, aplicar la 410 y PR

- [ ] **Step 1:** `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` → 0 errores; `npx eslint` sobre los archivos cambiados → 0 errores; `npx vitest run` completo → 0 fallos.
- [ ] **Step 2:** confirmar que `410` sigue libre en `origin/main` y en las demás ramas (`git for-each-ref` + `git ls-tree`); si no, renumerar (archivo, rollback, probes, test).
- [ ] **Step 3 (requiere OK del usuario):** `node scripts/db-run.mjs supabase/migrations/410_multimoneda_ventas.sql` (dry-run), revisar, `--apply`, correr `verify/410_probes.sql`, y `NOTIFY pgrst, 'reload schema'`.
- [ ] **Step 4 (requiere OK del usuario):** push y PR con el orden de despliegue: 410 aplicada **antes** de mergear.

---

## Rulings tomados al escribir el plan

- **Precio de origen editable:** REQ-3.1 (el precio sale del ítem) y REQ-3.6 (se edita en divisa) se concilian así: la moneda siempre la decide el servidor; el precio de origen del request se acepta (misma confianza que el precio local editable de hoy) y, si falta, se usa el del catálogo. Lo que nunca se acepta del cliente es el precio local de una línea en divisa ni su costo. Si estuviera mal: un cajero puede vender un producto en USD a otro precio en USD, igual que hoy puede hacerlo en pesos.
- **Misma firma en la 410:** los campos de origen y la cotización viajan en `p_items` en vez de parámetros nuevos, así no hay `DROP`, ni overloads, ni cambios de grants, y `convertir_cotizacion_venta_atomica` y el fallback de `convertir-venta` siguen llamando igual. Costo si estuviera mal: ninguno funcional; `ventas.tipo_cambio` se deriva de los ítems.
- **Edición de ventas:** el PUT no convierte (sigue rechazando líneas nuevas en divisa); la 410 conserva la foto de las líneas que quedan con el mismo precio. Costo si estuviera mal: una línea en divisa editada de precio pierde su foto y queda como local.
- **Sin E2E de Playwright:** los specs autenticados corren solo contra un tenant de QA real y prender multimoneda ahí cambia datos de una organización; la cobertura del flujo completo queda en el test de ruta de Task 3 (precio, total, foto y 409) y los de componentes de Task 5. Costo si estuviera mal: un error de integración entre el POS real y la API que los mocks no ven.
