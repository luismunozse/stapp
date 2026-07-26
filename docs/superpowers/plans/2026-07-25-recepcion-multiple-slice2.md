# Recepción Múltiple — Slice 2: consultar, reimprimir, y no duplicar

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el código `REC` que el comprobante le pide al cliente que mencione sirva para algo: buscarlo, ver el lote, y reimprimir el comprobante y las etiquetas. Y que un corte de conexión no duplique un lote entero.

**Architecture:** Tres piezas independientes. (1) El buscador de órdenes resuelve códigos `REC` con el mismo patrón de subquery que ya usa para clientes. (2) Un `GET /api/recepciones/[id]` devuelve el lote completo, lo que convierte el comprobante y las etiquetas en reimprimibles desde datos persistidos en vez de estado en memoria. (3) Una idempotency key generada por submit, con índice único parcial, hace imposible que un replay offline cree un lote duplicado.

**Tech Stack:** Next.js App Router, TypeScript, Supabase (Postgres + plpgsql), react-hook-form + zod, Vitest.

**Depende de:** Slice 1 (`feat/recepcion-multiple`) mergeado y sus migraciones 278 y 279 aplicadas.

## Global Constraints

- **`POST /api/ordenes` y `PUT /api/ordenes/[id]` no se modifican.** El `GET` del mismo archivo sí se toca, y es el camino caliente del listado de todos los talleres: cualquier cambio ahí necesita test.
- **La feature sigue gateada** a `profesional` y `pro` con la key `recepcion_multiple`. Las rutas nuevas chequean `hasPlanFeature` en el server; **nunca `useHasFeature`**, que no aplica overrides por organización.
- **RLS de tablas nuevas o modificadas**: la policy de servicio va **`FOR ALL TO service_role`**, y la de lectura `FOR SELECT TO authenticated USING (organization_id = public.get_current_organization_id())`. La convención es la de `201_rls_hardening_phase1.sql`, **no** la de `274_asistente_panel.sql`, que regresionó contra ella. Un `USING(true)` sin `TO service_role` expone la tabla a la anon key, que viaja en el bundle del browser.
- **DDL sobre `ordenes_servicio`**: dentro de `BEGIN; SET LOCAL lock_timeout = '3s';` y los índices `CONCURRENTLY` fuera de la transacción, como quedó la 278.
- **`ordenes_servicio.tipo_dispositivo` es `TEXT`**, no enum. Sin casts.
- **Artefactos en castellano neutro.** Comentarios consistentes con el archivo vecino.
- **Nunca `Co-Authored-By` ni atribución de IA en los commits.** Conventional commits, sin tildes en el subject.
- Comandos: `npx vitest run --testTimeout=30000`, `npx tsc --noEmit`, `npm run lint`.
- **Verificar el número de migración libre** antes de crear el archivo: el último de Slice 1 es `279`.

---

## File Structure

**Se crean:**

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/280_recepcion_idempotencia.sql` | `idempotency_key` + índice único parcial + RPC actualizada |
| `app/api/recepciones/[id]/route.ts` | `GET`: el lote completo para reimprimir |
| `components/ordenes/recepcion-reimprimir-dialog.tsx` | Dialog que trae el lote y ofrece comprobante y etiquetas |

**Se modifican:**

| Archivo | Cambio |
|---|---|
| `app/api/ordenes/route.ts` (solo `GET`) | El search resuelve códigos `REC` |
| `components/ordenes/orden-detail.tsx` | Muestra el código del lote y abre el dialog de reimpresión |
| `app/api/recepciones/route.ts` | Acepta y propaga `idempotencyKey` |
| `components/ordenes/recepcion-form.tsx` | Genera la key una vez por submit |

---

## Task 1: Buscar por código REC en el listado de órdenes

**Files:**
- Modify: `app/api/ordenes/route.ts` (bloque `search` del `GET`, alrededor de `:207-237`)
- Test: `__tests__/api/ordenes-busqueda-rec.test.ts` (crear)

**Interfaces:**
- Produces: escribir `REC001` en el buscador devuelve las órdenes de ese lote.

- [ ] **Step 1: Escribir el test que falla**

El `GET` ya resuelve clientes con una subquery y empuja `cliente_id.in.(...)`. El test fija que hace lo mismo con recepciones:

```ts
it("resuelve un codigo REC a las ordenes de ese lote", async () => {
  const recepcionesChain = createChainMock([{ id: "rec-1" }], null)
  const ordenesChain = createChainMock([], null, 0)
  mockSupabaseFrom({ clientes: createChainMock([], null), recepciones: recepcionesChain, ordenes_servicio: ordenesChain })

  await GET(createGetRequest("http://localhost:3000/api/ordenes?search=REC001"))

  expect(recepcionesChain.ilike).toHaveBeenCalledWith("codigo", "%REC001%")
  const filtros = ordenesChain.or.mock.calls[0][0] as string
  expect(filtros).toContain("recepcion_id.in.(rec-1)")
})

