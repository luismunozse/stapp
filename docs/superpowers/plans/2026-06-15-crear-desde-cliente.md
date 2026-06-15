# Crear orden / cotización desde el cliente (SP-B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crear una orden o cotización con el cliente ya preseleccionado, vía deep-link, desde la lista y el detalle del cliente.

**Architecture:** Botones en la UI de clientes navegan a `/ordenes?clienteId=<id>` y `/cotizaciones?clienteId=<id>`. Cada página destino lee el param, auto-abre su modal de creación y precarga el cliente (órdenes vía nueva prop `initialClienteId`; cotizaciones vía `initialData.clienteId` + `tipo=PRESUPUESTO`). Reusa el patrón `?fromTurno`/`?abrir` ya existente.

**Tech Stack:** Next.js App Router (client components), React Hook Form (órdenes), SWR, UI kit propio (Popover, Button), lucide-react.

**Convención de tests:** No hay API ni DB nueva, y no existe infra de test de componentes React. Verificación: `npx tsc --noEmit` + `npm run build` + recorrido manual. (Errores/ruido pre-existentes a ignorar: `__tests__/lib/csv-export.test.ts` Buffer; build warnings firebase-admin / Google Fonts / superadmin DYNAMIC_SERVER_USAGE.)

**Comandos:** typecheck `npx tsc --noEmit` · build `npm run build`.

---

## File Structure

**Modificar:**
- `components/ordenes/orden-form.tsx` — prop `initialClienteId` + effect de preselección.
- `components/ordenes/ordenes-list.tsx` — leer `?clienteId=`, auto-abrir, pasar prop, limpiar URL.
- `app/(dashboard)/cotizaciones/page.tsx` — leer `?clienteId=`, abrir form nuevo PRESUPUESTO con `initialData.clienteId`, limpiar URL.
- `components/clientes/detalle/cliente-detalle-header.tsx` — dropdown "Nuevo" (Orden / Cotización).
- `components/clientes/clientes-list.tsx` — items en el popover de acciones de fila.
- `components/clientes/cliente-mobile-card.tsx` — items en el menú de la card.

Sin archivos nuevos. `components/cotizaciones/cotizacion-form.tsx` NO se toca (ya soporta `initialData.clienteId`).

---

## Task 1: Órdenes — preselección de cliente vía `?clienteId=`

**Files:**
- Modify: `components/ordenes/orden-form.tsx`
- Modify: `components/ordenes/ordenes-list.tsx`

- [ ] **Step 1: `OrdenForm` acepta `initialClienteId`**

En `components/ordenes/orden-form.tsx`:
- En `interface OrdenFormProps` (`:81`), agregar:
  ```ts
  initialClienteId?: string
  ```
- En la firma del componente (`:119`), agregar el prop:
  ```ts
  export function OrdenForm({ onClose, onSuccess, fromTurnoId, initialClienteId }: OrdenFormProps) {
  ```

- [ ] **Step 2: Effect de preselección (espejo del de turno)**

En `orden-form.tsx`, inmediatamente DESPUÉS del `useEffect` de prefill de turno (termina en `:226`), agregar:

```tsx
  // Preselección de cliente vía deep-link (?clienteId=) — no aplica si viene de turno
  useEffect(() => {
    if (!initialClienteId || fromTurnoId) return
    let cancelled = false
    setValue("clienteId", initialClienteId, { shouldValidate: true })
    fetch(`/api/clientes/${initialClienteId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((cliente) => {
        if (cancelled || !cliente || cliente.error) return
        setSelectedClienteObj(cliente)
      })
      .catch(() => {})
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialClienteId])
```

Confirmar que `setSelectedClienteObj` y `setValue` están en scope (lo están: el effect de turno los usa en `:207-208`).

- [ ] **Step 3: `OrdenesList` lee `?clienteId=` y lo pasa**

En `components/ordenes/ordenes-list.tsx`:
- Junto a `const fromTurnoId = searchParams?.get("fromTurno") || null` (`:104`), agregar:
  ```ts
  const clienteIdParam = searchParams?.get("clienteId") || null
  ```
- Extender el `useEffect` que auto-abre el form (`:105-107`) para cubrir también clienteId:
  ```ts
  useEffect(() => {
    if (fromTurnoId || clienteIdParam) setShowForm(true)
  }, [fromTurnoId, clienteIdParam])
  ```
- En el `<OrdenForm>` (`:792-801`), agregar la prop y limpiar también `clienteId` de la URL al cerrar/success. Pasar:
  ```tsx
  <OrdenForm
    fromTurnoId={fromTurnoId || undefined}
    initialClienteId={clienteIdParam || undefined}
    onClose={() => {
      setShowForm(false)
      if (fromTurnoId || clienteIdParam) router.replace(pathname)
    }}
    onSuccess={() => {
      setShowForm(false)
      if (fromTurnoId || clienteIdParam) router.replace(pathname)
      mutate()  // conservar lo que haya hoy en onSuccess (revalidación de la lista)
    }}
  />
  ```
  IMPORTANTE: leer el `onClose`/`onSuccess` actuales del archivo y CONSERVAR su lógica (p.ej. la llamada a `mutate()`/refresh de la lista); solo sumar la limpieza de URL para `clienteIdParam`. `router` y `pathname` ya se usan para `fromTurno` (`:797`, `:801`).

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit` (sin errores nuevos; ignorar csv-export Buffer)
Run: `npm run build` ("✓ Compiled successfully")

