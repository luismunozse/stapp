# Detalle 360 de cliente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crear una página `/clientes/[id]` que consolide datos, cuenta corriente, órdenes (pendientes + historial), cotizaciones y sectores de un cliente, reusando APIs y diálogos existentes.

**Architecture:** Página server `app/(dashboard)/clientes/[id]/page.tsx` que monta un orquestador client con SWR. Cada sección carga su data independiente desde APIs existentes. Se agrega el filtro `clienteId` a dos GET (`/api/ordenes`, `/api/cotizaciones`) y se extrae la lógica de cuenta corriente del diálogo a un panel compartido. Sin migraciones ni cambios de esquema.

**Tech Stack:** Next.js App Router, React client components, SWR, next-auth (`useSession`), Supabase (`supabaseAdmin`), Zod, Vitest (tests de API), Tailwind + UI kit propio (`Card`, `Badge`, `Button`, `DataTable`, `EmptyState`, `PageShell`, `Popover`).

**Convención de tests:** Solo hay infra de test de API (`__tests__/api/` con `vitest` + `helpers.ts`). NO hay infra de test de componentes React (sin RTL/jsdom). Por lo tanto: tareas de API usan TDD estricto; tareas de UI se verifican con `npx tsc --noEmit` + `npm run build` + verificación manual. No se crea infra nueva de test de componentes.

**Comandos:**
- Test puntual: `npm run test:run -- <ruta-del-test>`
- Todos los tests: `npm run test:run`
- Typecheck: `npx tsc --noEmit`
- Build: `npm run build`

---

## File Structure

**Crear:**
- `app/(dashboard)/clientes/[id]/page.tsx` — Server Component, lee `params.id`, monta orquestador.
- `components/clientes/detalle/cliente-detalle.tsx` — orquestador client (SWR a `GET /api/clientes/[id]`, estado de diálogos).
- `components/clientes/detalle/cliente-detalle-header.tsx` — header sticky + cards de resumen.
- `components/clientes/detalle/cliente-detalle-datos.tsx` — datos de contacto / dirección / razón social / opt-in WhatsApp.
- `components/clientes/detalle/cuenta-corriente-panel.tsx` — panel compartido extraído del diálogo.
- `components/clientes/detalle/cliente-ordenes-pendientes.tsx` — bloque deuda + "Cobrar todo".
- `components/clientes/detalle/cliente-ordenes-historial.tsx` — tabla paginada de órdenes.
- `components/clientes/detalle/cliente-cotizaciones.tsx` — tabla de cotizaciones.
- `components/clientes/detalle/cliente-sectores.tsx` — sectores (solo EMPRESA).
- `__tests__/api/ordenes-cliente-filter.test.ts` — test del filtro `clienteId` en órdenes.
- `__tests__/api/cotizaciones-cliente-filter.test.ts` — test del filtro `clienteId` en cotizaciones.

**Modificar:**
- `app/api/ordenes/route.ts` — agregar filtro `clienteId` en `GET`.
- `app/api/cotizaciones/route.ts` — agregar filtro `clienteId` en `GET` (modo standalone).
- `components/clientes/cuenta-corriente-dialog.tsx` — renderizar `CuentaCorrientePanel` adentro.
- `components/clientes/clientes-list.tsx` — `onRowClick` → navegar al detalle.
- `components/clientes/cliente-mobile-card.tsx` — click en cuerpo de card → navegar al detalle.

---

## Task 1: Filtro `clienteId` en `GET /api/ordenes`

**Files:**
- Test: `__tests__/api/ordenes-cliente-filter.test.ts`
- Modify: `app/api/ordenes/route.ts:64` (zona de lectura de params) y `app/api/ordenes/route.ts:130` (zona de aplicación de filtros, después del filtro `tecnicoId`)

- [ ] **Step 1: Write the failing test**

Crear `__tests__/api/ordenes-cliente-filter.test.ts`. Mockea `sucursalParaLectura` (devuelve `verTodas: true`) y `formatOrden` (passthrough) para aislar el filtro:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/sucursal", () => ({
  sucursalParaLectura: vi.fn().mockResolvedValue({ verTodas: true, sucursalId: null }),
}))

vi.mock("@/lib/db-utils", () => ({
  formatOrden: (o: any) => o,
}))

import { GET } from "@/app/api/ordenes/route"