it("no consulta recepciones cuando no hay busqueda", async () => {
  const recepcionesChain = createChainMock([], null)
  mockSupabaseFrom({ recepciones: recepcionesChain, ordenes_servicio: createChainMock([], null, 0) })
  await GET(createGetRequest("http://localhost:3000/api/ordenes"))
  expect(recepcionesChain.select).not.toHaveBeenCalled()
})
```

El segundo caso importa tanto como el primero: el listado de órdenes es el camino caliente de todos los talleres y no puede pagar una query extra cuando nadie buscó nada.

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run __tests__/api/ordenes-busqueda-rec.test.ts`
Expected: FAIL — hoy no se consulta `recepciones`.

- [ ] **Step 3: Implementar**

Dentro del `if (search)` existente, junto al bloque que resuelve `clientesMatch`:

```ts
// Mismo patron que los clientes: resolver ids y empujarlos al filtro.
const { data: recepcionesMatch } = await supabaseAdmin
  .from("recepciones")
  .select("id")
  .eq("organization_id", organizationId!)
  .ilike("codigo", `%${search}%`)

const recepcionIds = recepcionesMatch?.map((r) => r.id) || []
if (recepcionIds.length > 0) {
  filters.push(`recepcion_id.in.(${recepcionIds.join(",")})`)
}
```

- [ ] **Step 4: Verificar**

Run: `npx vitest run __tests__/api/ordenes-busqueda-rec.test.ts __tests__/api/ordenes.test.ts __tests__/api/ordenes-recepcion-null.test.ts --testTimeout=30000`
Expected: PASS. `ordenes.test.ts` cubre el `GET` existente y es el guardarraíl de que no se rompió la búsqueda de siempre.

Run: `npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add app/api/ordenes/route.ts __tests__/api/ordenes-busqueda-rec.test.ts
git commit -m "feat(ordenes): buscar ordenes por codigo de recepcion"
```

---

## Task 2: `GET /api/recepciones/[id]` con todo lo que el comprobante necesita

**Files:**
- Create: `app/api/recepciones/[id]/route.ts`
- Test: `__tests__/api/recepcion-get.test.ts`

**Interfaces:**
- Produces:
  ```ts
  GET /api/recepciones/[id] -> {
    recepcion: { id, numero, codigo, firmaCliente, firmaMime, terminosAceptados, observaciones, createdAt },
    ordenes: Array<{ id, numeroOrden, codigoOrden, dispositivo, tipoDispositivo, marca, imei,
                     problemaReportado, accesorios, publicToken, fechaIngreso }>,
    cliente: { id, nombre, telefono },
    organizationName, organizationTelefono, organizationDireccion, organizationComprobanteTerminos,
  }
  ```
  Ese shape es deliberadamente el mismo que `RecepcionCreadaModal` ya consume, para que el dialog de reimpresión reuse los componentes de impresión sin adaptadores. Task 3 depende de él.

**Por qué cada campo:** `LabelData` exige `problemaReportado` y `fechaIngreso`, y el comprobante muestra tipo/marca/modelo, accesorios e IMEI. Nada de eso vuelve de la RPC de creación — por eso el modal actual los toma del form. Acá vienen de la base, que es lo que hace posible reimprimir.

- [ ] **Step 1: Escribir el test que falla**

Cubrir: 404 si la recepción no existe o es de otra organización; 403 sin la feature; y el camino feliz devolviendo el shape completo. El caso cross-org es el importante:

```ts
it("devuelve 404 si la recepcion es de otra organizacion", async () => {
  vi.mocked(hasPlanFeature).mockResolvedValue(true)
  mockSupabaseFrom({ recepciones: createChainMock(null, null) }) // filtrada por organization_id
  const res = await GET(createGetRequest(), { params: Promise.resolve({ id: "rec-de-otro" }) })
  expect((await parseResponse(res)).status).toBe(404)
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run __tests__/api/recepcion-get.test.ts`
Expected: FAIL — la ruta no existe.

