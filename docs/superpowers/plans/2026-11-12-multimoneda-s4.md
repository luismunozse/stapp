# Multimoneda S4: catálogo en moneda local, USD o EUR (plan de implementación)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que inventario (con variantes y kits) y servicios puedan tener su precio en la moneda extranjera de la organización, con el equivalente local a la vista, valuación y costos de kit convertidos, y toda ruta de alta escribiendo `moneda` de forma explícita.

**Architecture:** las columnas `inventario.moneda` y `servicios.moneda` ya existen (365, aplicada el 2026-11-12; NULL = local). Toda la lógica de moneda del catálogo es pura y vive en `lib/currency/catalogo.ts`; las rutas la usan con la configuración y la cotización que resuelve el servidor (`cargarConfigMoneda` / `resolverTipoCambio`, S3). La UI comparte tres piezas en `components/moneda/`. La única SQL nueva es la 408: la moneda se sincroniza dentro de un grupo de variantes y `calcular_costo_kit` convierte los componentes en divisa.

**Tech Stack:** Next.js 16 App Router, Supabase (supabaseAdmin), zod, SWR, vitest + Testing Library, SQL a mano con `scripts/db-run.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-11-multimoneda-design.md` (REQ-2.1 a REQ-2.10, REQ-6.1, REQ-6.3, REQ-6.5, REQ-6.6)

## Global Constraints

- `moneda` del catálogo: `NULL` (local) o exactamente el código `config.monedaExtranjera` (`'USD'` o `'EUR'`). Nunca el código de la moneda local.
- La moneda aplica a la vez a `precio_venta` y `precio_compra` (inventario) y a `precio` (servicios). Los números guardados están **en esa moneda**; nada se convierte al guardar salvo que el usuario elija "Convertir" (REQ-2.3).
- Conversión a local: `convertirALocal(precio, tc, unidadRedondeo(config.redondeoConversion, config.monedaLocal))` de `lib/currency/convert.ts`. Nunca con 0, vacío o precio inválido (REQ-6.6).
- Un ítem cuya `moneda` no coincide con la `monedaExtranjera` actual (la org cambió de USD a EUR), o sin cotización disponible, **no tiene equivalente**: se trata como "sin cotización" (excluido de valuación, costo de kit "no disponible").
- Con la función apagada se puede **mantener** o **quitar** la divisa de un ítem existente, pero no poner una nueva (400 `"La moneda extranjera está deshabilitada"`).
- La cotización la resuelve el servidor (REQ-1.8); el navegador solo la usa para mostrar el equivalente.
- Migraciones: aditivas salvo lo indicado, re-ejecutables, `SET LOCAL lock_timeout = '3s'`, sin `BEGIN/COMMIT`; rollback y probes propios. Siguiente número libre: **408** (verificar antes de commitear que nadie lo tomó en `origin/main`).
- Textos de UI y errores en español rioplatense (vos).
- Todo trabajo en la rama `feat/multimoneda-s4` (worktree en el scratchpad), nunca en el checkout principal.
- Fuera de alcance (D3/§8): columna de moneda en el import CSV y en el alta masiva (escriben `moneda: null`), PDF/comprobantes, POS y órdenes (S5/S6).

## Review Focus

1. **La org pasó de USD a EUR con productos en USD** → esos productos muestran "US$ 50" sin equivalente ("Sin cotización para USD"), quedan fuera de la valuación con el conteo, el kit que los usa da costo "no disponible", y editarlos sin tocar la moneda no da 400. Tests en Tasks 1, 3 y 9.
2. **Función apagada con ítems en divisa** → el listado sigue mostrando "US$ 50"; el formulario permite volver a local; un POST/PUT que pone divisa nueva da 400. Tests en Tasks 1 y 3.
3. **Redondeo de proveedor (a 10 / 100) aplicado a precios en USD** → convertiría US$ 47 en US$ 50. El redondeo del ajuste por proveedor solo se aplica a ítems en moneda local; los de divisa redondean a centavos. Test en Task 10.
4. **Agrupar en variantes productos de monedas distintas** → 400 `"No se pueden agrupar productos con monedas distintas"`, nunca 500 ni un grupo mezclado. Tests en Tasks 3 y 5.
5. **Precio 0 o vacío en divisa** → equivalente `$ 0` o nada, sin excepción en el render (convertirALocal no se llama con precio inválido). Test en Tasks 1 y 2.

