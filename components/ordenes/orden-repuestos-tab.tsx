"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Trash2 } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { useModal } from "@/contexts/modal-context"

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
  /** Puede devolver una promesa: el llamador espera a que el refetch del
   *  padre termine antes de reactivar los controles, para evitar la ventana
   *  en la que el panel muestra "sin repuestos" mientras el padre aun no
   *  refrescó (lo que invitaba a reintentar y crear un repuesto duplicado). */
  onRepuestosChanged: () => void | Promise<void>
}

export function OrdenRepuestosTab({ ordenId, repuestos, onRepuestosChanged }: OrdenRepuestosTabProps) {
  const { formatPrice } = useCurrency()
  const { confirm, alert } = useModal()
  const [showAddRepuesto, setShowAddRepuesto] = useState(false)
  const [tipoRepuesto, setTipoRepuesto] = useState<"inventario" | "manual">("inventario")
  const [inventario, setInventario] = useState<any[]>([])
  const [inventarioLoaded, setInventarioLoaded] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [nuevoRepuesto, setNuevoRepuesto] = useState({
    inventarioId: "",
    cantidad: 1,
    nombre: "",
    precioUnitario: 0,
  })
  // Raw editing strings so the inputs can show empty while a valid numeric stays in nuevoRepuesto.
  const [cantidadDraft, setCantidadDraft] = useState("1")
  const [precioDraft, setPrecioDraft] = useState("")

  // Lazy load inventario only when add form is opened
  useEffect(() => {
    if (showAddRepuesto && !inventarioLoaded) {
      fetch("/api/inventario?limit=100", { cache: "no-store" })
        .then((res) => res.json())
        .then((data) => {
          const items = data.data ?? (Array.isArray(data) ? data : [])
          setInventario(items)
          setInventarioLoaded(true)
        })
        .catch((err) => console.error("Error fetching inventario:", err))
    }
  }, [showAddRepuesto, inventarioLoaded])

  const handleAddRepuesto = async () => {
    if (tipoRepuesto === "inventario") {
      if (!nuevoRepuesto.inventarioId || nuevoRepuesto.cantidad < 1) {
        await alert({
          title: "Datos incompletos",
          description: "Selecciona un item y cantidad",
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
            inventarioId: nuevoRepuesto.inventarioId,
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
        // Esperamos el refetch del padre antes de cerrar el formulario: si no,
        // el panel muestra brevemente "no hay repuestos agregados" sin ningun
        // indicador de carga, lo que invita a reintentar y duplicar el alta.
        await onRepuestosChanged?.()
        setNuevoRepuesto({ inventarioId: "", cantidad: 1, nombre: "", precioUnitario: 0 })
        setCantidadDraft("1")
        setPrecioDraft("")
        setShowAddRepuesto(false)
        setInventarioLoaded(false) // Refresh inventory stock on next open
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
        setInventarioLoaded(false) // Refresh inventory stock on next open
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

  const subtotalRepuestos = repuestos?.reduce(
    (sum, r) => sum + r.cantidad * r.precioUnitario,
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
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">Item</Label>
                  <Select
                    value={nuevoRepuesto.inventarioId || "none"}
                    onValueChange={(value) => setNuevoRepuesto({ ...nuevoRepuesto, inventarioId: value === "none" ? "" : value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Seleccionar...</SelectItem>
                      {inventario.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.nombre} (Stock: {item.stock})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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

            <div className="flex gap-2">
              <Button size="sm" onClick={handleAddRepuesto} disabled={updating}>
                Agregar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowAddRepuesto(false)
                  setTipoRepuesto("inventario")
                  setNuevoRepuesto({ inventarioId: "", cantidad: 1, nombre: "", precioUnitario: 0 })
                  setCantidadDraft("1")
                  setPrecioDraft("")
                }}
              >
                Cancelar
              </Button>
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
                <div>
                  <div className="font-medium flex items-center gap-2">
                    {repuesto.inventario?.nombre || repuesto.nombre}
                    {!repuesto.inventario && (
                      <span className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                        Manual
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {repuesto.cantidad} × {formatPrice(repuesto.precioUnitario)}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold">
                    {formatPrice(repuesto.cantidad * repuesto.precioUnitario)}
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
