# Multimoneda S3: esquema, configuración y cotización (plan de implementación)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dejar en producción el esquema multimoneda (365 corregida + 406), la configuración de "Moneda extranjera" por organización y un endpoint de cotización confiable (vivo → referencia → sin cotización), sin cambiar nada de lo que ya funciona.

**Architecture:** la 365 nunca se aplicó (verificado en producción el 2026-11-11), así que se **corrige en el lugar** para admitir EUR y `moneda_extranjera`, en vez de crear CHECKs que otra migración borra enseguida. La 406 suma solo lo nuevo (columnas de cotización en `cotizaciones` + tabla `recotizaciones`). La lógica de decisión de la cotización es pura (`lib/currency/tipo-cambio.ts`); la I/O (dolarapi + Supabase) vive en `lib/currency/tipo-cambio.server.ts`. La UI es un componente que se guarda solo, en una pestaña nueva de /configuracion, con el mismo patrón que `ComisionesConfig`.

**Tech Stack:** Next.js 16 App Router, Supabase (supabaseAdmin), zod, SWR, vitest + Testing Library, SQL a mano con `scripts/db-run.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-11-multimoneda-design.md` (REQ-1.x, REQ-6.2, REQ-6.5, §4)

## Global Constraints

- Monedas extranjeras admitidas: exactamente `'USD'` y `'EUR'`. `NULL` = moneda local de la org.
- Cotización: finita, > 0, < 1e8, notación decimal simple, ≤ 6 decimales (`validarTipoCambio`, REQ-1.6). Columnas `NUMERIC(14,6)`.
- Fuentes: AR+USD → `MANUAL, OFICIAL, BLUE, MEP` (default `BLUE`); AR+EUR → `MANUAL, OFICIAL` (default `OFICIAL`); otro país → `MANUAL`.
- Redondeo de conversión admitido en la UI/PUT: `0, 1, 10, 100`.
- Referencia vencida: más de **24 h** → sin cotización.
- Caché de dolarapi: **5 minutos**, clave `moneda+fuente`. Se usa el valor de **venta**.
- Montos de siempre en moneda local: S3 no toca ninguna tabla de ventas/órdenes más allá de las columnas de la 365.
- Migraciones: aditivas, re-ejecutables, `SET LOCAL lock_timeout = '3s'`, CHECKs `NOT VALID` en tablas existentes, sin `BEGIN/COMMIT` (lo pone `db-run.mjs`).
- Textos de UI y errores en español rioplatense (vos), como el resto de la app.
- Todo trabajo en la rama `feat/multimoneda-s3` creada desde `origin/main` (no en el checkout principal, que lo usa otra sesión).

## Review Focus

1. **Cambio de fuente o de moneda deja una referencia de otra cotización** (p. ej. Blue en USD guardada y ahora EUR oficial con dolarapi caído) → el PUT de configuración debe borrar `tipo_cambio_referencia/referencia_en` cuando cambia `moneda_extranjera` o `tipo_cambio_fuente`. Test en Task 5.
2. **dolarapi responde 200 con basura** (`venta: 0`, `null`, string, JSON roto) → se trata como caída: no se guarda como referencia y se pasa a la referencia anterior. Test en Task 3.
3. **La org cambia su moneda local a la misma que la extranjera** (pasa a USD teniendo USD como extranjera) → `habilitada: false` efectiva y el endpoint de cotización responde `disponible:false`, sin 500. Test en Task 2.
4. **Migración no aplicada** (`42P01`/`42703` al leer `organizacion_moneda`) → GET de config y de cotización responden "deshabilitada", nunca 500 (REQ-6.5). Test en Task 4 y Task 5.
5. **Cotización manual con formato local** (`"1.250,50"`, `"1e3"`, `0`, 7 decimales) → 400 con el mensaje de `validarTipoCambio` (REQ-6.2). Test en Task 5.

---

### Task 1: Migración 365 corregida + migración 406

**Files:**
- Modify: `supabase/migrations/365_multimoneda_foundation.sql`
- Modify: `supabase/migrations/verify/365_probes.sql`, `supabase/migrations/rollback/365_rollback.sql` (solo si cambia algo que deshacer)
- Create: `supabase/migrations/406_multimoneda_cotizaciones.sql`, `supabase/migrations/rollback/406_rollback.sql`, `supabase/migrations/verify/406_probes.sql`
- Modify: `__tests__/multimoneda-fundacion-migration.test.ts`
- Create: `__tests__/multimoneda-cotizaciones-migration.test.ts`