---

### Task 1: lógica pura del catálogo (`lib/currency/catalogo.ts`)

**Files:**
- Create: `lib/currency/catalogo.ts`
- Test: `__tests__/lib/currency-catalogo.test.ts`

**Interfaces:**
- Consumes: `ConfigMoneda` (`lib/currency/config-moneda.ts`), `ResultadoTipoCambio` (`lib/currency/tipo-cambio.ts`), `convertirALocal`, `unidadRedondeo`, `MonedaExtranjera` (`lib/currency/convert.ts`).
- Produces:
  - `type MonedaCatalogo = MonedaExtranjera | null`
  - `validarMonedaEscritura(pedida: unknown, actual: MonedaCatalogo | undefined, config: ConfigMoneda): { ok: true; moneda: MonedaCatalogo } | { ok: false; error: string }`. `pedida === undefined` → `{ok, moneda: actual ?? null}`; `null` → siempre ok; un código igual a `actual` → ok aunque la función esté apagada o la moneda extranjera haya cambiado; un código nuevo → ok solo si `config.habilitada && pedida === config.monedaExtranjera`; si no, `"La moneda extranjera está deshabilitada"` (apagada) o `"La moneda del precio debe ser la moneda local o ${config.monedaExtranjera}"`.
  - `cotizacionDe(moneda: MonedaCatalogo, config: ConfigMoneda, tc: ResultadoTipoCambio | null): number | null` → `1` para local; `tc.valor` si `moneda === config.monedaExtranjera` y `tc?.disponible`; si no, `null`.
  - `precioALocal(precio: number | null | undefined, moneda: MonedaCatalogo, config: ConfigMoneda, tc: ResultadoTipoCambio | null): number | null` → local: el precio (o `null` si no es finito); divisa: `convertirALocal` con `unidadRedondeo(config.redondeoConversion, config.monedaLocal)`, o `null` sin cotización o con precio no finito / negativo. `0` → `0`.
  - `convertirPrecioCatalogo(precio: number, de: MonedaCatalogo, a: MonedaCatalogo, tc: number, unidad: number): number` → local→divisa: `round2(precio / tc)`; divisa→local: `convertirALocal(precio, tc, unidad)`; misma moneda → el precio.
  - `etiquetaFuente(f: FuenteTipoCambio): string` → `MANUAL: "Manual"`, `OFICIAL: "Oficial"`, `BLUE: "Blue"`, `MEP: "MEP"`.
  - `costoKitLocal(componentes: { cantidad: number; precioCompra: number | null; moneda: MonedaCatalogo }[], config: ConfigMoneda, tc: ResultadoTipoCambio | null): number | null` → suma `cantidad × precioALocal(precioCompra ?? 0, …)`, redondeada a centavos; `null` si algún componente no tiene equivalente.
  - `valorLocalStock<T extends { moneda: MonedaCatalogo }>(items: T[], monto: (i: T) => number, config, tc): { total: number; excluidos: number; convertido: boolean }` → suma en local; `excluidos` cuenta los ítems sin equivalente; `convertido` es true si entró al menos un ítem en divisa (la UI marca "≈").

