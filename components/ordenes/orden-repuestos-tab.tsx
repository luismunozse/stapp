"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AlertTriangle, Check, Minus, Plus, Trash2 } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { useModal } from "@/contexts/modal-context"
import { ESTADOS_ENTREGA } from "@/lib/orden-state-machine"
import type { EstadoOrden } from "@/types"
import {
  InventarioSearchCombobox,
  disponibleDe,
  type InventarioOption,
} from "./inventario-search-combobox"

interface Repuesto {
  id: string
  inventarioId?: string | null
  inventario?: { id: string; nombre: string; stock: number } | null
  nombre?: string
  cantidad: number
  precioUnitario: number
}

interface OrdenRepuestosTabProps {
  ordenId: string
  repuestos: Repuesto[]
  /** Estado de la orden. En una orden cerrada la reserva de stock ya se
   *  consumió (entregada) o se liberó (cancelada), así que la cantidad no se
   *  puede reajustar: el servidor rechaza el PATCH con 409. */
  ordenEstado?: EstadoOrden | string | null
  /** Puede devolver una promesa: el llamador espera a que el refetch del
   *  padre termine antes de reactivar los controles, para evitar la ventana
   *  en la que el panel muestra "sin repuestos" mientras el padre aun no
   *  refrescó (lo que invitaba a reintentar y crear un repuesto duplicado). */
  onRepuestosChanged: () => void | Promise<void>
}

const ESTADOS_CERRADOS: string[] = [...ESTADOS_ENTREGA, "CANCELADO"]