- [ ] **Step 3: Implementar la ruta**

Orden de operaciones, igual que el `POST` hermano: `requireAuth()` → `hasPlanFeature(organizationId, "recepcion_multiple")` → traer la recepción **filtrando por `organization_id`** → traer sus órdenes por `recepcion_id` → traer el cliente y la organización → armar la respuesta.

El filtro por `organization_id` en la query de la recepción no es opcional: sin él, un id de otro tenant devuelve su firma.

- [ ] **Step 4: Verificar**

Run: `npx vitest run __tests__/api/recepcion-get.test.ts && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add app/api/recepciones/\[id\]/route.ts __tests__/api/recepcion-get.test.ts
git commit -m "feat(ordenes): GET de recepcion con los datos para reimprimir"
```

---

## Task 3: Reimprimir desde el detalle de la orden

**Files:**
- Create: `components/ordenes/recepcion-reimprimir-dialog.tsx`
- Modify: `components/ordenes/orden-detail.tsx`
- Test: `__tests__/components/recepcion-reimprimir.test.tsx`

**Interfaces:**
- Consumes: `GET /api/recepciones/[id]` (Task 2), `ThermalPrintRecepcion` y `printDeviceLabel` de Slice 1.
- Produces: en cualquier orden de un lote, el código `REC` visible y un botón que reimprime.

- [ ] **Step 1: Mostrar el código del lote**

En `orden-detail.tsx`, cuando `orden.recepcion_id` no es null, mostrar el código junto a los datos de la orden. Requiere que el detalle traiga `recepciones(codigo)` en su select — verificar cómo arma el suyo y agregar el join.

Con `recepcion_id` null no se renderiza nada: el flujo clásico no cambia.

- [ ] **Step 2: El dialog**

`RecepcionReimprimirDialog` recibe `recepcionId`, trae el lote al abrirse, y ofrece las mismas tres acciones que el modal de creación: comprobante, etiquetas (secuenciales, `await` encadenado, **nunca** `Promise.all`) y WhatsApp agrupado.

Reusar `ThermalPrintRecepcion`, `printDeviceLabel` y `construirMensajeRecepcion` sin modificarlos. Si alguno necesita un cambio para servir a los dos llamadores, reportarlo en vez de hacerlo.

- [ ] **Step 3: Test**

Montar el dialog con el fetch mockeado y verificar que renderiza los N equipos del lote y que el botón de etiquetas llama a `printDeviceLabel` una vez por equipo. Mockear `@/components/ordenes/print-label` — no montar la impresión real.

- [ ] **Step 4: Verificar**

Run: `npx vitest run __tests__/components/recepcion-reimprimir.test.tsx __tests__/components/recepcion-gate.test.tsx --testTimeout=30000 && npx tsc --noEmit && npm run lint`

- [ ] **Step 5: Commit**

```bash
git add components/ordenes/recepcion-reimprimir-dialog.tsx components/ordenes/orden-detail.tsx __tests__/components/recepcion-reimprimir.test.tsx
git commit -m "feat(ordenes): reimprimir comprobante y etiquetas de una recepcion"
```

---

## Task 4: Idempotencia — migración

**Files:**
- Create: `supabase/migrations/280_recepcion_idempotencia.sql`

**Interfaces:**
- Produces: `recepciones.idempotency_key`, su índice único parcial, y `crear_recepcion_multiple` aceptando `p_idempotency_key` y devolviendo el lote existente en vez de duplicar.

- [ ] **Step 1: Confirmar el número libre**

Run: `ls supabase/migrations/ | sort -t_ -k1 -n | tail -3`

- [ ] **Step 2: Escribir la migración**