- [ ] **Step 1: tests que fallan.** Con una config AR, `monedaExtranjera: "USD"`, `habilitada: true`, `redondeoConversion: 10`, y `tc = {disponible: true, valor: 1200, fuente: "BLUE", moneda: "USD", en, estado: "vivo"}`:
  - `validarMonedaEscritura`: `undefined` sin actual → `null`; `"USD"` → ok; `"EUR"` → error con `"moneda local o USD"`; `"ARS"` → error; con `habilitada: false`: `"USD"` nuevo → `"La moneda extranjera está deshabilitada"`, `"USD"` con `actual: "USD"` → ok, `null` → ok; con `monedaExtranjera: "EUR"` y `actual: "USD"`, `"USD"` → ok (se mantiene).
  - `precioALocal(50, "USD", …)` → `60000`; `precioALocal(49.99, "USD", …)` → `59990`; `precioALocal(0, "USD", …)` → `0`; `precioALocal(50, "USD", config EUR, tcEUR)` → `null`; `precioALocal(50, "USD", …, {disponible:false, motivo:"SIN_COTIZACION"})` → `null`; `precioALocal(-1, "USD", …)` → `null` sin throw; `precioALocal(500, null, …)` → `500`.
  - `convertirPrecioCatalogo(60000, null, "USD", 1200, 10)` → `50`; `(50, "USD", null, 1200, 10)` → `60000`; `(10, null, "USD", 3, 0)` → `3.33`.
  - `costoKitLocal([{cantidad:2, precioCompra:10, moneda:"USD"}, {cantidad:1, precioCompra:500, moneda:null}])` → `24500`; con un componente EUR en org USD → `null`.
  - `valorLocalStock` con 1 local (1000), 1 USD (10 → 12000) y 1 EUR → `{total: 13000, excluidos: 1, convertido: true}`; solo locales → `convertido: false`.
- [ ] **Step 2:** `npx vitest run __tests__/lib/currency-catalogo.test.ts` → FAIL (módulo inexistente).
- [ ] **Step 3:** implementar `lib/currency/catalogo.ts` con esas firmas (sin I/O; importable desde cliente y servidor).
- [ ] **Step 4:** mismo comando → PASS.
- [ ] **Step 5:** commit `feat(multimoneda): lógica pura de moneda del catálogo`.

### Task 2: piezas de UI compartidas (`components/moneda/`)