**Interfaces:**
- Produces: `organizacion_moneda.moneda_extranjera CHAR(3) NOT NULL DEFAULT 'USD' CHECK (moneda_extranjera IN ('USD','EUR'))`; CHECKs `moneda IN ('USD','EUR')` (y `moneda_origen` ídem) en `inventario`, `servicios`, `items_venta`, `servicios_orden`, `repuestos_orden`, `items_cotizacion`; `cotizaciones.tipo_cambio_fuente TEXT`, `cotizaciones.tipo_cambio_en TIMESTAMPTZ`; tabla `recotizaciones` (columnas exactas del spec §4.4, `modo IN ('HOY','MANUAL')`, `documento_tipo IN ('ORDEN','COTIZACION')`, `motivo` obligatorio si `modo='MANUAL'` vía CHECK).

- [ ] **Step 1: Tests que fallan.** En `multimoneda-fundacion-migration.test.ts` reemplazar las aserciones `= 'USD'` de las 6 tablas de catálogo/líneas por `IN ('USD', 'EUR')`, y agregar: `expect(CODE).toMatch(/moneda_extranjera\s+CHAR\(3\) NOT NULL DEFAULT 'USD' CHECK \(moneda_extranjera IN \('USD', 'EUR'\)\)/)`. Mantener que `pagos_venta`, `movimientos_caja`, `sesion_caja_saldos` y `vuelto_moneda_default` siguen solo `'USD'` (fase 2). En el test nuevo de la 406: aditiva (sin DROP/DELETE/UPDATE/TRUNCATE), `lock_timeout`, `ADD COLUMN IF NOT EXISTS tipo_cambio_fuente TEXT` y `tipo_cambio_en TIMESTAMPTZ` en `cotizaciones`, `CREATE TABLE IF NOT EXISTS recotizaciones`, RLS habilitada con las dos políticas de la forma 365 (`*_select` own-org para authenticated, `*_all_service`), `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, CHECK `modo <> 'MANUAL' OR length(trim(motivo)) > 0`, e índice `(organization_id, documento_tipo, documento_id)`. Rollback y probes existen.
- [ ] **Step 2:** `npx vitest run __tests__/multimoneda-fundacion-migration.test.ts __tests__/multimoneda-cotizaciones-migration.test.ts` → FAIL.
- [ ] **Step 3: SQL.** Editar la 365 (el comentario de cabecera explica que se corrigió antes de aplicarse y por qué) y escribir la 406. **No** convertir `cotizaciones.tipo_cambio` a `NUMERIC(14,6)`: `ALTER TYPE` reescribe la tabla bajo ACCESS EXCLUSIVE; la validación queda en el código (se ajusta el spec §4.3 en el Step 5). Actualizar probes: los de la 365 que prueban "rechaza EUR" pasan a "rechaza 'BRL'" y suman "acepta EUR"; los de la 406 prueban el CHECK del motivo.
- [ ] **Step 4:** mismos tests → PASS.
- [ ] **Step 5:** corregir el spec §4.3 ("`tipo_cambio` existente no se convierte; se valida en código") y commit `feat(multimoneda): corrige la 365 (EUR, moneda_extranjera) y agrega la 406`.

### Task 2: `config-moneda` con moneda extranjera

**Files:**
- Modify: `lib/currency/config-moneda.ts`, `lib/currency/convert.ts:28`
- Test: `__tests__/lib/currency-config-moneda.test.ts`

**Interfaces:**
- Consumes: columnas de Task 1.
- Produces:
  - `type MonedaExtranjera = "USD" | "EUR"` (exportado desde `convert.ts`, reutilizado acá).
  - `FilaOrganizacionMoneda.moneda_extranjera?: string | null`.
  - `ConfigMoneda.monedaExtranjera: MonedaExtranjera`.
  - `fuentesPara(pais: string | null | undefined, moneda: MonedaExtranjera): FuenteTipoCambio[]`.
  - `resolverConfigMoneda(fila, pais, monedaLocal?)` con la misma firma.

- [ ] **Step 1: Tests que fallan:**
  - AR sin fila → `monedaExtranjera: "USD"`, fuentes `["MANUAL","OFICIAL","BLUE","MEP"]`, fuente `"BLUE"`.
  - AR con `moneda_extranjera: "EUR"` → fuentes `["MANUAL","OFICIAL"]`; fuente guardada `"BLUE"` cae a `"OFICIAL"`.
  - Local `"USD"` sin fila → `monedaExtranjera: "EUR"`; local USD con `{multimoneda_habilitada:true, moneda_extranjera:"EUR"}` → `habilitada: true` (reemplaza el test S1.e).
  - **Review Focus 3:** local `"USD"` con `moneda_extranjera: "USD"` → `habilitada: false`.
  - `moneda_extranjera: "BRL"` (basura) → se ignora y usa el default.
  - `aceptaUsdEfectivo` y `vueltoMonedaDefault` se mantienen como hoy (fase 2).
- [ ] **Step 2:** `npx vitest run __tests__/lib/currency-config-moneda.test.ts` → FAIL.
- [ ] **Step 3: Implementar.** Default de `monedaExtranjera`: `"EUR"` si la local es USD, si no `"USD"`. `habilitada = local !== monedaExtranjera && fila?.multimoneda_habilitada === true`. Correr también `__tests__/lib/currency-convert.test.ts`, que no debe cambiar.
- [ ] **Step 4:** ambos archivos de test → PASS.
- [ ] **Step 5:** commit `feat(multimoneda): moneda extranjera USD o EUR en la config`.

### Task 3: Decisión pura de cotización + cliente dolarapi

**Files:**
- Create: `lib/currency/tipo-cambio.ts` (puro), `lib/currency/dolarapi.server.ts`
- Test: `__tests__/lib/currency-tipo-cambio.test.ts`, `__tests__/lib/currency-dolarapi.test.ts`

**Interfaces:**
- Produces:
  - `type CotizacionMercado = { valor: number; en: string }`.
  - `obtenerCotizacionMercado(moneda: MonedaExtranjera, fuente: Exclude<FuenteTipoCambio,"MANUAL">): Promise<CotizacionMercado | null>`, en `dolarapi.server.ts`. Nunca tira: un error o un dato inválido devuelve `null`.
  - `type ResultadoTipoCambio = { disponible: true; valor: number; fuente: FuenteTipoCambio; moneda: MonedaExtranjera; en: string; estado: "vivo" | "referencia" } | { disponible: false; motivo: "DESHABILITADA" | "SIN_COTIZACION" }`.
  - `decidirTipoCambio(config: ConfigMoneda, vivo: CotizacionMercado | null, ahora: Date, manualEn?: string | null): ResultadoTipoCambio`, en `tipo-cambio.ts`.
  - `REFERENCIA_MAX_HORAS = 24`.

- [ ] **Step 1: Tests que fallan.**
  - **`decidirTipoCambio`:**
    - Deshabilitada → `{disponible:false, motivo:"DESHABILITADA"}`.
    - MANUAL con 1250.5 → `{valor:1250.5, estado:"vivo", fuente:"MANUAL"}`.
    - MANUAL sin valor → `SIN_COTIZACION`.
    - BLUE con vivo `{valor:1200}` → `estado:"vivo"`.
    - BLUE sin vivo y con referencia de hace 23 h 59 min → `estado:"referencia"`; de hace 24 h 1 min → `SIN_COTIZACION`; sin referencia → `SIN_COTIZACION`.
  - **`dolarapi`** (con `global.fetch` mockeado, como en `superadmin-agregaciones.test.ts`):
    - URL por fuente: USD OFICIAL → `https://dolarapi.com/v1/dolares/oficial`; BLUE → `/v1/dolares/blue`; MEP → `/v1/dolares/bolsa`; EUR OFICIAL → `https://dolarapi.com/v1/cotizaciones/eur`.
    - Usa `venta` y `fechaActualizacion`.
    - Una segunda llamada dentro de los 5 min no hace fetch; pasados los 5 min, sí (`vi.useFakeTimers`).
    - Las claves de caché distintas no se mezclan (BLUE ≠ OFICIAL, USD ≠ EUR).
    - **Review Focus 2:** `ok:false`, un throw, `venta: 0`, `venta: null`, `venta: "abc"` y un JSON roto → `null`, y no quedan en caché.