```sql
-- ============================================================================
-- 280: idempotencia de recepcion multiple
-- ============================================================================
-- El replay offline reenvia el mismo body. Sin una key estable, una respuesta
-- perdida DESPUES del commit hace que el reintento cree una segunda recepcion
-- y N ordenes duplicadas, quemando N numeros de orden. La key la genera el
-- cliente UNA vez por submit (no por intento), asi el reintento trae la misma.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '3s';

ALTER TABLE recepciones
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

COMMIT;

-- Indice parcial CONCURRENTLY, fuera de la transaccion. Correr como statement
-- SEPARADO: Postgres rechaza CONCURRENTLY dentro de un bloque implicito.
-- Si falla a mitad deja el indice INVALID: DROP INDEX IF EXISTS antes de reintentar.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS recepciones_idempotency_key_idx
  ON recepciones(organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

Después, `CREATE OR REPLACE FUNCTION crear_recepcion_multiple(...)` con un `p_idempotency_key TEXT DEFAULT NULL` **al final de la lista de parámetros** (agregarlo en el medio rompe las llamadas posicionales), y como primer paso del cuerpo:

```sql
IF p_idempotency_key IS NOT NULL THEN
  SELECT id INTO v_recepcion_existente
  FROM recepciones
  WHERE organization_id = p_organization_id AND idempotency_key = p_idempotency_key;

  IF v_recepcion_existente IS NOT NULL THEN
    -- Replay: devolver el lote que ya existe, con el mismo shape que el camino
    -- normal, para que el cliente no distinga un reintento de un exito.
    RETURN (SELECT jsonb_build_object(
      'recepcion', jsonb_build_object('id', r.id, 'numero', r.numero, 'codigo', r.codigo),
      'ordenes', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', o.id, 'numeroOrden', o.numero_orden, 'codigoOrden', o.codigo_orden,
          'dispositivo', o.dispositivo, 'publicToken', o.public_token))
        FROM ordenes_servicio o WHERE o.recepcion_id = r.id), '[]'::jsonb)
    ) FROM recepciones r WHERE r.id = v_recepcion_existente);
  END IF;
END IF;
```

Y el `INSERT INTO recepciones` incluye `idempotency_key`.

- [ ] **Step 3: Verificar por inspección**

No se puede ejecutar: las migraciones se aplican a mano. Verificar que el índice único es **parcial** (si no, todas las filas viejas con `NULL` colisionan), que el parámetro nuevo va al final, y que el shape del retorno del camino de replay es idéntico al normal.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/280_recepcion_idempotencia.sql
git commit -m "feat(ordenes): idempotencia de recepcion multiple"
```

---

## Task 5: Cablear la idempotency key

**Files:**
- Modify: `app/api/recepciones/route.ts`
- Modify: `components/ordenes/recepcion-form.tsx`
- Test: `__tests__/api/recepcion-idempotencia.test.ts`

- [ ] **Step 1: Test primero**

Que el `POST` propaga `idempotencyKey` a la RPC como `p_idempotency_key`, y que un body sin key sigue funcionando (la columna es nullable y el parámetro opcional, así que un cliente viejo no se rompe).

- [ ] **Step 2: Endpoint**

Agregar `idempotencyKey: z.string().optional()` al schema y pasarlo a la RPC.

- [ ] **Step 3: Form**

**El punto que decide si esto funciona:** la key se genera **una vez por submit**, no por intento de fetch. Si se generara adentro del `offlineFetch`, el replay traería una key nueva y el duplicado volvería.

```tsx
const onSubmit = async (data: RecepcionFormData) => {
  // Una key por submit: el replay offline reenvia este mismo body, asi que
  // generarla acá (y no dentro del fetch) es lo que hace que el reintento
  // sea reconocible como el mismo lote.
  const idempotencyKey = crypto.randomUUID()
  ...
}
```

- [ ] **Step 4: Verificar**

Run: `npx vitest run __tests__/api/recepcion-idempotencia.test.ts __tests__/api/recepcion-multiple-atomica.test.ts __tests__/components/recepcion-form-equipo-sync.test.tsx --testTimeout=30000 && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add app/api/recepciones/route.ts components/ordenes/recepcion-form.tsx __tests__/api/recepcion-idempotencia.test.ts
git commit -m "feat(ordenes): key de idempotencia por submit en la recepcion"
```

---

## Cierre

- [ ] `npx vitest run --testTimeout=30000` en verde (baseline de Slice 1: 265 archivos / 1976 tests)
- [ ] `npx tsc --noEmit` sin errores
- [ ] `npm run lint` sin errores (baseline: 173 warnings)
- [ ] Migración 280 aplicada a mano, con el `CREATE UNIQUE INDEX CONCURRENTLY` como statement separado
- [ ] Buscar `REC001` en el listado devuelve las órdenes del lote
- [ ] Reimprimir desde el detalle de una orden del lote produce el mismo comprobante y las mismas etiquetas
- [ ] **Prueba de duplicado**: crear una recepción en modo avión, restaurar la conexión, y confirmar que entra **una** sola