**Files:**
- Create: `components/moneda/selector-moneda.tsx`, `components/moneda/precio-en-moneda.tsx`, `components/moneda/equivalente-local.tsx`
- Test: `__tests__/components/moneda-catalogo-ui.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`precioALocal`, `etiquetaFuente`, `MonedaCatalogo`), `useMoneda()` (`hooks/use-moneda.ts`), `formatCurrencyValue` (`lib/currency.ts`), `useCurrency().formatPrice`.
- Produces:
  - `<SelectorMoneda value={MonedaCatalogo} onChange={(m: MonedaCatalogo) => void} disabled?>`: `<select>` nativo con label "Moneda del precio" y opciones `"{monedaLocal} (local)"` y `config.monedaExtranjera`. No se renderiza (`null`) si la función está apagada **y** `value` es `null`; si está apagada con `value` en divisa, muestra las dos opciones y el texto "La moneda extranjera está deshabilitada: podés volver a moneda local."
  - `<PrecioEnMoneda monto={number|null} moneda={MonedaCatalogo}>`: local → `formatPrice(monto)`; divisa → `formatCurrencyValue(monto, moneda)`.
  - `<EquivalenteLocal monto={number|null} moneda={MonedaCatalogo}>`: nada para local. Para divisa, una línea pequeña: con cotización viva `"≈ {formatPrice(eq)} hoy ({etiquetaFuente}, {tc})"`; con referencia `"≈ {formatPrice(eq)} ({etiquetaFuente}, {tc}, de hace {h} h)"`; sin equivalente `"Sin cotización para {moneda}"`. `{tc}` con `toLocaleString("es-AR", {maximumFractionDigits: 6})`.

- [ ] **Step 1: tests que fallan** (mock de `useMoneda` y de `useCurrency`): selector oculto con función apagada y `null`; visible con función apagada y `"USD"` con el texto de ayuda; `onChange(null)` al elegir local; `EquivalenteLocal` con USD 50 y tc 1200 Blue vivo contiene `"hoy (Blue, 1.200)"` y el monto `60.000`; con referencia de hace 3 h contiene `"de hace 3 h"`; con org EUR y moneda USD muestra `"Sin cotización para USD"`; con monto `null` no lanza.
- [ ] **Step 2:** `npx vitest run __tests__/components/moneda-catalogo-ui.test.tsx` → FAIL.
- [ ] **Step 3:** implementar los tres componentes.
- [ ] **Step 4:** mismo comando → PASS.
- [ ] **Step 5:** commit `feat(multimoneda): selector de moneda y equivalente local`.

### Task 3: API de inventario con `moneda` (alta, edición, listado, grupos, v1, webhooks)

**Files:**
- Modify: `app/api/inventario/route.ts` (schema :16-45, insert :253-271, `LISTA_SELECT_BASE` :52-54, filtros), `app/api/inventario/[id]/route.ts` (schema :12, `updateData` :135), `lib/db-utils.ts:288-342` (`formatInventario`), `app/api/inventario/grupos/[id]/route.ts` (PUT :213), `lib/variantes-schema.ts` (`guardarGrupoSchema` :162), `app/api/v1/inventario/route.ts:5-6`, `lib/inventario-eventos.ts` (created :73-84, `AUDITED_FIELDS` :11-26)
- Test: `__tests__/api/inventario-moneda.test.ts`, ampliar `__tests__/api/inventario-grupos.test.ts` y `__tests__/api/inventario-eventos-rutas.test.ts`

**Interfaces:**
- Consumes: Task 1 `validarMonedaEscritura`; `cargarConfigMoneda(orgId)` (`lib/currency/tipo-cambio.server.ts`).
- Produces:
  - Body de POST/PUT `/api/inventario[/id]`: `moneda?: "USD" | "EUR" | null`. POST sin `moneda` escribe `moneda: null` explícito (REQ-2.4). PUT sin `moneda` no toca la columna. Error de validación → 400 con el mensaje de Task 1.
  - `formatInventario` agrega `moneda: MonedaCatalogo` (siempre, también sin acceso a costo).
  - GET `/api/inventario?moneda=local|divisa` (cualquier otro valor o ausente = todas): `local` → `.is("moneda", null)`, `divisa` → `.not("moneda", "is", null)`.
  - PUT `/api/inventario/grupos/{id}`: body acepta `moneda?: MonedaCatalogo`; validada contra la moneda actual del grupo; después del RPC, si vino, `UPDATE inventario SET moneda WHERE grupo_id AND organization_id`. El error de la 408 cuyo mensaje contiene `MONEDA_GRUPO_MIXTA` → 400 `"No se pueden agrupar productos con monedas distintas"`.
  - v1 `COLUMNS` suma `moneda`. Webhook `inventario.created` suma `moneda`; `AUDITED_FIELDS` suma `moneda` (aparece en `changes` de `inventario.updated`).

- [ ] **Step 1: tests que fallan** (helpers de `__tests__/api/helpers.ts`, `cargarConfigMoneda` mockeado): POST sin `moneda` inserta `moneda: null`; POST `"USD"` con función activa inserta `"USD"`; POST `"USD"` con función apagada → 400 `"La moneda extranjera está deshabilitada"`; POST `"EUR"` en org USD → 400; PUT sin `moneda` no incluye la clave en el update; PUT `"USD"` sobre un ítem ya `"USD"` con función apagada → 200; GET `?moneda=divisa` llama `.not("moneda","is",null)`; la respuesta del listado trae `moneda`; grupos: error RPC con `MONEDA_GRUPO_MIXTA` → 400 con el texto; grupos con `moneda: "USD"` hace el update por `grupo_id`; webhook created lleva `moneda`.
- [ ] **Step 2:** `npx vitest run __tests__/api/inventario-moneda.test.ts __tests__/api/inventario-grupos.test.ts __tests__/api/inventario-eventos-rutas.test.ts` → FAIL.
- [ ] **Step 3:** implementar. Cargar la config con `cargarConfigMoneda` solo cuando el body trae `moneda` no nula (no sumar una lectura a cada alta).
- [ ] **Step 4:** mismo comando → PASS, y `npx vitest run __tests__/api/inventario` sin regresiones.
- [ ] **Step 5:** commit `feat(multimoneda): API de inventario con moneda del precio`.

### Task 4: el resto de las altas escriben `moneda` explícita (REQ-2.4)

**Files:**
- Modify: `app/api/inventario/bulk-create/route.ts:97-114`, `app/api/import/execute/route.ts:27-40` (`buildInventarioPayload`), `app/api/onboarding/seed-demo-data/route.ts:147-150`, `lib/onboarding/sample-data.ts:114-117`, `app/api/ordenes/[id]/servicios/route.ts:110-117` (alta de servicio al catálogo), `app/(dashboard)/inventario/kits/page.tsx:281-305` (envía `moneda: null`)
- Test: `__tests__/multimoneda-altas-explicitas.test.ts`

**Interfaces:**
- Consumes: nada nuevo. Produces: cada payload de insert de `inventario`/`servicios` lleva la clave `moneda` con valor `null`.

- [ ] **Step 1: test que falla.** Test de texto con `__tests__/helpers/sql-text.ts`/`fuentes.ts`: en cada uno de los seis archivos, el objeto del insert contiene `moneda: null`. Además, un test de `buildInventarioPayload(...)` que devuelve `moneda: null`.
- [ ] **Step 2:** `npx vitest run __tests__/multimoneda-altas-explicitas.test.ts` → FAIL.
- [ ] **Step 3:** agregar `moneda: null` en los seis lugares.
- [ ] **Step 4:** mismo comando → PASS; `npx vitest run __tests__/api/inventario-bulk-create-deposito.test.ts __tests__/api/servicios.test.ts` sin regresiones.
- [ ] **Step 5:** commit `feat(multimoneda): toda alta del catálogo escribe la moneda`.

### Task 5: migración 408 (moneda del grupo de variantes + costo de kit convertido)

**Files:**
- Create: `supabase/migrations/408_multimoneda_catalogo.sql`, `supabase/migrations/rollback/408_rollback.sql`, `supabase/migrations/verify/408_probes.sql`
- Test: `__tests__/multimoneda-catalogo-migration.test.ts`

**Interfaces:**
- Produces:
  - `inventario_sync_compartidos_grupo()` redefinida: igual a `355_variantes_grupos.sql:121-145` más `moneda` en el SET, en la tupla del `IS DISTINCT FROM`, y en la lista `UPDATE OF` del trigger (recrear el trigger con `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`, misma definición de 355:226-236 más `moneda`).
  - Trigger nuevo `inventario_moneda_grupo` `BEFORE INSERT OR UPDATE OF grupo_id ON inventario FOR EACH ROW`, función `inventario_moneda_grupo()` (`SET search_path = public, pg_temp`): si `NEW.grupo_id` no es NULL y existe otro ítem del grupo (misma org, `id <> NEW.id`): en INSERT, `NEW.moneda := moneda del hermano`; en UPDATE que cambia `grupo_id`, si la moneda del hermano `IS DISTINCT FROM NEW.moneda` → `RAISE EXCEPTION 'MONEDA_GRUPO_MIXTA' USING ERRCODE = '23514'`.
  - `calcular_costo_kit(p_kit_id TEXT, p_org_id TEXT, p_moneda TEXT DEFAULT NULL, p_tipo_cambio NUMERIC DEFAULT NULL, p_unidad NUMERIC DEFAULT 0) RETURNS NUMERIC`, `STABLE`: `DROP FUNCTION IF EXISTS calcular_costo_kit(TEXT, TEXT)` primero (si no, quedan dos sobrecargas). Si algún componente directo tiene `moneda` no NULL y (`moneda IS DISTINCT FROM p_moneda` o `p_tipo_cambio` NULL o ≤ 0) → `RETURN NULL`. Si no, `SUM(cantidad × CASE WHEN moneda IS NULL THEN COALESCE(precio_compra,0) ELSE <conv> END)` con `<conv>` = `ROUND(precio_compra × p_tipo_cambio / p_unidad) × p_unidad` si `p_unidad > 0`, si no `ROUND(precio_compra × p_tipo_cambio, 2)`. Re-otorgar el mismo GRANT que `177_kits_bom.sql:725`. Una llamada con dos argumentos sigue funcionando (defaults) y da lo mismo que hoy para kits sin componentes en divisa.

- [ ] **Step 1: test estático que falla** (como `__tests__/multimoneda-cotizaciones-migration.test.ts`): `lock_timeout`; no hay `DELETE`, `TRUNCATE` ni `UPDATE inventario` fuera de las funciones; `DROP FUNCTION IF EXISTS calcular_costo_kit(TEXT, TEXT)`; la nueva firma con los cinco parámetros; `RAISE EXCEPTION 'MONEDA_GRUPO_MIXTA'`; `moneda = NEW.moneda` dentro de `inventario_sync_compartidos_grupo`; el GRANT; rollback y probes existen y el rollback restaura la versión de 177 y la de 355.
- [ ] **Step 2:** `npx vitest run __tests__/multimoneda-catalogo-migration.test.ts` → FAIL.
- [ ] **Step 3:** escribir la 408, el rollback (vuelve a las definiciones de 355 y 177 y borra el trigger y la función nuevos) y los probes (abren `BEGIN` y cierran `ROLLBACK`; con una org y un grupo de prueba: insertar una variante en un grupo USD la deja USD; cambiar la moneda de una variante cambia la del grupo; mover a un grupo USD un ítem local da `23514`; un kit con un componente local 500×1 y uno USD 10×2 a tc 1200 unidad 10 da `24500`; sin tc da NULL; con `p_moneda 'EUR'` da NULL; la llamada de 2 argumentos sobre un kit solo local da lo mismo que la suma directa; sigue habiendo una sola función `calcular_costo_kit`).
- [ ] **Step 4:** mismo comando → PASS.
- [ ] **Step 5:** commit `feat(multimoneda): migración 408 (moneda del grupo de variantes y costo de kit)`.

### Task 6: formulario y listado de inventario

**Files:**
- Modify: `components/inventario/inventario-form.tsx` (schema :78-103, submit :1150-1200), `components/inventario/variantes/use-variantes-form.ts:161` (manda `moneda` del grupo), `components/inventario/inventario-list.tsx` (filtros :137-161, query :260-271, precios :488-515, :1175, :1352-1364)
- Test: `__tests__/components/inventario-form-moneda.test.tsx`, `__tests__/components/inventario-list-moneda.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`convertirPrecioCatalogo`, `cotizacionDe`), Task 2 (`SelectorMoneda`, `PrecioEnMoneda`, `EquivalenteLocal`), Task 3 (body `moneda`, `item.moneda`, `?moneda=`).
- Produces: nada para otras tareas.