- [ ] **Step 5: Commit**

```bash
git add components/ordenes/orden-form.tsx components/ordenes/ordenes-list.tsx
git commit -m "feat(ordenes): preseleccionar cliente via ?clienteId="
```

---

## Task 2: Cotizaciones — preselección de cliente vía `?clienteId=`

**Files:**
- Modify: `app/(dashboard)/cotizaciones/page.tsx`

Contexto: la página ya tiene `showForm`, `editingCotizacion`, un `formTipo` state (usado en el render del form nuevo `:592-602` con `key={`new-${formTipo}`}` y `tipo={formTipo}`), y un patrón de deep-link `?abrir=` con `ref` guard (`:217-241`). `CotizacionForm` inicializa `clienteId` desde `initialData?.clienteId`.

- [ ] **Step 1: Estado para el cliente del deep-link**

Cerca de los otros `useState` de la página, agregar:
```ts
const [nuevoClienteId, setNuevoClienteId] = useState<string | null>(null)
```

- [ ] **Step 2: Effect que lee `?clienteId=` y abre el form nuevo (PRESUPUESTO)**

Replicando el patrón del `?abrir=` (con su propio `ref` guard), agregar cerca de `:217-241`:
```tsx
const clienteParamRef = useRef<string | null>(null)
useEffect(() => {
  const clienteIdParam = searchParams?.get("clienteId")
  if (!clienteIdParam || clienteParamRef.current === clienteIdParam) return
  clienteParamRef.current = clienteIdParam
  setNuevoClienteId(clienteIdParam)
  setFormTipo("PRESUPUESTO")
  setShowForm(true)
  const params = new URLSearchParams(searchParams?.toString() ?? "")
  params.delete("clienteId")
  router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ""}`)
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [searchParams])
```
Confirmar que `setFormTipo`, `router`, `pathname`, `searchParams`, `useRef` están disponibles (el `?abrir=` usa `searchParams` y `router`; `formTipo` ya es state). Si `pathname` no está importado, usar `usePathname()` de `next/navigation` (o reusar el que ya use el manejo de `?abrir=`).

- [ ] **Step 3: Pasar `initialData.clienteId` al form nuevo**

Modificar el render del form nuevo (`:592-602`):
```tsx
{showForm && !editingCotizacion && (
  <CotizacionForm
    key={`new-${formTipo}-${nuevoClienteId ?? ""}`}
    tipo={formTipo}
    initialData={nuevoClienteId ? { clienteId: nuevoClienteId } : undefined}
    onClose={() => { setShowForm(false); setNuevoClienteId(null) }}
    onSuccess={() => {
      setShowForm(false)
      setNuevoClienteId(null)
      mutate()
    }}
  />
)}
```
CONSERVAR cualquier lógica extra del `onClose`/`onSuccess` actual (p.ej. `mutate()` u otra revalidación); solo sumar el `initialData` y el reset de `nuevoClienteId`.

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit` (sin errores nuevos)
Run: `npm run build` ("✓ Compiled successfully")

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/cotizaciones/page.tsx"
git commit -m "feat(cotizaciones): preseleccionar cliente via ?clienteId= (presupuesto)"
```

---

## Task 3: Entry points — botones en detalle, lista y card mobile

**Files:**
- Modify: `components/clientes/detalle/cliente-detalle-header.tsx`
- Modify: `components/clientes/clientes-list.tsx`
- Modify: `components/clientes/cliente-mobile-card.tsx`

Usar `Popover` del kit (`@/components/ui/popover`) — el mismo que ya usa `clientes-list.tsx` / `cliente-mobile-card.tsx` para sus menús de acción. Navegación con `useRouter().push(...)`. Iconos lucide: `Wrench` (orden) y `Receipt` (cotización) — verificar que existan en lucide-react (se usan en `navbar.tsx`); si alguno no, usar `ClipboardList` / `FileText`.

- [ ] **Step 1: Dropdown "Nuevo" en el header del detalle**

En `components/clientes/detalle/cliente-detalle-header.tsx`:
- Importar: `import { useRouter } from "next/navigation"`, `import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"`, y los iconos (`Plus`, `Wrench`, `Receipt`) de `lucide-react` (sumar a imports existentes sin duplicar).
- En el componente, `const router = useRouter()`.
- En la fila de acciones (junto a los botones Editar / WhatsApp), agregar:
  ```tsx
  <Popover>
    <PopoverTrigger asChild>
      <Button variant="default" size="sm" className="gap-1.5">
        <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Nuevo</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-44 p-1">
      <button type="button" className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors"
        onClick={() => router.push(`/ordenes?clienteId=${cliente.id}`)}>
        <Wrench className="h-4 w-4" /> Nueva orden
      </button>
      <button type="button" className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors"
        onClick={() => router.push(`/cotizaciones?clienteId=${cliente.id}`)}>
        <Receipt className="h-4 w-4" /> Nueva cotización
      </button>
    </PopoverContent>
  </Popover>
  ```
  Confirmar que `cliente.id` está disponible en este componente (el header recibe `cliente`).