- [ ] **Step 2:** `npx vitest run __tests__/lib/currency-tipo-cambio.test.ts __tests__/lib/currency-dolarapi.test.ts` → FAIL.
- [ ] **Step 3: Implementar.** Para validar `venta` se usa `validarTipoCambio(Number(venta.toFixed(6)))`. La caché es un `Map` de módulo con timestamp, y el fetch lleva timeout con `AbortSignal.timeout(4000)`.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5:** commit `feat(multimoneda): decisión de cotización y cliente de dolarapi`.

### Task 4: Resolvedor de servidor + `GET /api/moneda/tipo-cambio`

**Files:**
- Create: `lib/currency/tipo-cambio.server.ts`, `app/api/moneda/tipo-cambio/route.ts`
- Test: `__tests__/api/moneda-tipo-cambio.test.ts`

**Interfaces:**
- Consumes: `resolverConfigMoneda` (Task 2), `obtenerCotizacionMercado` y `decidirTipoCambio` (Task 3).
- Produces:
  - `cargarConfigMoneda(organizationId: string): Promise<{ config: ConfigMoneda; fila: FilaOrganizacionMoneda | null }>`. Lee `organizations(pais, moneda)` y `organizacion_moneda`. Ante `42P01`/`42703`, la fila es `null` y la config queda deshabilitada.
  - `resolverTipoCambio(organizationId: string, ahora?: Date): Promise<ResultadoTipoCambio>`.
  - Respuesta de la ruta: `200` con `ResultadoTipoCambio` tal cual.