- [ ] **Step 1: tests que fallan.**
  - Formulario: el selector aparece junto a los precios con la función activa; `EquivalenteLocal` debajo de precio de venta y de compra cuando la moneda es divisa; cambiar de local a USD con precio de venta 60000 abre un diálogo con **"Convertir con la cotización de hoy"** y **"Mantener el número"**; "Convertir" deja 50 (tc 1200) en venta y convierte también compra; "Mantener" deja 60000; sin cotización, "Convertir" está deshabilitado con el texto "No hay cotización disponible"; con precios vacíos no se abre el diálogo; el submit manda `moneda`; en modo variantes, `guardarVariantes` manda `moneda` en el cuerpo del grupo.
  - Listado: un ítem `moneda: "USD"`, `precioVenta: 50` muestra `PrecioEnMoneda` en USD y `EquivalenteLocal` debajo; el filtro "Moneda" (Todas / Moneda local / {monedaExtranjera}) solo aparece con la función activa o si hay ítems en divisa (`itemsEnDivisa`), y agrega `moneda=divisa` a la query.
- [ ] **Step 2:** `npx vitest run __tests__/components/inventario-form-moneda.test.tsx __tests__/components/inventario-list-moneda.test.tsx` → FAIL.
- [ ] **Step 3:** implementar. El diálogo usa `ConfirmDialog` como en `components/configuracion/moneda-config.tsx`. Conversión: `convertirPrecioCatalogo` con `tipoCambio.valor` y `unidadRedondeo(config.redondeoConversion, config.monedaLocal)`.
- [ ] **Step 4:** mismo comando → PASS; `npx vitest run __tests__/components/inventario` sin regresiones.
- [ ] **Step 5:** commit `feat(multimoneda): moneda del precio en el formulario y el listado de inventario`.

