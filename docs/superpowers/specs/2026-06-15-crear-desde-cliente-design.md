# Crear orden / cotización desde el cliente (SP-B)

**Fecha:** 2026-06-15 · **Estado:** Diseño aprobado

## Problema

Para crear una orden o una cotización a un cliente existente, hoy hay que ir a
`/ordenes` (o `/cotizaciones`), abrir el form y buscar el cliente de nuevo en el
selector — aunque uno venga justo de mirar a ese cliente en su lista o detalle.
Es fricción innecesaria en el flujo más común de un taller.

## Objetivo

Permitir crear una orden o una cotización con el cliente **ya preseleccionado**,
desde la lista de clientes y desde el detalle del cliente, en un clic.

## Alcance

Solo el "atajo" de creación con cliente precargado. Fuera de alcance: prefill de
otros campos (dispositivo, problema, ítems), y los flujos de edición existentes.
No hay cambios de API ni de base de datos.

## Decisiones (cerradas)

1. **Deep-link como mecanismo.** Los botones navegan a
   `/ordenes?clienteId=<id>` y `/cotizaciones?clienteId=<id>`. La página destino
   auto-abre su modal de creación con el cliente preseleccionado. Reusa el patrón
   ya existente (`?fromTurno=` en órdenes, `?abrir=` en cotizaciones). Sin estado
   global nuevo.
2. **Entry points: detalle + lista.**
   - Detalle: un dropdown "Nuevo ▾" en el header (para no amontonar botones junto
     a Editar/WhatsApp, sobre todo en mobile).
   - Lista: items en el popover de acciones de fila (desktop) y en el menú de la
     card mobile.
3. **Cotización desde cliente = `PRESUPUESTO`** (documento sin orden asociada).
4. **`CotizacionForm` no cambia por dentro** — ya inicializa `clienteId` desde
   `initialData`. `OrdenForm` sí suma una prop `initialClienteId`.

## Arquitectura

### Órdenes

`components/ordenes/ordenes-list.tsx` (hoy lee `?fromTurno=` en `:104-107` y
auto-abre el form; renderiza `<OrdenForm fromTurnoId=...>` en `:792-801`):
- Leer `const clienteIdParam = searchParams?.get("clienteId") || null`.
- `useEffect`: si `clienteIdParam`, `setShowForm(true)`.
- Pasar `initialClienteId={clienteIdParam || undefined}` a `<OrdenForm>`.
- Al cerrar/success, si había `clienteIdParam`, limpiar la URL con
  `router.replace(pathname)` (igual que el manejo de `fromTurno`).
- `fromTurno` y `clienteId` son mutuamente excluyentes en la práctica; si llegaran
  ambos, `fromTurno` tiene precedencia (su prefill ya setea el cliente).

`components/ordenes/orden-form.tsx` (props en `:81`, firma en `:119`; patrón de
preselección de cliente vía `setValue("clienteId", ...)` + `selectedClienteObj`
visto en `:208`):
- Agregar `initialClienteId?: string` a `OrdenFormProps` y a la firma.
- `useEffect` (mount): si `initialClienteId` y NO `fromTurnoId`:
  - `setValue("clienteId", initialClienteId, { shouldValidate: true })`.
  - `fetch('/api/clientes/' + initialClienteId)` → `setSelectedClienteObj(cliente)`
    para que el `ClienteSelector` muestre el nombre (mismo objetivo que el path de
    turno, que setea `selectedClienteObj` desde el cliente del prefill).
  - Manejar error del fetch en silencio (el id igual queda seteado; el selector
    puede resolverlo).

### Cotizaciones

`app/(dashboard)/cotizaciones/page.tsx` (hoy lee `?abrir=` en `:217-241` para
abrir una cotización existente; renderiza el form nuevo en `:592`
`{showForm && !editingCotizacion}`):
- Leer `const clienteIdParam = searchParams?.get("clienteId")`.
- `useEffect` (una sola vez por valor, con un `ref` guard como el de `abrir`): si
  `clienteIdParam`, guardar en estado `nuevoClienteId`, `setShowForm(true)`, y
  limpiar el param de la URL (`router.replace` sin `clienteId`).
- En el render del form nuevo (`:592`), pasar `tipo="PRESUPUESTO"` y
  `initialData={{ clienteId: nuevoClienteId }}` cuando `nuevoClienteId` esté
  seteado. (Confirmar en implementación el `tipo` que usa hoy el botón "nueva
  cotización" para no romperlo; el deep-link de cliente usa PRESUPUESTO.)

`components/cotizaciones/cotizacion-form.tsx`: sin cambios — `clienteId` ya se
inicializa desde `initialData?.clienteId` (`:113`) y el form resuelve el objeto
cliente para el selector internamente.

### Entry points (UI)

`components/clientes/detalle/cliente-detalle-header.tsx`:
- Agregar un dropdown "Nuevo" (Popover/DropdownMenu del kit) junto a Editar/
  WhatsApp, con dos acciones que navegan (`useRouter().push`):
  - "Orden" → `/ordenes?clienteId=${cliente.id}`
  - "Cotización" → `/cotizaciones?clienteId=${cliente.id}`

`components/clientes/clientes-list.tsx` (popover de acciones de fila):
- Agregar items "Nueva orden" y "Nueva cotización" que navegan a los deep-links
  con `cliente.id`.

`components/clientes/cliente-mobile-card.tsx` (menú de la card):
- Mismos dos items en el popover existente.

Iconos: usar los de lucide ya presentes (p.ej. `Wrench`/`ClipboardList` para
orden, `Receipt`/`FileText` para cotización) según lo que ya use el proyecto en
órdenes/cotizaciones, para mantener consistencia.

## Estados y errores

- **Cliente borrado entre el clic y la apertura**: el form abre con el id; si el
  fetch del cliente falla, el selector queda sin nombre pero el usuario puede
  re-elegir. No bloquea.
- **Deep-link directo** (pegar la URL `/ordenes?clienteId=x`): funciona igual —
  abre el form con el cliente. Comportamiento intencional.
- **Limpieza de URL**: tras abrir, se quita `clienteId` de la URL para que un
  refresh no re-abra el form ni el back quede raro (igual que `fromTurno`/`abrir`).

## Testing

Sin API nueva. Infra de test del repo: solo API (no componentes). Verificación:
`npx tsc --noEmit` + `npm run build` + recorrido manual:
- Desde detalle: "Nuevo → Orden" abre `/ordenes` con el cliente cargado; idem
  Cotización (tipo Presupuesto).
- Desde lista (desktop y mobile): mismos atajos.
- Crear y guardar una orden/cotización así persiste con el `clienteId` correcto.
- La URL queda limpia tras abrir.

## Plan de entrega

Un solo PR. Orden:
1. Órdenes: `initialClienteId` en `OrdenForm` + lectura de `?clienteId=` en
   `ordenes-list.tsx`.
2. Cotizaciones: lectura de `?clienteId=` + form nuevo con `initialData.clienteId`
   y `tipo=PRESUPUESTO` en `cotizaciones/page.tsx`.
3. Entry points: dropdown en el header del detalle + items en lista y card mobile.
4. Verificación: typecheck, build, recorrido manual.

## Fuera de alcance

- Prefill de dispositivo / problema / ítems (solo cliente).
- Cambios en los flujos de edición de orden/cotización.
- Cambios de API o de base de datos.