- [ ] **Step 1: Tests que fallan** (helpers `mockAuthSuccess`, `mockSupabaseFrom`, `createChainMock`):
  - Cualquier rol (VENDEDOR, TECNICO) → 200. Sin sesión → 401.
  - MANUAL → `{disponible:true, fuente:"MANUAL", valor:1300}`.
  - BLUE con fetch OK → `estado:"vivo"`, y hace update de `organizacion_moneda` con `tipo_cambio_referencia: 1200` y `referencia_en`.
  - BLUE con fetch caído y referencia reciente → `estado:"referencia"`, sin update.
  - **Review Focus 4:** `organizacion_moneda` responde con error `{code:"42P01"}` → `{disponible:false, motivo:"DESHABILITADA"}` con 200.
  - Si falla el update de la referencia, igual responde 200 con el valor en vivo.
- [ ] **Step 2:** `npx vitest run __tests__/api/moneda-tipo-cambio.test.ts` → FAIL.
- [ ] **Step 3: Implementar.** La referencia se escribe solo si el valor en vivo difiere del guardado o si `referencia_en` tiene más de 5 min, para no escribir en cada request. La ruta usa `requireAuth` y responde con `Cache-Control: private, max-age=60`.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5:** commit `feat(multimoneda): endpoint de cotización vigente`.

### Task 5: `GET/PUT /api/configuracion/moneda`

**Files:**
- Create: `app/api/configuracion/moneda/route.ts`, `lib/currency/config-moneda-schema.ts`
- Test: `__tests__/api/configuracion-moneda.test.ts`

**Interfaces:**
- Consumes: `cargarConfigMoneda`, `resolverTipoCambio` (Task 4), `fuentesPara`, `validarTipoCambio`.
- Produces:
  - `GET` (`requireAuth`, cualquier rol) → `{ config: ConfigMoneda; itemsEnDivisa: { inventario: number; servicios: number } | null }`. `itemsEnDivisa` va solo para ADMIN; para el resto es `null`.
  - `PUT` (`requireAdmin`), body validado con zod en `configMonedaSchema`: `{ habilitada: boolean; monedaExtranjera: "USD"|"EUR"; fuente: FuenteTipoCambio; tipoCambioManual: number|string|null; redondeoConversion: 0|1|10|100 }`. Devuelve el mismo shape que el GET.

- [ ] **Step 1: Tests que fallan:**
  - PUT con VENDEDOR → 403.
  - `monedaExtranjera` igual a la moneda local → 400 "La moneda extranjera no puede ser la misma que la moneda local." (REQ-1.3).
  - Una fuente no disponible (CL + BLUE; AR + EUR + MEP) → 400.
  - **Review Focus 5:** MANUAL con `"1.250,50"`, `"1e3"`, `0` y `1250.1234567` → 400 con el mensaje de `validarTipoCambio`. MANUAL con `"1250.5"` → 200 y se guarda `1250.5`.
  - `redondeoConversion: 5` → 400.
  - Upsert en `organizacion_moneda` con `onConflict: "organization_id"`.
  - **Review Focus 1:** si cambia `monedaExtranjera` o `fuente` respecto de la fila guardada, el upsert lleva `tipo_cambio_referencia: null, referencia_en: null`; si no cambian, no las toca.
  - GET como ADMIN cuenta con `moneda IS NOT NULL` en `inventario` y `servicios` (REQ-1.9).
  - Con la tabla faltante (`42P01`): el GET devuelve `config.habilitada: false` y el PUT devuelve 503 "Falta aplicar la migración de multimoneda".