### Task 7: servicios (API y pantalla)

**Files:**
- Modify: `app/api/servicios/route.ts` (`servicioSchema` :6-14, `toDTO` :16-26, insert :74-86, filtro `moneda`), `app/api/servicios/[id]/route.ts` (`updateSchema` :6, write :45), `components/servicios/servicios-client.tsx` (form :129-134, precio :364)
- Test: ampliar `__tests__/api/servicios.test.ts` y `__tests__/api/servicios-id.test.ts`; crear `__tests__/components/servicios-moneda.test.tsx`

**Interfaces:**
- Consumes: Tasks 1-2; mismo contrato de body/validación que Task 3 (`moneda?: MonedaCatalogo`, POST sin moneda → `null`, PUT sin moneda no toca, `?moneda=local|divisa`).
- Produces: `toDTO` agrega `moneda`.

- [ ] **Step 1: tests que fallan:** los mismos casos de validación de Task 3 aplicados a `/api/servicios` y `/api/servicios/[id]`; `toDTO` incluye `moneda`; en la pantalla, el selector, el diálogo convertir/mantener sobre `precio`, la lista con `PrecioEnMoneda` + `EquivalenteLocal`, y el filtro de moneda con la misma regla de visibilidad que en Task 6.
- [ ] **Step 2:** `npx vitest run __tests__/api/servicios.test.ts __tests__/api/servicios-id.test.ts __tests__/components/servicios-moneda.test.tsx` → FAIL.
- [ ] **Step 3:** implementar reutilizando las piezas de Task 2 y el diálogo de Task 6 (si quedó en `inventario-form.tsx`, extraerlo a `components/moneda/dialogo-cambio-moneda.tsx` y usarlo en los dos).
- [ ] **Step 4:** mismo comando → PASS.
- [ ] **Step 5:** commit `feat(multimoneda): servicios con moneda del precio`.