- [ ] **Step 2: Items en el popover de acciones de la lista (desktop)**

En `components/clientes/clientes-list.tsx`, en el `PopoverContent` del menú de acciones de fila (el que ya tiene "Enviar WhatsApp", "Cobrar órdenes", "Cuenta corriente", "Eliminar"), agregar al inicio dos items:
```tsx
<button type="button"
  className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors"
  onClick={(e) => { e.stopPropagation(); router.push(`/ordenes?clienteId=${cliente.id}`) }}>
  <Wrench className="h-4 w-4" /> Nueva orden
</button>
<button type="button"
  className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors"
  onClick={(e) => { e.stopPropagation(); router.push(`/cotizaciones?clienteId=${cliente.id}`) }}>
  <Receipt className="h-4 w-4" /> Nueva cotización
</button>
<div className="h-px bg-border my-1" />
```
`router` ya existe en `clientes-list.tsx` (se usó para `onRowClick`). Agregar los iconos `Wrench`/`Receipt` al import de lucide si faltan. NO romper el `stopPropagation` de las acciones existentes.

- [ ] **Step 3: Items en el menú de la card mobile**

En `components/clientes/cliente-mobile-card.tsx`, en el `PopoverContent` del menú (junto a WhatsApp/Cobrar/Cuenta corriente/Eliminar), agregar los mismos dos items (con `router.push` a los deep-links y `e.stopPropagation()`). `useRouter` ya se importó en este archivo (se usó para navegar al detalle); reusar `router`. Sumar iconos `Wrench`/`Receipt` al import lucide si faltan.

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit` (sin errores nuevos)
Run: `npm run build` ("✓ Compiled successfully")

- [ ] **Step 5: Commit**

```bash
git add components/clientes/detalle/cliente-detalle-header.tsx components/clientes/clientes-list.tsx components/clientes/cliente-mobile-card.tsx
git commit -m "feat(clientes): accesos a nueva orden/cotizacion desde lista y detalle"
```

---

## Task 4: Verificación final

- [ ] **Step 1: Typecheck + build + suite**

Run: `npx tsc --noEmit` (solo csv-export Buffer pre-existente)
Run: `npm run build` ("✓ Compiled successfully")
Run: `npm run test:run` (todo verde — no se tocó nada de tests; confirmar que nada se rompió)

- [ ] **Step 2: Recorrido manual**

- Detalle de un cliente → "Nuevo → Nueva orden" → abre `/ordenes` con el form y el cliente cargado en el selector. Guardar una orden → persiste con ese `clienteId`. La URL queda sin `clienteId` tras abrir.
- Detalle → "Nuevo → Nueva cotización" → abre `/cotizaciones` con form Presupuesto y cliente cargado.
- Lista (desktop): menú de acciones de una fila → "Nueva orden"/"Nueva cotización" → idem.
- Lista (mobile): menú de la card → idem.
- Pegar directo `/ordenes?clienteId=<id>` en el navegador abre el form con el cliente.

- [ ] **Step 3: Commit final (si quedó algo suelto)**

```bash
git add -A
git commit -m "chore(clientes): ajustes finales crear-desde-cliente"
```

---

## Self-Review (completado)

- **Cobertura del spec:** órdenes deep-link + prop (T1), cotizaciones deep-link + PRESUPUESTO (T2), entry points detalle+lista+mobile (T3), verificación (T4). Todas las secciones cubiertas.
- **Placeholders:** ninguno; código concreto en cada step. Los "CONSERVAR la lógica actual de onClose/onSuccess" son instrucciones de cuidado, no placeholders — el engineer debe leer el handler real y no pisarlo.
- **Consistencia:** deep-links idénticos en T1/T2/T3 (`/ordenes?clienteId=`, `/cotizaciones?clienteId=`). Prop `initialClienteId` definida en T1 Step 1 y consumida en T1 Step 3. `nuevoClienteId`/`formTipo=PRESUPUESTO` consistentes en T2. Iconos `Wrench`/`Receipt` consistentes en T3.
- **Riesgos marcados con verificación:** disponibilidad de `setSelectedClienteObj`/`setValue` (T1 S2), `pathname`/`setFormTipo` en cotizaciones (T2 S2), existencia de iconos lucide (T3 intro), no pisar handlers existentes (T1 S3, T2 S3), `stopPropagation` intacto (T3 S2).
- **Dependencia:** SP-B no depende de la migración 225 (es independiente de SP-A); funciona sobre el detalle/lista ya en main.