- [ ] **Step 2:** `npx vitest run __tests__/api/configuracion-moneda.test.ts` → FAIL.
- [ ] **Step 3: Implementar.** Lo que viene de la fila guardada (por ejemplo, `acepta_usd_efectivo`) no se pisa.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5:** commit `feat(multimoneda): API de configuración de moneda extranjera`.

### Task 6: Hook `useMoneda` + pestaña "Moneda extranjera"

**Files:**
- Create: `hooks/use-moneda.ts`, `components/configuracion/moneda-config.tsx`
- Modify: `components/configuracion/config-tabs.ts` (agregar `{ value: "moneda", label: "Moneda extranjera" }` después de `"comprobantes"`; **no** va en `FORM_TABS`), `components/configuracion/configuracion-form.tsx` (agregar un `TabsContent value="moneda"` con `<MonedaConfig />`, igual que comisiones en la línea ~1327)
- Test: `__tests__/hooks/use-moneda.test.ts`, `__tests__/components/moneda-config.test.tsx`

**Interfaces:**
- Consumes: los endpoints de las Tasks 4 y 5.
- Produces: `useMoneda(): { config: ConfigMoneda | undefined; tipoCambio: ResultadoTipoCambio | undefined; isLoading: boolean; mutate: () => Promise<void> }`, con SWR sobre las dos rutas. S4 a S7 lo consumen.

- [ ] **Step 1: Tests que fallan.**
  - **Hook:** combina las dos respuestas y no pide la cotización si `config.habilitada` es false.
  - **Componente**, con `fetch` mockeado:
    - Con la función apagada solo se ve el switch.
    - Con AR + EUR el select de fuente ofrece exactamente "Manual" y "Oficial".
    - Al elegir la fuente "Manual" aparece el campo de cotización. Si el PUT responde 400, el mensaje del servidor se muestra debajo del campo.
    - Muestra la cotización vigente como "Blue · 1.200,00 · hace 3 min". Con `estado: "referencia"` dice "Cotización de hace X h", y con `SIN_COTIZACION` muestra el aviso de REQ-6.1.
    - Al apagar la función teniendo `itemsEnDivisa` mayor que 0, aparece un diálogo de confirmación con "N productos y M servicios tienen precio en USD" antes de enviar el PUT (REQ-1.9).
    - Solo un ADMIN ve los controles; los demás roles ven la configuración en modo lectura.
- [ ] **Step 2:** `npx vitest run __tests__/hooks/use-moneda.test.ts __tests__/components/moneda-config.test.tsx` → FAIL.
- [ ] **Step 3: Implementar.** Se usan los componentes shadcn que ya usa `comisiones-config.tsx` (Card, Switch, Select, Input, AlertDialog). Los números se formatean con `formatCurrencyValue` y el tiempo relativo con la utilidad de fechas del proyecto.
- [ ] **Step 4:** → PASS. Después, `npx vitest run __tests__/components` completo, porque los tests de `configuracion-form` no deben romperse con la pestaña nueva.
- [ ] **Step 5:** commit `feat(multimoneda): pestaña Moneda extranjera en configuración`.

### Task 7: Verificación del branch, PR y aplicación en producción

**Files:** ninguno nuevo.

- [ ] **Step 1:** `npx tsc --noEmit` → sin errores. `npx eslint lib/currency app/api/moneda app/api/configuracion/moneda components/configuracion hooks/use-moneda.ts` → sin errores.
- [ ] **Step 2:** `npx vitest run` → todo en verde. Hay que comparar contra `main` y declarar cualquier test flaky que ya existía.
- [ ] **Step 3:** dry-run contra producción, solo lectura con ROLLBACK: `node scripts/db-run.mjs supabase/migrations/365_multimoneda_foundation.sql`, después la `365b` y después la `406`. Esperado: "ROLLBACK — nada quedó aplicado" y ningún error.
- [ ] **Step 4:** push de `feat/multimoneda-s3` y PR. La descripción incluye el orden de aplicación (365 → 365b → 406 → probes), la advertencia de "fuera de hora pico" y la nota de que `SUPABASE_DB_URL` apunta al pooler.
- [ ] **Step 5 (requiere el OK explícito del usuario y un horario fuera de pico):** `--apply` de la 365, después la 365b, después la 406, y correr `verify/365_probes.sql` y `verify/406_probes.sql`. Recién después se mergea el PR. La función queda apagada para todas las orgs (`multimoneda_habilitada` es false por defecto).