### Task 8: kits

**Files:**
- Modify: `app/api/inventario/[id]/kit/route.ts` (:82 `calcular_costo_kit`, :89 componentes), `app/api/inventario/kits/route.ts:59-84`, `components/inventario/kit-dialog.tsx` (:468, :532, :582, :793), `app/(dashboard)/inventario/kits/page.tsx:191-197`
- Test: ampliar `__tests__/api/inventario-kits-cost-gating.test.ts`; crear `__tests__/api/inventario-kit-moneda.test.ts`; ampliar `__tests__/components/kits-page-cost-null-ui.test.tsx`

**Interfaces:**
- Consumes: Task 1 `costoKitLocal`, `precioALocal`; Task 5 firma de `calcular_costo_kit`; `resolverTipoCambio(orgId)` y `cargarConfigMoneda(orgId)`.
- Produces: `costoCalculado: number | null` (null = "no disponible") en `[id]/kit` y en `/api/inventario/kits`; cada componente lleva `moneda`.

- [ ] **Step 1: tests que fallan:** `[id]/kit` llama `calcular_costo_kit` con `p_moneda`, `p_tipo_cambio` (o `null` sin cotización) y `p_unidad`; `kits/route.ts` devuelve `24500` para el caso de Task 1 y `null` con un componente EUR en org USD; la UI muestra `"Costo no disponible: falta la cotización de USD"` cuando `costoCalculado` es `null` y el usuario tiene acceso a costos, y los componentes en divisa con `PrecioEnMoneda`. Se mantiene el gating de costos existente (sin acceso, sigue oculto).
- [ ] **Step 2:** `npx vitest run __tests__/api/inventario-kit-moneda.test.ts __tests__/api/inventario-kits-cost-gating.test.ts __tests__/components/kits-page-cost-null-ui.test.tsx` → FAIL.
- [ ] **Step 3:** implementar. Resolver la cotización una vez por request y solo si algún componente está en divisa.
- [ ] **Step 4:** mismo comando → PASS.
- [ ] **Step 5:** commit `feat(multimoneda): costo de kit con componentes en divisa`.

### Task 9: valuación de stock y análisis ABC (REQ-2.6)

**Files:**
- Modify: `app/api/inventario/stats/route.ts:23-56`, `app/api/inventario/summary/route.ts`, `app/api/reportes/inventario-analytics/route.ts:62-74`, `app/api/reportes/analisis-inventario/route.ts:77-121`, `app/api/inventario/analisis-abc/route.ts:16-87`, y sus vistas: `components/inventario/inventario-stats.tsx`, `components/inventario/inventario-proveedor-stats.tsx`, `components/inventario/inventario-analytics.tsx`, `components/reportes-avanzados/analisis-inventario.tsx`, `app/(dashboard)/inventario/analisis-abc/page.tsx`
- Test: `__tests__/api/inventario-valuacion-moneda.test.ts`; ampliar `__tests__/components/inventario-stats-cost-oculto.test.tsx`