describe("GET /api/ordenes — filtro clienteId", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("filtra por cliente_id cuando se pasa clienteId", async () => {
    mockAuthSuccess()
    const chain = createChainMock([], null, 0)
    mockSupabaseFrom({ ordenes_servicio: chain })

    await GET(createGetRequest("http://localhost:3000/api/ordenes?clienteId=c1"))

    expect(chain.eq).toHaveBeenCalledWith("cliente_id", "c1")
  })

  it("no filtra por cliente_id cuando no se pasa clienteId", async () => {
    mockAuthSuccess()
    const chain = createChainMock([], null, 0)
    mockSupabaseFrom({ ordenes_servicio: chain })

    await GET(createGetRequest("http://localhost:3000/api/ordenes"))

    const calledWithCliente = chain.eq.mock.calls.some((c) => c[0] === "cliente_id")
    expect(calledWithCliente).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- __tests__/api/ordenes-cliente-filter.test.ts`
Expected: FAIL — el primer test falla porque `chain.eq` nunca se llama con `("cliente_id", "c1")`.

- [ ] **Step 3: Implement the filter**

En `app/api/ordenes/route.ts`, después de la línea que lee `tecnicoId` (`:63`), agregar la lectura del param:

```ts
    const clienteId = searchParams.get("clienteId") || ""
```

Luego, en la zona de aplicación de filtros, justo después del bloque `if (tecnicoId) { ... }` (`:130-132`), agregar:

```ts
    if (clienteId) {
      query = query.eq("cliente_id", clienteId)
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- __tests__/api/ordenes-cliente-filter.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos.

- [ ] **Step 6: Commit**

```bash
git add __tests__/api/ordenes-cliente-filter.test.ts app/api/ordenes/route.ts
git commit -m "feat(ordenes): filtro clienteId en GET /api/ordenes"
```

---

## Task 2: Filtro `clienteId` en `GET /api/cotizaciones`

**Files:**
- Test: `__tests__/api/cotizaciones-cliente-filter.test.ts`
- Modify: `app/api/cotizaciones/route.ts:155` (lectura de params) y `app/api/cotizaciones/route.ts:203` (modo standalone, después del filtro `estado`)

- [ ] **Step 1: Write the failing test**

Crear `__tests__/api/cotizaciones-cliente-filter.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
} from "./helpers"

import { GET } from "@/app/api/cotizaciones/route"

describe("GET /api/cotizaciones — filtro clienteId", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("filtra por cliente_id cuando se pasa clienteId (modo standalone)", async () => {
    mockAuthSuccess()
    const chain = createChainMock([], null, 0)
    mockSupabaseFrom({ cotizaciones: chain })

    await GET(createGetRequest("http://localhost:3000/api/cotizaciones?clienteId=c1"))

    expect(chain.eq).toHaveBeenCalledWith("cliente_id", "c1")
  })

  it("no filtra por cliente_id cuando no se pasa clienteId", async () => {
    mockAuthSuccess()
    const chain = createChainMock([], null, 0)
    mockSupabaseFrom({ cotizaciones: chain })

    await GET(createGetRequest("http://localhost:3000/api/cotizaciones"))

    const calledWithCliente = chain.eq.mock.calls.some((c) => c[0] === "cliente_id")
    expect(calledWithCliente).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- __tests__/api/cotizaciones-cliente-filter.test.ts`
Expected: FAIL — `chain.eq` no se llama con `("cliente_id", "c1")`.

- [ ] **Step 3: Implement the filter**

En `app/api/cotizaciones/route.ts`, en el `GET`, después de `const search = searchParams.get("search")` (`:155`), agregar:

```ts
    const clienteId = searchParams.get("clienteId")
```

Luego, en el **modo standalone** (después del `if (estado && estado !== "TODOS") query = query.eq("estado", estado)` en `:203`), agregar:

```ts
    if (clienteId) query = query.eq("cliente_id", clienteId)
```

(No tocar el modo legacy `ordenId`; el detalle de cliente siempre usa el modo standalone.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- __tests__/api/cotizaciones-cliente-filter.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos.

- [ ] **Step 6: Commit**

```bash
git add __tests__/api/cotizaciones-cliente-filter.test.ts app/api/cotizaciones/route.ts
git commit -m "feat(cotizaciones): filtro clienteId en GET /api/cotizaciones"
```

---

## Task 3: Extraer `CuentaCorrientePanel` del diálogo

Mueve toda la lógica interna de `CuentaCorrienteDialog` (saldo, form de depósito, lista de movimientos, fetch) a un panel reutilizable, sin el wrapper `Dialog`. El diálogo pasa a renderizar el panel. Se agrega el gate de UI por rol con `useSession`.

**Files:**
- Create: `components/clientes/detalle/cuenta-corriente-panel.tsx`
- Modify: `components/clientes/cuenta-corriente-dialog.tsx`

- [ ] **Step 1: Crear el panel compartido**

Crear `components/clientes/detalle/cuenta-corriente-panel.tsx` con TODO el cuerpo actual del diálogo salvo el wrapper `Dialog/DialogContent/DialogHeader`. Acepta `cliente` y un callback opcional. El botón de depósito se oculta si `useSession` reporta rol distinto de ADMIN:

```tsx
"use client"

import { useState, useEffect } from "react"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  PiggyBank, Plus, ArrowDownCircle, ArrowUpCircle, Banknote,
  ArrowRightLeft, CreditCard, Wallet, MoreHorizontal, Loader2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { EmptyState } from "@/components/ui/empty-state"
import { useCurrency } from "@/contexts/currency-context"
import { useModal } from "@/contexts/modal-context"
import type { Cliente } from "@/types"

const METODOS_DEPOSITO = [
  { value: "EFECTIVO", label: "Efectivo", icon: Banknote },
  { value: "TRANSFERENCIA", label: "Transferencia", icon: ArrowRightLeft },
  { value: "TARJETA_DEBITO", label: "T. Débito", icon: CreditCard },
  { value: "TARJETA_CREDITO", label: "T. Crédito", icon: CreditCard },
  { value: "MERCADOPAGO", label: "MercadoPago", icon: Wallet },
  { value: "OTRO", label: "Otro", icon: MoreHorizontal },
] as const

type MetodoDeposito = typeof METODOS_DEPOSITO[number]["value"]

interface Movimiento {
  id: string
  tipo: string
  monto: number
  saldoPosterior: number
  metodoPago: string | null
  referenciaTipo: string | null
  referenciaId: string | null
  numeroReferencia: string | null
  observaciones: string | null
  createdAt: string
}

const tipoLabels: Record<string, string> = {
  DEPOSITO: "Depósito", USO: "Uso", DEVOLUCION: "Devolución", AJUSTE: "Ajuste",
}
const metodoPagoLabels: Record<string, string> = {
  EFECTIVO: "Efectivo", TRANSFERENCIA: "Transferencia", TARJETA_DEBITO: "Tarjeta Débito",
  TARJETA_CREDITO: "Tarjeta Crédito", MERCADOPAGO: "MercadoPago", OTRO: "Otro",
}

interface CuentaCorrientePanelProps {
  cliente: Cliente
  onDeposito?: () => void
}

export function CuentaCorrientePanel({ cliente, onDeposito }: CuentaCorrientePanelProps) {
  const { formatPrice, formatDate } = useCurrency()
  const { showError } = useModal()
  const { data: session } = useSession()
  const esAdmin = session?.user?.role === "ADMIN"

  const [saldo, setSaldo] = useState(0)
  const [movimientos, setMovimientos] = useState<Movimiento[]>([])
  const [loading, setLoading] = useState(true)
  const [showDeposito, setShowDeposito] = useState(false)
  const [depositoLoading, setDepositoLoading] = useState(false)
  const [depositoMonto, setDepositoMonto] = useState<string>("")
  const [depositoMetodo, setDepositoMetodo] = useState<MetodoDeposito>("EFECTIVO")
  const [depositoReferencia, setDepositoReferencia] = useState("")
  const [depositoObservaciones, setDepositoObservaciones] = useState("")

  const fetchData = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/clientes/${cliente.id}/cuenta-corriente?limit=50`)
      if (res.ok) {
        const data = await res.json()
        setSaldo(data.saldo || 0)
        setMovimientos(data.movimientos || [])
      }
    } catch (err) {
      console.error("Error fetching cuenta corriente:", err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    setShowDeposito(false)
    setDepositoMonto("")
    setDepositoMetodo("EFECTIVO")
    setDepositoReferencia("")
    setDepositoObservaciones("")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cliente.id])

  const handleDeposito = async () => {
    const depositoMontoNum = parseFloat(depositoMonto) || 0
    if (!depositoMontoNum || depositoMontoNum <= 0) {
      await showError("El monto debe ser mayor a 0")
      return
    }
    setDepositoLoading(true)
    try {
      const res = await fetch(`/api/clientes/${cliente.id}/cuenta-corriente`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monto: depositoMontoNum,
          metodoPago: depositoMetodo,
          numeroReferencia: depositoReferencia || undefined,
          observaciones: depositoObservaciones || undefined,
        }),
      })
      if (!res.ok) {
        const error = await res.json()
        await showError(error.error || "Error al registrar depósito")
        return
      }
      setDepositoMonto("")
      setDepositoMetodo("EFECTIVO")
      setDepositoReferencia("")
      setDepositoObservaciones("")
      setShowDeposito(false)
      fetchData()
      onDeposito?.()
    } catch (err) {
      console.error("Error creating deposito:", err)
      await showError("Error al registrar depósito")
    } finally {
      setDepositoLoading(false)
    }
  }

  const showReferencia = depositoMetodo === "TRANSFERENCIA" || depositoMetodo === "MERCADOPAGO"

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <div className="text-center">
            <div className="text-sm text-muted-foreground">Saldo disponible</div>
            <div className={cn(
              "text-2xl font-bold tabular-nums mt-1",
              saldo > 0 ? "text-info-600" : "text-muted-foreground"
            )}>
              {formatPrice(saldo)}
            </div>
          </div>
        </CardContent>
      </Card>

      {esAdmin && (
        <Button
          onClick={() => setShowDeposito(!showDeposito)}
          variant={showDeposito ? "outline" : "default"}
          className="w-full"
        >
          <Plus className="mr-2 h-4 w-4" />
          Registrar Depósito a Cuenta
        </Button>
      )}

      {esAdmin && showDeposito && (
        <div className="rounded-lg border p-4 space-y-4">
          <h4 className="font-medium text-sm">Nuevo Depósito</h4>
          <div className="grid grid-cols-3 gap-1.5">
            {METODOS_DEPOSITO.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setDepositoMetodo(value)}
                className={cn(
                  "flex flex-col items-center gap-0.5 p-2 rounded-lg border-2 text-center transition-all text-[10px] leading-tight",
                  depositoMetodo === value
                    ? "border-primary bg-primary/5 text-primary font-medium"
                    : "border-border hover:border-muted-foreground/30 text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{label}</span>
              </button>
            ))}
          </div>
          <div>
            <Label className="text-xs">Monto *</Label>
            <Input type="number" step="0.01" min="0" value={depositoMonto}
              onChange={(e) => setDepositoMonto(e.target.value)} placeholder="0.00" />
          </div>
          {showReferencia && (
            <div>
              <Label className="text-xs">Nro. de referencia</Label>
              <Input value={depositoReferencia} onChange={(e) => setDepositoReferencia(e.target.value)}
                placeholder={depositoMetodo === "TRANSFERENCIA" ? "CBU, alias o nro. de operación" : "Nro. de operación MercadoPago"} />
            </div>
          )}
          <div>
            <Label className="text-xs">Observaciones</Label>
            <Textarea value={depositoObservaciones} onChange={(e) => setDepositoObservaciones(e.target.value)}
              placeholder="Notas del depósito..." rows={2} />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setShowDeposito(false)}>Cancelar</Button>
            <Button size="sm" onClick={handleDeposito} disabled={depositoLoading}>
              {depositoLoading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Registrando...</>) : "Registrar Depósito"}
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h4 className="font-medium text-sm">Movimientos</h4>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : movimientos.length === 0 ? (
          <EmptyState icon={ArrowRightLeft} title="Sin movimientos" variant="default" />
        ) : (
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {movimientos.map((mov) => (
              <div key={mov.id} className="flex items-start justify-between p-3 bg-muted/50 rounded-lg">
                <div className="flex items-start gap-2">
                  {mov.monto >= 0 ? (
                    <ArrowDownCircle className="h-4 w-4 text-success-600 mt-0.5 shrink-0" />
                  ) : (
                    <ArrowUpCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                  )}
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className={cn("font-medium text-sm", mov.monto >= 0 ? "text-success-600" : "text-destructive")}>
                        {mov.monto >= 0 ? "+" : ""}{formatPrice(Math.abs(mov.monto))}
                      </span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {tipoLabels[mov.tipo] || mov.tipo}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(mov.createdAt)}
                      {mov.metodoPago && ` · ${metodoPagoLabels[mov.metodoPago] || mov.metodoPago}`}
                    </div>
                    {mov.referenciaTipo && mov.referenciaTipo !== "MANUAL" && (
                      <div className="text-xs text-muted-foreground">
                        {mov.referenciaTipo === "VENTA" ? "Venta" : mov.referenciaTipo === "FACTURA" ? "Factura" : mov.referenciaTipo}
                      </div>
                    )}
                    {mov.observaciones && (
                      <div className="text-xs text-muted-foreground">{mov.observaciones}</div>
                    )}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground whitespace-nowrap">
                  Saldo: {formatPrice(mov.saldoPosterior)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Reescribir el diálogo para usar el panel**

Reemplazar el contenido de `components/clientes/cuenta-corriente-dialog.tsx` por una versión delgada que reusa el panel:

```tsx
"use client"

import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { PiggyBank } from "lucide-react"
import { CuentaCorrientePanel } from "@/components/clientes/detalle/cuenta-corriente-panel"
import type { Cliente } from "@/types"

interface CuentaCorrienteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  cliente: Cliente
  onDeposito?: () => void
}

export function CuentaCorrienteDialog({
  open, onOpenChange, cliente, onDeposito,
}: CuentaCorrienteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PiggyBank className="h-5 w-5" />
            Cuenta Corriente - {cliente.nombre}
          </DialogTitle>
        </DialogHeader>
        {open && <CuentaCorrientePanel cliente={cliente} onDeposito={onDeposito} />}
      </DialogContent>
    </Dialog>
  )
}
```

(El `{open && ...}` garantiza que el panel se monta/refetch al abrir, replicando el `if (open) fetchData()` original.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Verificación manual**

Abrir la lista de clientes → menú "Cuenta corriente" de un cliente con saldo. Verificar: saldo se muestra, movimientos cargan, depósito funciona como ADMIN. Cambiar a usuario no-ADMIN (o simular): el botón de depósito no aparece.

- [ ] **Step 5: Commit**

```bash
git add components/clientes/detalle/cuenta-corriente-panel.tsx components/clientes/cuenta-corriente-dialog.tsx
git commit -m "refactor(clientes): extraer CuentaCorrientePanel reutilizable"
```

---

## Task 4: Ruta `/clientes/[id]` + orquestador + header/resumen

**Files:**
- Create: `app/(dashboard)/clientes/[id]/page.tsx`
- Create: `components/clientes/detalle/cliente-detalle.tsx`
- Create: `components/clientes/detalle/cliente-detalle-header.tsx`

- [ ] **Step 1: Crear la página server**

`app/(dashboard)/clientes/[id]/page.tsx`:

```tsx
import { ClienteDetalle } from "@/components/clientes/detalle/cliente-detalle"

export default async function ClienteDetallePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <ClienteDetalle clienteId={id} />
}
```

- [ ] **Step 2: Crear el header + cards de resumen**

`components/clientes/detalle/cliente-detalle-header.tsx`:

```tsx
"use client"

import Link from "next/link"
import { ArrowLeft, User, Building2, Edit } from "lucide-react"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useCurrency } from "@/contexts/currency-context"
import type { Cliente } from "@/types"

interface ClienteDetalleHeaderProps {
  cliente: Cliente
  saldo: number
  deudaPendiente: number
  totalOrdenes: number
  onEdit: () => void
  onWhatsApp: () => void
}

export function ClienteDetalleHeader({
  cliente, saldo, deudaPendiente, totalOrdenes, onEdit, onWhatsApp,
}: ClienteDetalleHeaderProps) {
  const { formatPrice } = useCurrency()
  const esEmpresa = cliente.tipoCliente === "EMPRESA"

  return (
    <div className="sticky top-0 z-10 bg-background border-b -mx-4 px-4 pb-4 sm:-mx-6 sm:px-6">
      <div className="flex items-start gap-3 pt-4">
        <Link href="/clientes" className="shrink-0 p-2 -ml-2 rounded-lg hover:bg-accent transition-colors" aria-label="Volver a clientes">
          <ArrowLeft className="h-5 w-5 text-muted-foreground" />
        </Link>
        <div className={`h-11 w-11 rounded-full flex items-center justify-center shrink-0 ${esEmpresa ? "bg-warning/10" : "bg-primary/10"}`}>
          {esEmpresa ? <Building2 className="h-5 w-5 text-warning-600" /> : <User className="h-5 w-5 text-primary" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg sm:text-2xl font-bold leading-tight">{cliente.nombre}</h1>
            {esEmpresa && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-warning/10 text-warning-700">Empresa</span>
            )}
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2">
            {cliente.telefono && <span>{cliente.telefono}</span>}
            {cliente.email && <span className="truncate">· {cliente.email}</span>}
            {(cliente.cuit || cliente.dni) && <span>· {cliente.cuit ? `CUIT ${cliente.cuit}` : `DNI ${cliente.dni}`}</span>}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button variant="outline" size="sm" onClick={onEdit} className="gap-1.5">
            <Edit className="h-4 w-4" /> <span className="hidden sm:inline">Editar</span>
          </Button>
          <Button variant="outline" size="sm" onClick={onWhatsApp} className="gap-1.5">
            <WhatsAppIcon className="h-4 w-4 text-success-600" /> <span className="hidden sm:inline">WhatsApp</span>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3 mt-4">
        <Card><CardContent className="p-3 text-center">
          <div className="text-xs text-muted-foreground">Saldo a favor</div>
          <div className="text-base sm:text-lg font-bold tabular-nums text-info-600">{formatPrice(saldo)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <div className="text-xs text-muted-foreground">Deuda pendiente</div>
          <div className={`text-base sm:text-lg font-bold tabular-nums ${deudaPendiente > 0 ? "text-destructive" : "text-muted-foreground"}`}>
            {formatPrice(deudaPendiente)}
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <div className="text-xs text-muted-foreground"># Órdenes</div>
          <div className="text-base sm:text-lg font-bold tabular-nums">{totalOrdenes}</div>
        </CardContent></Card>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Crear el orquestador (con secciones placeholder por ahora)**

`components/clientes/detalle/cliente-detalle.tsx`. Hace SWR a `GET /api/clientes/[id]`, a `/ordenes-pendientes` (para la deuda) y a `/api/ordenes?clienteId=...&limit=1` (para el total). Monta header + diálogos. Las secciones se agregan en tareas siguientes; por ahora dejar comentarios `{/* Secciones: Task 5-9 */}`:

```tsx
"use client"

import { useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { Button } from "@/components/ui/button"
import { ClienteDetalleHeader } from "./cliente-detalle-header"
import { ClienteForm } from "@/components/clientes/cliente-form"
import { ClienteWhatsAppDialog } from "@/components/clientes/cliente-whatsapp-dialog"
import type { Cliente } from "@/types"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface OrdenPendiente { id: string; pendiente: number }

export function ClienteDetalle({ clienteId }: { clienteId: string }) {
  const [showEdit, setShowEdit] = useState(false)
  const [showWhatsApp, setShowWhatsApp] = useState(false)

  const { data: cliente, error, isLoading, mutate } = useSWR<Cliente>(
    `/api/clientes/${clienteId}`, fetcher, { revalidateOnFocus: false }
  )
  const { data: ccData, mutate: mutateCC } = useSWR(
    `/api/clientes/${clienteId}/cuenta-corriente?limit=1`, fetcher, { revalidateOnFocus: false }
  )
  const { data: pendientes } = useSWR<OrdenPendiente[]>(
    `/api/clientes/${clienteId}/ordenes-pendientes`, fetcher, { revalidateOnFocus: false }
  )
  const { data: ordenesData } = useSWR(
    `/api/ordenes?clienteId=${clienteId}&limit=1`, fetcher, { revalidateOnFocus: false }
  )
  const { data: configData } = useSWR("/api/configuracion", fetcher, {
    revalidateOnFocus: false, dedupingInterval: 60000,
  })
  const organizationName: string = configData?.nombreEmpresa || ""

  if (isLoading) {
    return (
      <PageShell title="Cliente">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </PageShell>
    )
  }

  if (error || !cliente || (cliente as any).error) {
    return (
      <PageShell title="Cliente no encontrado">
        <div className="text-center py-20 space-y-4">
          <p className="text-muted-foreground">No se encontró el cliente.</p>
          <Button asChild><Link href="/clientes">Volver a clientes</Link></Button>
        </div>
      </PageShell>
    )
  }

  const saldo = ccData?.saldo || 0
  const deudaPendiente = (pendientes || []).reduce((acc, o) => acc + (o.pendiente || 0), 0)
  const totalOrdenes = ordenesData?.total || 0

  return (
    <PageShell title="" noHeader>
      <ClienteDetalleHeader
        cliente={cliente}
        saldo={saldo}
        deudaPendiente={deudaPendiente}
        totalOrdenes={totalOrdenes}
        onEdit={() => setShowEdit(true)}
        onWhatsApp={() => setShowWhatsApp(true)}
      />

      <div className="space-y-6 pt-6">
        {/* Task 5: Datos & contacto */}
        {/* Task 3 panel: Cuenta corriente */}
        {/* Task 6: Órdenes pendientes + cobrar */}
        {/* Task 7: Historial de órdenes */}
        {/* Task 8: Cotizaciones */}
        {/* Task 9: Sectores (solo EMPRESA) */}
      </div>

      <ClienteForm
        open={showEdit}
        cliente={cliente}
        onClose={() => setShowEdit(false)}
        onSuccess={() => { setShowEdit(false); mutate() }}
      />
      {showWhatsApp && (
        <ClienteWhatsAppDialog
          open={showWhatsApp}
          onOpenChange={(o) => !o && setShowWhatsApp(false)}
          cliente={cliente}
          organizationName={organizationName}
        />
      )}
    </PageShell>
  )
}
```

- [ ] **Step 4: Verificar la prop `noHeader` de `PageShell`**

Abrir `components/ui/page-shell.tsx`. Si NO existe una prop para suprimir el header propio del shell, elegir una de estas alternativas y aplicarla:
- (a) Si `PageShell` acepta solo `children` sin requerir `title`, usar `<PageShell>` sin `title` ni `noHeader`.
- (b) Si `PageShell` siempre renderiza un header, NO usar `PageShell` en esta página: reemplazar por un `<div className="px-4 py-6 sm:px-6 max-w-5xl mx-auto">...</div>` como contenedor raíz (el header sticky propio ya cubre el título).

Aplicar la variante que corresponda y quitar `noHeader`/`title=""` si no son props válidas.

- [ ] **Step 5: Verificar la firma de `ClienteForm`**

Confirmar en `components/clientes/cliente-form.tsx` que las props son `open`, `cliente`, `onClose`, `onSuccess` (es el mismo uso que en `clientes-list.tsx:346-358`). Ajustar si difiere.

- [ ] **Step 6: Typecheck + build**

Run: `npx tsc --noEmit`
Run: `npm run build`
Expected: compila; la ruta `/clientes/[id]` aparece en el output del build.

- [ ] **Step 7: Verificación manual**

Navegar a `/clientes/<id-real>`. Verificar header con nombre, contacto, 3 cards de resumen con números correctos. Probar Editar y WhatsApp. Navegar a `/clientes/<id-inexistente>` → estado not-found con botón volver.

- [ ] **Step 8: Commit**

```bash
git add app/(dashboard)/clientes/[id]/page.tsx components/clientes/detalle/cliente-detalle.tsx components/clientes/detalle/cliente-detalle-header.tsx
git commit -m "feat(clientes): pagina de detalle con header y resumen"
```

---

## Task 5: Sección "Datos & contacto"

**Files:**
- Create: `components/clientes/detalle/cliente-detalle-datos.tsx`
- Modify: `components/clientes/detalle/cliente-detalle.tsx`

- [ ] **Step 1: Crear el componente**

`components/clientes/detalle/cliente-detalle-datos.tsx`:

```tsx
"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Phone, Mail, MapPin, IdCard, Building2, MessageCircle } from "lucide-react"
import type { Cliente } from "@/types"

function Row({ icon: Icon, label, value }: { icon: typeof Phone; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="text-muted-foreground">{label}:</span>
      <span className="truncate">{value}</span>
    </div>
  )
}

export function ClienteDetalleDatos({ cliente }: { cliente: Cliente }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Datos & contacto</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {cliente.telefono && <Row icon={Phone} label="Teléfono" value={cliente.telefono} />}
        {cliente.email && <Row icon={Mail} label="Email" value={cliente.email} />}
        {cliente.direccion && <Row icon={MapPin} label="Dirección" value={cliente.direccion} />}
        {cliente.dni && <Row icon={IdCard} label="DNI" value={cliente.dni} />}
        {cliente.razonSocial && <Row icon={Building2} label="Razón social" value={cliente.razonSocial} />}
        {cliente.cuit && <Row icon={IdCard} label="CUIT" value={cliente.cuit} />}
        <Row icon={MessageCircle} label="WhatsApp" value={cliente.aceptaWhatsapp === false ? "No recibe" : "Recibe"} />
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Montar en el orquestador**

En `cliente-detalle.tsx`, importar y reemplazar el comentario `{/* Task 5: Datos & contacto */}`:

```tsx
import { ClienteDetalleDatos } from "./cliente-detalle-datos"
```
```tsx
        <ClienteDetalleDatos cliente={cliente} />
```

- [ ] **Step 3: Typecheck + verificación manual**

Run: `npx tsc --noEmit`
Manual: la sección muestra los datos del cliente; los campos vacíos no se renderizan.

- [ ] **Step 4: Commit**

```bash
git add components/clientes/detalle/cliente-detalle-datos.tsx components/clientes/detalle/cliente-detalle.tsx
git commit -m "feat(clientes): seccion datos y contacto en detalle"
```

---

## Task 6: Sección "Cuenta corriente" + "Órdenes pendientes / Cobrar"

**Files:**
- Create: `components/clientes/detalle/cliente-ordenes-pendientes.tsx`
- Modify: `components/clientes/detalle/cliente-detalle.tsx`

- [ ] **Step 1: Montar el panel de cuenta corriente**

En `cliente-detalle.tsx`, importar el panel (Task 3) y un `Card` contenedor; reemplazar `{/* Task 3 panel: Cuenta corriente */}`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { CuentaCorrientePanel } from "./cuenta-corriente-panel"
```
```tsx
        <Card>
          <CardHeader><CardTitle className="text-base">Cuenta corriente</CardTitle></CardHeader>
          <CardContent>
            <CuentaCorrientePanel cliente={cliente} onDeposito={() => mutateCC()} />
          </CardContent>
        </Card>
```

- [ ] **Step 2: Crear el bloque de órdenes pendientes + cobrar**

`components/clientes/detalle/cliente-ordenes-pendientes.tsx`:

```tsx
"use client"

import { useState } from "react"
import useSWR from "swr"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { DollarSign, CheckCircle2 } from "lucide-react"
import { CobrarMultipleDialog } from "@/components/ordenes/cobrar-multiple-dialog"
import { useCurrency } from "@/contexts/currency-context"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface OrdenPendiente {
  id: string
  numeroOrden: number
  codigoOrden?: string
  dispositivo: string
  pendiente: number
  estadoCobro: string
}

interface Props {
  clienteId: string
  clienteNombre: string
  onCobrado?: () => void
}

export function ClienteOrdenesPendientes({ clienteId, clienteNombre, onCobrado }: Props) {
  const { formatPrice } = useCurrency()
  const [showCobrar, setShowCobrar] = useState(false)
  const { data, mutate } = useSWR<OrdenPendiente[]>(
    `/api/clientes/${clienteId}/ordenes-pendientes`, fetcher, { revalidateOnFocus: false }
  )

  const ordenes = data || []
  const totalPendiente = ordenes.reduce((acc, o) => acc + (o.pendiente || 0), 0)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Órdenes pendientes de cobro</CardTitle>
        {ordenes.length > 0 && (
          <Button size="sm" onClick={() => setShowCobrar(true)} className="gap-1.5">
            <DollarSign className="h-4 w-4" /> Cobrar todo ({formatPrice(totalPendiente)})
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {ordenes.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="Sin deuda pendiente" variant="default" />
        ) : (
          <div className="space-y-2">
            {ordenes.map((o) => (
              <div key={o.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div className="min-w-0">
                  <div className="font-medium text-sm">#{o.numeroOrden} · {o.dispositivo}</div>
                  <Badge variant="outline" className="text-[10px] mt-0.5">{o.estadoCobro}</Badge>
                </div>
                <div className="font-semibold tabular-nums text-destructive">{formatPrice(o.pendiente)}</div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {showCobrar && (
        <CobrarMultipleDialog
          open={showCobrar}
          onOpenChange={(o) => !o && setShowCobrar(false)}
          clienteId={clienteId}
          clienteNombre={clienteNombre}
          onSuccess={() => { setShowCobrar(false); mutate(); onCobrado?.() }}
        />
      )}
    </Card>
  )
}
```

- [ ] **Step 3: Montar en el orquestador**

En `cliente-detalle.tsx`, importar y reemplazar `{/* Task 6: Órdenes pendientes + cobrar */}`:

```tsx
import { ClienteOrdenesPendientes } from "./cliente-ordenes-pendientes"
```
```tsx
        <ClienteOrdenesPendientes
          clienteId={clienteId}
          clienteNombre={cliente.nombre}
          onCobrado={() => mutateCC()}
        />
```

- [ ] **Step 4: Verificar firma de `CobrarMultipleDialog`**

Confirmar en `components/ordenes/cobrar-multiple-dialog.tsx` que las props son `open`, `onOpenChange`, `clienteId`, `clienteNombre`, `onSuccess` (mismo uso que en `clientes-list.tsx:383-393`). Ajustar si difiere.

- [ ] **Step 5: Typecheck + verificación manual**

Run: `npx tsc --noEmit`
Manual: cliente con órdenes impagas muestra la lista + botón "Cobrar todo"; al cobrar, la lista y el saldo se actualizan. Cliente sin deuda muestra empty state.

- [ ] **Step 6: Commit**

```bash
git add components/clientes/detalle/cliente-ordenes-pendientes.tsx components/clientes/detalle/cliente-detalle.tsx
git commit -m "feat(clientes): cuenta corriente y ordenes pendientes en detalle"
```

---

## Task 7: Sección "Historial de órdenes"

**Files:**
- Create: `components/clientes/detalle/cliente-ordenes-historial.tsx`
- Modify: `components/clientes/detalle/cliente-detalle.tsx`

- [ ] **Step 1: Crear el componente (tabla paginada)**

`components/clientes/detalle/cliente-ordenes-historial.tsx`. Usa `DataTable` + `/api/ordenes?clienteId=`:

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Badge } from "@/components/ui/badge"
import { useCurrency } from "@/contexts/currency-context"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface OrdenRow {
  id: string
  numeroOrden: number
  dispositivo: string
  estado: string
  fechaIngreso: string
  costoFinal?: number | null
}

export function ClienteOrdenesHistorial({ clienteId }: { clienteId: string }) {
  const router = useRouter()
  const { formatDate, formatPrice } = useCurrency()
  const [page, setPage] = useState(1)
  const pageSize = 10

  const { data, isLoading } = useSWR(
    `/api/ordenes?clienteId=${clienteId}&page=${page}&limit=${pageSize}&sortBy=fecha_ingreso&sortOrder=desc`,
    fetcher, { revalidateOnFocus: false, keepPreviousData: true }
  )

  const ordenes: OrdenRow[] = data?.data || []
  const total: number = data?.total || 0

  const columns: Column<OrdenRow>[] = [
    { key: "numeroOrden", header: "Orden", render: (o) => <span className="font-medium">#{o.numeroOrden}</span> },
    { key: "dispositivo", header: "Dispositivo", render: (o) => <span className="truncate">{o.dispositivo}</span> },
    { key: "estado", header: "Estado", render: (o) => <Badge variant="outline" className="text-[10px]">{o.estado}</Badge> },
    { key: "fechaIngreso", header: "Ingreso", hideOnMobile: true, render: (o) => formatDate(o.fechaIngreso) },
    { key: "costoFinal", header: "Total", hideOnMobile: true, render: (o) => o.costoFinal ? formatPrice(o.costoFinal) : "-" },
  ]

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Historial de órdenes</CardTitle></CardHeader>
      <CardContent>
        <DataTable
          data={ordenes}
          columns={columns}
          keyExtractor={(o) => o.id}
          loading={isLoading}
          emptyMessage="Sin órdenes registradas"
          onRowClick={(o) => router.push(`/ordenes/${o.id}`)}
          pagination={{
            page, pageSize, total,
            onPageChange: setPage,
            onPageSizeChange: () => {},
          }}
        />
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Confirmar la ruta de detalle de orden**

Verificar que existe `app/(dashboard)/ordenes/[id]/page.tsx` (o equivalente) para que `/ordenes/${o.id}` sea válida. Si la ruta de detalle de orden es distinta, ajustar el `router.push`.

- [ ] **Step 3: Montar en el orquestador**

En `cliente-detalle.tsx`, reemplazar `{/* Task 7: Historial de órdenes */}`:

```tsx
import { ClienteOrdenesHistorial } from "./cliente-ordenes-historial"
```
```tsx
        <ClienteOrdenesHistorial clienteId={clienteId} />
```

- [ ] **Step 4: Typecheck + verificación manual**

Run: `npx tsc --noEmit`
Manual: la tabla lista las órdenes del cliente, pagina, y click en fila navega al detalle de la orden.

- [ ] **Step 5: Commit**

```bash
git add components/clientes/detalle/cliente-ordenes-historial.tsx components/clientes/detalle/cliente-detalle.tsx
git commit -m "feat(clientes): historial de ordenes en detalle"
```

---

## Task 8: Sección "Cotizaciones"

**Files:**
- Create: `components/clientes/detalle/cliente-cotizaciones.tsx`
- Modify: `components/clientes/detalle/cliente-detalle.tsx`

- [ ] **Step 1: Crear el componente**

`components/clientes/detalle/cliente-cotizaciones.tsx`. Usa `/api/cotizaciones?clienteId=` (modo standalone, devuelve `{ data, total }`):

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Badge } from "@/components/ui/badge"
import { useCurrency } from "@/contexts/currency-context"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface CotizacionRow {
  id: string
  numeroCotizacion?: string | number
  estado: string
  total?: number | null
  createdAt: string
}

export function ClienteCotizaciones({ clienteId }: { clienteId: string }) {
  const router = useRouter()
  const { formatDate, formatPrice } = useCurrency()
  const [page, setPage] = useState(1)
  const pageSize = 10

  const { data, isLoading } = useSWR(
    `/api/cotizaciones?clienteId=${clienteId}&page=${page}&limit=${pageSize}`,
    fetcher, { revalidateOnFocus: false, keepPreviousData: true }
  )

  const cotizaciones: CotizacionRow[] = data?.data || []
  const total: number = data?.total || 0

  const columns: Column<CotizacionRow>[] = [
    { key: "numeroCotizacion", header: "N°", render: (c) => <span className="font-medium">{c.numeroCotizacion ?? "-"}</span> },
    { key: "estado", header: "Estado", render: (c) => <Badge variant="outline" className="text-[10px]">{c.estado}</Badge> },
    { key: "total", header: "Total", hideOnMobile: true, render: (c) => c.total != null ? formatPrice(c.total) : "-" },
    { key: "createdAt", header: "Fecha", hideOnMobile: true, render: (c) => formatDate(c.createdAt) },
  ]

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Cotizaciones</CardTitle></CardHeader>
      <CardContent>
        <DataTable
          data={cotizaciones}
          columns={columns}
          keyExtractor={(c) => c.id}
          loading={isLoading}
          emptyMessage="Sin cotizaciones"
          onRowClick={(c) => router.push(`/cotizaciones/${c.id}`)}
          pagination={{
            page, pageSize, total,
            onPageChange: setPage,
            onPageSizeChange: () => {},
          }}
        />
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Confirmar los nombres de campo de cotización**

Abrir `app/api/cotizaciones/route.ts` y revisar `formatCotizacion` (`:80-145`) para confirmar los nombres exactos de `numeroCotizacion`, `estado`, `total`, `createdAt`. Ajustar el tipo `CotizacionRow` y los `render` si difieren (p.ej. si el campo es `numero_cotizacion` mapeado a `numeroCotizacion`). Confirmar también que existe la ruta `/cotizaciones/[id]`; si no, ajustar el `router.push`.

- [ ] **Step 3: Montar en el orquestador**

En `cliente-detalle.tsx`, reemplazar `{/* Task 8: Cotizaciones */}`:

```tsx
import { ClienteCotizaciones } from "./cliente-cotizaciones"
```
```tsx
        <ClienteCotizaciones clienteId={clienteId} />
```

- [ ] **Step 4: Typecheck + verificación manual**

Run: `npx tsc --noEmit`
Manual: la tabla lista cotizaciones del cliente, pagina, y el click navega al detalle.

- [ ] **Step 5: Commit**

```bash
git add components/clientes/detalle/cliente-cotizaciones.tsx components/clientes/detalle/cliente-detalle.tsx
git commit -m "feat(clientes): cotizaciones en detalle"
```

---

## Task 9: Sección "Sectores" (solo EMPRESA)

**Files:**
- Create: `components/clientes/detalle/cliente-sectores.tsx`
- Modify: `components/clientes/detalle/cliente-detalle.tsx`

La data de sectores YA viene en `GET /api/clientes/[id]` como `cliente.sectores` (array con `nombre`, `contactoNombre`, `contactoTelefono`, `contactoEmail`).

- [ ] **Step 1: Confirmar el tipo `SectorCliente`**

Abrir `types/index.ts` y confirmar la forma de `SectorCliente` (campos `nombre`, `contactoNombre`, `contactoTelefono`, `contactoEmail`). Usar esos nombres exactos en el componente.

- [ ] **Step 2: Crear el componente**

`components/clientes/detalle/cliente-sectores.tsx`:

```tsx
"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Building2, User, Phone, Mail } from "lucide-react"
import type { SectorCliente } from "@/types"

export function ClienteSectores({ sectores }: { sectores: SectorCliente[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Sectores</CardTitle></CardHeader>
      <CardContent>
        {sectores.length === 0 ? (
          <EmptyState icon={Building2} title="Sin sectores" variant="default" />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {sectores.map((s) => (
              <div key={s.id} className="p-3 rounded-lg border space-y-1">
                <div className="font-medium text-sm flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" /> {s.nombre}
                </div>
                {s.contactoNombre && (
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <User className="h-3.5 w-3.5" /> {s.contactoNombre}
                  </div>
                )}
                {s.contactoTelefono && (
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <Phone className="h-3.5 w-3.5" /> {s.contactoTelefono}
                  </div>
                )}
                {s.contactoEmail && (
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <Mail className="h-3.5 w-3.5" /> {s.contactoEmail}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 3: Montar en el orquestador (condicional EMPRESA)**

En `cliente-detalle.tsx`, reemplazar `{/* Task 9: Sectores (solo EMPRESA) */}`:

```tsx
import { ClienteSectores } from "./cliente-sectores"
```
```tsx
        {cliente.tipoCliente === "EMPRESA" && (
          <ClienteSectores sectores={cliente.sectores || []} />
        )}
```

- [ ] **Step 4: Typecheck + verificación manual**

Run: `npx tsc --noEmit`
Manual: cliente EMPRESA con sectores los muestra con contactos; cliente INDIVIDUAL no muestra la sección.

- [ ] **Step 5: Commit**

```bash
git add components/clientes/detalle/cliente-sectores.tsx components/clientes/detalle/cliente-detalle.tsx
git commit -m "feat(clientes): seccion sectores en detalle de empresa"
```

---

## Task 10: Navegación desde la lista hacia el detalle

**Files:**
- Modify: `components/clientes/clientes-list.tsx`
- Modify: `components/clientes/cliente-mobile-card.tsx`

- [ ] **Step 1: Desktop — `onRowClick` en el DataTable**

En `components/clientes/clientes-list.tsx`:
- Agregar el import de router al inicio: `import { useRouter } from "next/navigation"`.
- Dentro del componente `ClientesList`, agregar: `const router = useRouter()`.
- En el `<DataTable ... />` (`:408-427`), agregar la prop:

```tsx
          onRowClick={(cliente) => router.push(`/clientes/${cliente.id}`)}
```

(Las celdas de acciones y el botón de saldo ya usan `stopPropagation`, así que no disparan la navegación. La columna `actions` ya envuelve sus botones en `role="group"` con `stopPropagation`.)

- [ ] **Step 2: Mobile — click en el cuerpo de la card**

En `components/clientes/cliente-mobile-card.tsx`:
- Agregar import: `import { useRouter } from "next/navigation"`.
- En el componente, agregar `const router = useRouter()`.
- En la sección "Info" (`:124`, el `<div className="space-y-1.5 text-sm">`), hacerla clickeable agregando `onClick` + cursor:

```tsx
        <div
          className="space-y-1.5 text-sm cursor-pointer"
          onClick={() => router.push(`/clientes/${cliente.id}`)}
        >
```

(Los botones de acción están en el header con `role="group"` + `stopPropagation`, fuera de este div, así que no se ven afectados.)

- [ ] **Step 3: Typecheck + verificación manual**

Run: `npx tsc --noEmit`
Manual:
- Desktop: click en una fila (fuera de los botones) → navega a `/clientes/[id]`. Click en editar/saldo/menú → NO navega.
- Mobile: tap en el cuerpo de la card → navega. Tap en los botones del header → ejecuta la acción, no navega.

- [ ] **Step 4: Commit**

```bash
git add components/clientes/clientes-list.tsx components/clientes/cliente-mobile-card.tsx
git commit -m "feat(clientes): navegacion de lista a detalle de cliente"
```

---

## Task 11: Verificación final

- [ ] **Step 1: Suite completa de tests**

Run: `npm run test:run`
Expected: todos verdes, incluidos los 2 nuevos archivos y los existentes (`clientes.test.ts`, `v1-clientes.test.ts`).

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit`
Run: `npm run build`
Expected: sin errores; `/clientes/[id]` en el output.

- [ ] **Step 3: Recorrido manual end-to-end**

Desde `/clientes`: click en un cliente EMPRESA con saldo, deuda y órdenes. Verificar las 6 secciones, cobro, depósito (ADMIN), navegación a órdenes/cotizaciones, y volver. Repetir con un cliente INDIVIDUAL (sin sección sectores).

- [ ] **Step 4: Commit final (si quedó algo suelto)**

```bash
git add -A
git commit -m "chore(clientes): ajustes finales detalle 360"
```

---

## Self-Review (completado)

- **Cobertura del spec:** Datos (T5), Cuenta corriente (T3+T6), Órdenes pendientes+Cobrar (T6), Historial de órdenes (T7), Cotizaciones (T8), Sectores (T9), ruta+header+resumen (T4), navegación (T10), filtros backend (T1+T2), refactor panel (T3). Todas las secciones del spec tienen tarea.
- **Placeholders:** ninguno; todo el código está completo. Los comentarios `{/* Task N */}` son marcadores intencionales reemplazados por tareas posteriores.
- **Consistencia de tipos:** `CuentaCorrientePanel(cliente, onDeposito)` usado igual en diálogo (T3) y detalle (T6). `Column`/`DataTable`/`onRowClick`/`pagination` consistentes con la firma real verificada. Respuestas de API: ordenes/cotizaciones `{ data, total }`, cuenta-corriente `{ saldo, movimientos }`, ordenes-pendientes array con `pendiente`.
- **Riesgos verificables marcados:** firma de `PageShell` (T4 Step 4), `ClienteForm` (T4 Step 5), `CobrarMultipleDialog` (T6 Step 4), rutas `/ordenes/[id]` y `/cotizaciones/[id]` (T7/T8), campos de `formatCotizacion` (T8 Step 2) y `SectorCliente` (T9 Step 1). Cada uno tiene un step de confirmación antes de depender de él.