export function OrdenRepuestosTab({ ordenId, repuestos, ordenEstado, onRepuestosChanged }: OrdenRepuestosTabProps) {
  const { formatPrice } = useCurrency()
  const { confirm, alert } = useModal()
  const ordenCerrada = !!ordenEstado && ESTADOS_CERRADOS.includes(ordenEstado)
  const [showAddRepuesto, setShowAddRepuesto] = useState(false)
  const [tipoRepuesto, setTipoRepuesto] = useState<"inventario" | "manual">("inventario")
  const [itemSeleccionado, setItemSeleccionado] = useState<InventarioOption | null>(null)
  // Bump para que el combobox vuelva a consultar el stock tras alta/baja.
  const [inventarioRefreshKey, setInventarioRefreshKey] = useState(0)
  const [updating, setUpdating] = useState(false)
  const [nuevoRepuesto, setNuevoRepuesto] = useState({
    cantidad: 1,
    nombre: "",
    precioUnitario: 0,
  })
  // Raw editing strings so the inputs can show empty while a valid numeric stays in nuevoRepuesto.
  const [cantidadDraft, setCantidadDraft] = useState("1")
  const [precioDraft, setPrecioDraft] = useState("")
  // Carga en lote: tras agregar, el form queda abierto y el foco vuelve al buscador.
  const [focusSignal, setFocusSignal] = useState(0)
  const [ultimoAgregado, setUltimoAgregado] = useState<string | null>(null)
  // Cantidades optimistas por repuesto mientras el PATCH viaja.
  const [cantidadPendiente, setCantidadPendiente] = useState<Record<string, number>>({})
  const [ajustando, setAjustando] = useState<string | null>(null)
  const patchTimers = useRef<Record<string, number>>({})

  // Limpiar timers pendientes al desmontar para no patchear sobre un componente muerto.
  useEffect(() => {
    const timers = patchTimers.current
    return () => {
      Object.values(timers).forEach((t) => window.clearTimeout(t))
    }
  }, [])

  // El aviso de "agregado" se desvanece solo: es confirmacion, no un estado.
  useEffect(() => {
    if (!ultimoAgregado) return
    const t = window.setTimeout(() => setUltimoAgregado(null), 2500)
    return () => window.clearTimeout(t)
  }, [ultimoAgregado])

  const disponibleSeleccionado = itemSeleccionado ? disponibleDe(itemSeleccionado) : 0
  // Mismo criterio que el RPC add_repuesto_inventario (stock - reservado):
  // avisamos antes de mandar el POST en vez de esperar el 400 del servidor.
  const excedeStock =
    tipoRepuesto === "inventario" &&
    !!itemSeleccionado &&
    nuevoRepuesto.cantidad > disponibleSeleccionado

  const resetForm = () => {
    setItemSeleccionado(null)
    setNuevoRepuesto({ cantidad: 1, nombre: "", precioUnitario: 0 })
    setCantidadDraft("1")
    setPrecioDraft("")
  }

  const handleAddRepuesto = async () => {
    if (tipoRepuesto === "inventario") {
      if (!itemSeleccionado || nuevoRepuesto.cantidad < 1) {
        await alert({
          title: "Datos incompletos",
          description: "Buscá y seleccioná un repuesto del inventario, e indicá la cantidad.",
          variant: "warning",
        })
        return
      }
      if (excedeStock) {
        await alert({
          title: "Stock insuficiente",
          description: `Solo hay ${disponibleSeleccionado} unidad(es) disponibles de ${itemSeleccionado.nombre}.`,
          variant: "warning",
        })
        return
      }
    } else {
      if (!nuevoRepuesto.nombre.trim() || nuevoRepuesto.cantidad < 1 || nuevoRepuesto.precioUnitario < 0) {
        await alert({
          title: "Datos incompletos",
          description: "Completa nombre, cantidad y precio",
          variant: "warning",
        })
        return
      }
    }

    setUpdating(true)
    try {
      const payload = tipoRepuesto === "inventario"
        ? {
            tipo: "inventario",
            inventarioId: itemSeleccionado!.id,
            cantidad: nuevoRepuesto.cantidad,
          }
        : {
            tipo: "manual",
            nombre: nuevoRepuesto.nombre.trim(),
            cantidad: nuevoRepuesto.cantidad,
            precioUnitario: nuevoRepuesto.precioUnitario,
          }

      const res = await fetch(`/api/ordenes/${ordenId}/repuestos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        const nombreAgregado = tipoRepuesto === "inventario"
          ? itemSeleccionado!.nombre
          : nuevoRepuesto.nombre.trim()
        // Esperamos el refetch del padre antes de limpiar el formulario: si no,
        // el panel muestra brevemente "no hay repuestos agregados" sin ningun
        // indicador de carga, lo que invita a reintentar y duplicar el alta.
        await onRepuestosChanged?.()
        resetForm()
        // Carga en lote: el formulario NO se cierra. Una reparacion tipica lleva
        // varios repuestos y cerrar el panel obligaba a reabrirlo cada vez.
        setInventarioRefreshKey((k) => k + 1) // Refresh inventory stock on next open
        setUltimoAgregado(nombreAgregado)
        if (tipoRepuesto === "inventario") setFocusSignal((k) => k + 1)
      } else {
        const error = await res.json()
        await alert({
          title: "Error",
          description: error.error || "Error al agregar repuesto",
          variant: "error",
        })
      }
    } catch (error) {
      console.error("Error adding repuesto:", error)
    } finally {
      setUpdating(false)
    }
  }

  const handleRemoveRepuesto = async (repuestoId: string) => {
    const confirmed = await confirm({
      title: "Eliminar repuesto",
      description: "¿Estás seguro de eliminar este repuesto de la orden?",
      confirmText: "Eliminar",
      variant: "danger",
    })
    if (!confirmed) return

    setUpdating(true)
    try {
      const res = await fetch(
        `/api/ordenes/${ordenId}/repuestos?repuestoId=${repuestoId}`,
        { method: "DELETE" }
      )
      if (res.ok) {
        // Mismo tratamiento que al agregar: esperar el refetch antes de
        // reactivar los controles evita la ventana de estado enganoso.
        await onRepuestosChanged?.()
        setInventarioRefreshKey((k) => k + 1) // Refresh inventory stock on next open
      } else {
        const error = await res.json()
        await alert({ title: "Error", description: error.error || "Error al eliminar repuesto", variant: "error" })
      }
    } catch (error) {
      console.error("Error removing repuesto:", error)
      await alert({ title: "Error", description: "Error al eliminar repuesto", variant: "error" })
    } finally {
      setUpdating(false)
    }
  }

  /** Cantidad a mostrar: la optimista si hay un PATCH en vuelo, si no la del servidor. */
  const cantidadDe = (repuesto: Repuesto) =>
    cantidadPendiente[repuesto.id] ?? repuesto.cantidad

  /**
   * Stepper de cantidad. Pinta el cambio al instante y agrupa los clicks
   * rapidos en un solo PATCH: tocar "+" cuatro veces manda una peticion con 5,
   * no cuatro peticiones que compiten por la misma reserva de stock.
   */
  const handleCantidadChange = (repuesto: Repuesto, nuevaCantidad: number) => {
    if (nuevaCantidad < 1 || ordenCerrada) return

    setCantidadPendiente((prev) => ({ ...prev, [repuesto.id]: nuevaCantidad }))

    if (patchTimers.current[repuesto.id]) {
      window.clearTimeout(patchTimers.current[repuesto.id])
    }

    patchTimers.current[repuesto.id] = window.setTimeout(async () => {
      delete patchTimers.current[repuesto.id]
      setAjustando(repuesto.id)
      try {
        const res = await fetch(
          `/api/ordenes/${ordenId}/repuestos?repuestoId=${repuesto.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cantidad: nuevaCantidad }),
          }
        )

        if (!res.ok) {
          const error = await res.json().catch(() => ({}))
          await alert({
            title: "No se pudo cambiar la cantidad",
            description: error.error || "Error al actualizar la cantidad",
            variant: "error",
          })
        }
        // Tanto en exito como en error refrescamos: el servidor es la verdad y
        // asi la cantidad optimista no queda pegada si el PATCH fue rechazado.
        await onRepuestosChanged?.()
        setInventarioRefreshKey((k) => k + 1)
      } catch (error) {
        console.error("Error updating repuesto cantidad:", error)
        await onRepuestosChanged?.()
      } finally {
        setAjustando(null)
        setCantidadPendiente((prev) => {
          const next = { ...prev }
          delete next[repuesto.id]
          return next
        })
      }
    }, 500)
  }

  const subtotalRepuestos = repuestos?.reduce(
    (sum, r) => sum + cantidadDe(r) * r.precioUnitario,
    0
  ) || 0

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Repuestos Utilizados</CardTitle>
          {!showAddRepuesto && (
            <Button size="sm" variant="outline" onClick={() => setShowAddRepuesto(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Agregar
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {showAddRepuesto && (
          <div className="mb-4 p-3 border rounded-lg space-y-3 bg-muted/30">
            <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
              <button
                type="button"
                onClick={() => setTipoRepuesto("inventario")}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  tipoRepuesto === "inventario"
                    ? "bg-background shadow-sm font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Del inventario
              </button>
              <button
                type="button"
                onClick={() => setTipoRepuesto("manual")}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  tipoRepuesto === "manual"
                    ? "bg-background shadow-sm font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Manual
              </button>
            </div>

            {tipoRepuesto === "inventario" ? (
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Repuesto</Label>
                  <InventarioSearchCombobox
                    value={itemSeleccionado}
                    onChange={setItemSeleccionado}
                    disabled={updating}
                    refreshKey={inventarioRefreshKey}
                    focusSignal={focusSignal}
                  />
                </div>
                {itemSeleccionado && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label className="text-xs">Cantidad</Label>
                      <Input
                        type="number"
                        min="1"
                        max={disponibleSeleccionado}
                        aria-invalid={excedeStock}
                        value={cantidadDraft}
                        onChange={(e) => {
                          setCantidadDraft(e.target.value)
                          setNuevoRepuesto({ ...nuevoRepuesto, cantidad: parseInt(e.target.value, 10) || 1 })
                        }}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Subtotal</Label>
                      <div className="flex h-10 items-center rounded-md border border-dashed px-3 text-sm font-medium">
                        {formatPrice(itemSeleccionado.precioCompra * nuevoRepuesto.cantidad)}
                      </div>
                    </div>
                  </div>
                )}
                {excedeStock && (
                  <p className="flex items-center gap-1.5 text-xs text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    Solo hay {disponibleSeleccionado} disponible(s) de este repuesto.
                  </p>
                )}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-3">
                  <Label className="text-xs">Nombre del repuesto</Label>
                  <Input
                    placeholder="Ej: Flex de carga iPhone 12"
                    value={nuevoRepuesto.nombre}
                    onChange={(e) => setNuevoRepuesto({ ...nuevoRepuesto, nombre: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-xs">Cantidad</Label>
                  <Input
                    type="number"
                    min="1"
                    value={cantidadDraft}
                    onChange={(e) => {
                      setCantidadDraft(e.target.value)
                      setNuevoRepuesto({ ...nuevoRepuesto, cantidad: parseInt(e.target.value, 10) || 1 })
                    }}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-xs">Costo unitario</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={precioDraft}
                    onChange={(e) => {
                      setPrecioDraft(e.target.value)
                      setNuevoRepuesto({ ...nuevoRepuesto, precioUnitario: parseFloat(e.target.value) || 0 })
                    }}
                  />
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleAddRepuesto} disabled={updating || excedeStock}>
                Agregar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowAddRepuesto(false)
                  setTipoRepuesto("inventario")
                  setUltimoAgregado(null)
                  resetForm()
                }}
              >
                Listo
              </Button>
              {ultimoAgregado && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-500" />
                  Agregado: {ultimoAgregado}
                </span>
              )}
            </div>
          </div>
        )}

        {repuestos && repuestos.length > 0 ? (
          <div className="space-y-2">
            {repuestos.map((repuesto) => (
              <div
                key={repuesto.id}
                className="flex items-center justify-between p-3 border rounded-lg"
              >
                <div className="min-w-0">
                  <div className="font-medium flex items-center gap-2">
                    <span className="truncate">{repuesto.inventario?.nombre || repuesto.nombre}</span>
                    {!repuesto.inventario && (
                      <span className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground shrink-0">
                        Manual
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {cantidadDe(repuesto)} × {formatPrice(repuesto.precioUnitario)}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {!ordenCerrada && (
                    <div className="flex items-center rounded-md border">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-r-none"
                        aria-label={`Quitar una unidad de ${repuesto.inventario?.nombre || repuesto.nombre}`}
                        disabled={updating || cantidadDe(repuesto) <= 1}
                        onClick={() => handleCantidadChange(repuesto, cantidadDe(repuesto) - 1)}
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </Button>
                      <span
                        aria-live="polite"
                        className={`min-w-8 text-center text-sm tabular-nums ${
                          ajustando === repuesto.id ? "text-muted-foreground" : ""
                        }`}
                      >
                        {cantidadDe(repuesto)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-l-none"
                        aria-label={`Agregar una unidad de ${repuesto.inventario?.nombre || repuesto.nombre}`}
                        disabled={updating}
                        onClick={() => handleCantidadChange(repuesto, cantidadDe(repuesto) + 1)}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                  <span className="font-semibold">
                    {formatPrice(cantidadDe(repuesto) * repuesto.precioUnitario)}
                  </span>
                  <Button variant="ghost" size="icon" className="h-8 w-8" disabled={updating} onClick={() => handleRemoveRepuesto(repuesto.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
            <div className="flex justify-between pt-3 border-t font-semibold">
              <span>Subtotal Repuestos</span>
              <span>{formatPrice(subtotalRepuestos)}</span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            No hay repuestos agregados
          </p>
        )}
      </CardContent>
    </Card>
  )
}