**Interfaces:**
- Consumes: Task 1 `valorLocalStock`, `precioALocal`; `resolverTipoCambio`, `cargarConfigMoneda`.
- Produces: cada respuesta de valuación suma `{ aproximado: boolean, excluidosSinCotizacion: number }` junto a sus totales de siempre (aditivo).

- [ ] **Step 1: tests que fallan:** stats con un ítem local (stock 2 × costo 500) y uno USD (stock 1 × costo 10, tc 1200, redondeo 10) → `valorCosto 13000`, `aproximado: true`, `excluidosSinCotizacion: 0`; sin cotización → `valorCosto 1000`, `excluidosSinCotizacion: 1`; sin ítems en divisa no se llama `resolverTipoCambio` y `aproximado: false`. ABC: la RPC devuelve filas con `stock × precio_compra` crudo; la ruta lee `moneda` de esos ids y recalcula `capital_inmovilizado` y el margen de las filas en divisa con `precioALocal` (o las excluye y las cuenta). UI: "≈" delante del valor cuando `aproximado`, y "{n} productos en divisa sin cotización no se incluyen" cuando `excluidosSinCotizacion > 0`.
- [ ] **Step 2:** `npx vitest run __tests__/api/inventario-valuacion-moneda.test.ts __tests__/components/inventario-stats-cost-oculto.test.tsx` → FAIL.
- [ ] **Step 3:** implementar en las cinco rutas con el mismo patrón (agregar `moneda` al select; resolver la cotización solo si hay ítems en divisa).
- [ ] **Step 4:** mismo comando → PASS; `npx vitest run __tests__/api/inventario __tests__/api/reportes` sin regresiones.
- [ ] **Step 5:** commit `feat(multimoneda): valuación de stock y ABC con ítems en divisa`.

### Task 10: ajustes de precio e import de precios (REQ-2.9)

**Files:**
- Modify: `components/inventario/inventario-bulk-bar.tsx` (confirmación :196), `components/proveedores/ajuste-precios-proveedor.tsx` (`round` :44-54, preview :97), `app/(dashboard)/inventario/importar-precios/page.tsx` y `app/api/inventario/precios/preview/route.ts` (sumar `moneda` a cada fila)
- Test: `__tests__/components/ajuste-precios-moneda.test.tsx`; ampliar `__tests__/components/importar-precios-draft.test.tsx`

**Interfaces:**
- Consumes: Task 2 `PrecioEnMoneda`; `item.moneda` (Task 3). El SQL de `bulk_price_adjust` y `apply_precios_batch` **no cambia**: multiplican el número guardado, que ya está en la moneda del ítem.

- [ ] **Step 1: tests que fallan:** la confirmación del ajuste masivo dice cuántos ítems están en cada moneda (`"3 en ARS y 2 en USD: el porcentaje se aplica en la moneda de cada uno"`) cuando hay mezcla; la vista previa por proveedor muestra precios con `PrecioEnMoneda`, y con redondeo "a 10" un ítem USD 47 × 1,05 queda `49.35` (centavos) mientras uno local 4700 × 1,05 queda `4940`; la vista previa del import de precios muestra la moneda de cada fila y el texto "Los precios se interpretan en la moneda actual de cada producto".
- [ ] **Step 2:** `npx vitest run __tests__/components/ajuste-precios-moneda.test.tsx __tests__/components/importar-precios-draft.test.tsx` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mismo comando → PASS.
- [ ] **Step 5:** commit `feat(multimoneda): ajustes e import de precios respetan la moneda de cada ítem`.

### Task 11: verificación, migración y PR

- [ ] **Step 1:** suite completa `npx vitest run`, `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p .`, `npx eslint .` → 0 errores.
- [ ] **Step 2:** confirmar que `408` sigue libre en `origin/main`; si no, renumerar (archivo, rollback, probes, test).
- [ ] **Step 3 (requiere OK del usuario):** `node scripts/db-run.mjs supabase/migrations/408_multimoneda_catalogo.sql` (dry-run), revisar la salida, `--apply`, y correr `verify/408_probes.sql`.
- [ ] **Step 4 (requiere OK del usuario):** push y PR con el orden de despliegue: aplicar 408 **antes** de mergear (la ruta de kits llama a la firma nueva).
