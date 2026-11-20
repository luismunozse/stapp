"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Trash2 } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { sumaLineasOrden } from "@/lib/servicios/suma-lineas-orden"
import { AplicarAlTotalAviso } from "./aplicar-al-total-aviso"
import { useModal } from "@/contexts/modal-context"

interface ServicioOrdenLinea {
  id: string
  servicioId?: string | null
  nombre: string
  cantidad: number
  precioUnitario: number
}

interface OrdenServiciosTabProps {
  ordenId: string
  servicios: ServicioOrdenLinea[]
  /** costo_final actual de la orden (puede ser null). Se compara contra el
   *  subtotal de las lineas para decidir si hace falta ofrecer "Aplicar al
   *  total" — ver lib/servicios/sincronizar-costo-final.ts, que no actualiza
   *  costo_final en silencio si la orden ya tiene cobros o si el costo fue
   *  editado a mano. */
  costoFinal: number | null
  /** presupuesto actual de la orden. Antes de APROBADO es el monto VIVO: es lo
   *  que las lineas de servicio alimentan y contra lo que se compara el
   *  subtotal — ver calcularMontoSincronizado. */
  presupuesto: number | null
  /** Decide cual de los dos montos esta vivo. En estados terminales no hay
   *  ninguno y la tab no ofrece sincronizar nada. */
  estado: string
  /** total_cobrado de la orden. Se muestra en el banner de "Aplicar al total"
   *  y en su confirmación: el backend (PUT /api/ordenes/[id]) rechaza bajar
   *  costo_final por debajo de este monto, así que el operador tiene que ver
   *  el número antes de disparar el pedido. */
  totalCobrado: number
  /** Repuestos de la orden: suman al monto igual que los servicios (migración
   *  419), así que el aviso "Aplicar al total" compara contra los dos. */
  repuestos?: Array<{ cantidad: number; precioVentaUnitario?: number | null; precioUnitario?: number | null }>
  /** Puede devolver una promesa: el llamador espera a que el refetch del
   *  padre termine antes de reactivar los controles, para evitar la ventana
   *  en la que el panel muestra "sin servicios" mientras el padre aun no
   *  refrescó (lo que invitaba a reintentar y crear un servicio duplicado). */
  onServiciosChanged: () => void | Promise<void>
}

export function OrdenServiciosTab({ ordenId, servicios, costoFinal, presupuesto, estado, totalCobrado, repuestos = [], onServiciosChanged }: OrdenServiciosTabProps) {
  const { formatPrice } = useCurrency()
  const { confirm, alert } = useModal()
  const [showAddServicio, setShowAddServicio] = useState(false)
  const [tipoServicio, setTipoServicio] = useState<"catalogo" | "manual">("catalogo")
  const [catalogo, setCatalogo] = useState<any[]>([])
  const [catalogoLoaded, setCatalogoLoaded] = useState(false)
  const [updating, setUpdating] = useState(false)
  // Recuerda si la ultima alta/baja en esta sesion volvio con
  // costoFinalActualizado:false (ver requiereAplicarAlTotal mas abajo).
  const [montoNoSincronizado, setMontoNoSincronizado] = useState(false)
  const [nuevoServicio, setNuevoServicio] = useState({
    servicioId: "",
    cantidad: 1,
    nombre: "",
    precioUnitario: 0,
    guardarEnCatalogo: false,
  })
  // Raw editing strings so the inputs can show empty while a valid numeric stays in nuevoServicio.
  const [cantidadDraft, setCantidadDraft] = useState("1")
  const [precioDraft, setPrecioDraft] = useState("")

  // Lazy load catalogo only when add form is opened
  useEffect(() => {
    if (showAddServicio && !catalogoLoaded) {
      fetch("/api/servicios", { cache: "no-store" })
        .then((res) => res.json())
        .then((data) => {
          setCatalogo(data.servicios ?? [])
          setCatalogoLoaded(true)
        })
        .catch((err) => console.error("Error fetching servicios:", err))
    }
  }, [showAddServicio, catalogoLoaded])

  const handleAddServicio = async () => {
    if (tipoServicio === "catalogo") {
      if (!nuevoServicio.servicioId || nuevoServicio.cantidad < 1) {
        await alert({
          title: "Datos incompletos",
          description: "Seleccioná un servicio y cantidad",
          variant: "warning",
        })
        return
      }
    } else {
      if (!nuevoServicio.nombre.trim() || nuevoServicio.cantidad < 1 || nuevoServicio.precioUnitario < 0) {
        await alert({
          title: "Datos incompletos",
          description: "Completá nombre, cantidad y precio",
          variant: "warning",
        })
        return
      }
    }

    setUpdating(true)
    try {
      const payload = tipoServicio === "catalogo"
        ? {
            tipo: "catalogo",
            servicioId: nuevoServicio.servicioId,
            cantidad: nuevoServicio.cantidad,
            // El precio del catalogo es un default: lo que haya quedado en el
            // input (editado o no) es lo que se manda.
            precioUnitario: nuevoServicio.precioUnitario,
          }
        : {
            tipo: "manual",
            nombre: nuevoServicio.nombre.trim(),
            cantidad: nuevoServicio.cantidad,
            precioUnitario: nuevoServicio.precioUnitario,
            guardarEnCatalogo: nuevoServicio.guardarEnCatalogo,
          }

      const res = await fetch(`/api/ordenes/${ordenId}/servicios`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        const data = await res.json()
        // Si el backend no pudo sincronizar costo_final (cobros o edicion a
        // mano de por medio), lo recordamos para esta sesion.
        setMontoNoSincronizado(data.montoActualizado === false)
        // Esperamos el refetch del padre antes de cerrar el formulario: si no,
        // el panel muestra brevemente "no hay servicios agregados" sin ningun
        // indicador de carga, lo que invita a reintentar y duplicar el alta.
        await onServiciosChanged?.()
        setNuevoServicio({ servicioId: "", cantidad: 1, nombre: "", precioUnitario: 0, guardarEnCatalogo: false })
        setCantidadDraft("1")
        setPrecioDraft("")
        setShowAddServicio(false)
        setCatalogoLoaded(false) // Por si se guardó un servicio nuevo en el catalogo
      } else {
        const error = await res.json()
        await alert({
          title: "Error",
          description: error.error || "Error al agregar servicio",
          variant: "error",
        })
      }
    } catch (error) {
      console.error("Error adding servicio:", error)
    } finally {
      setUpdating(false)
    }
  }

  const handleRemoveServicio = async (servicioOrdenId: string) => {
    const confirmed = await confirm({
      title: "Eliminar servicio",
      description: "¿Estás seguro de eliminar este servicio de la orden?",
      confirmText: "Eliminar",
      variant: "danger",
    })
    if (!confirmed) return

    setUpdating(true)
    try {
      const res = await fetch(
        `/api/ordenes/${ordenId}/servicios?servicioOrdenId=${servicioOrdenId}`,
        { method: "DELETE" }
      )
      if (res.ok) {
        const data = await res.json()
        // Idem alta: si el backend no pudo sincronizar costo_final, lo
        // recordamos para esta sesion (ver requiereAplicarAlTotal).
        setMontoNoSincronizado(data.montoActualizado === false)
        // Mismo tratamiento que al agregar: esperar el refetch antes de
        // reactivar los controles evita la ventana de estado enganoso.
        await onServiciosChanged?.()
      } else {
        const error = await res.json()
        await alert({ title: "Error", description: error.error || "Error al eliminar servicio", variant: "error" })
      }
    } catch (error) {
      console.error("Error removing servicio:", error)
      await alert({ title: "Error", description: "Error al eliminar servicio", variant: "error" })
    } finally {
      setUpdating(false)
    }
  }

  const subtotalServicios = servicios?.reduce(
    (sum, s) => sum + s.cantidad * s.precioUnitario,
    0
  ) || 0
  const sumaLineas = sumaLineasOrden({ servicios, repuestos })

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Servicios realizados</CardTitle>
          {!showAddServicio && (
            <Button size="sm" variant="outline" onClick={() => setShowAddServicio(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Agregar
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <AplicarAlTotalAviso
          ordenId={ordenId}
          estado={estado}
          presupuesto={presupuesto}
          costoFinal={costoFinal}
          totalCobrado={totalCobrado}
          sumaLineas={sumaLineas}
          cantidadLineas={(servicios?.length ?? 0) + repuestos.length}
          forzar={montoNoSincronizado}
          onAplicado={async () => {
            setMontoNoSincronizado(false)
            await onServiciosChanged?.()
          }}
        />

        {showAddServicio && (
          <div className="mb-4 p-3 border rounded-lg space-y-3 bg-muted/30">
            <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
              <button
                type="button"
                onClick={() => setTipoServicio("catalogo")}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  tipoServicio === "catalogo"
                    ? "bg-background shadow-sm font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Del catálogo
              </button>
              <button
                type="button"
                onClick={() => setTipoServicio("manual")}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  tipoServicio === "manual"
                    ? "bg-background shadow-sm font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Manual
              </button>
            </div>

            {tipoServicio === "catalogo" ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-3">
                  <Label className="text-xs">Servicio</Label>
                  <Select
                    value={nuevoServicio.servicioId || "none"}
                    onValueChange={(value) => {
                      if (value === "none") {
                        setNuevoServicio({ ...nuevoServicio, servicioId: "" })
                        return
                      }
                      const servicio = catalogo.find((s) => s.id === value)
                      setNuevoServicio({
                        ...nuevoServicio,
                        servicioId: value,
                        precioUnitario: servicio ? Number(servicio.precio) : nuevoServicio.precioUnitario,
                      })
                      if (servicio) setPrecioDraft(String(servicio.precio))
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Seleccionar...</SelectItem>
                      {catalogo.map((servicio) => (
                        <SelectItem key={servicio.id} value={servicio.id}>
                          {servicio.nombre}
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
                      setNuevoServicio({ ...nuevoServicio, cantidad: parseInt(e.target.value, 10) || 1 })
                    }}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-xs">Precio</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={precioDraft}
                    onChange={(e) => {
                      setPrecioDraft(e.target.value)
                      setNuevoServicio({ ...nuevoServicio, precioUnitario: parseFloat(e.target.value) || 0 })
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-3">
                  <Label className="text-xs">Nombre del servicio</Label>
                  <Input
                    placeholder="Ej: Diagnóstico a domicilio"
                    value={nuevoServicio.nombre}
                    onChange={(e) => setNuevoServicio({ ...nuevoServicio, nombre: e.target.value })}
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
                      setNuevoServicio({ ...nuevoServicio, cantidad: parseInt(e.target.value, 10) || 1 })
                    }}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-xs">Precio</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={precioDraft}
                    onChange={(e) => {
                      setPrecioDraft(e.target.value)
                      setNuevoServicio({ ...nuevoServicio, precioUnitario: parseFloat(e.target.value) || 0 })
                    }}
                  />
                </div>
                <label className="sm:col-span-3 flex items-center gap-2 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={nuevoServicio.guardarEnCatalogo}
                    onChange={(e) => setNuevoServicio({ ...nuevoServicio, guardarEnCatalogo: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  <span className="text-xs text-muted-foreground">Guardar en servicios</span>
                </label>
              </div>
            )}

            <div className="flex gap-2">
              <Button size="sm" onClick={handleAddServicio} disabled={updating}>
                Agregar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowAddServicio(false)
                  setTipoServicio("catalogo")
                  setNuevoServicio({ servicioId: "", cantidad: 1, nombre: "", precioUnitario: 0, guardarEnCatalogo: false })
                  setCantidadDraft("1")
                  setPrecioDraft("")
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {servicios && servicios.length > 0 ? (
          <div className="space-y-2">
            {servicios.map((servicio) => (
              <div
                key={servicio.id}
                className="flex items-center justify-between p-3 border rounded-lg"
              >
                <div>
                  <div className="font-medium flex items-center gap-2">
                    {servicio.nombre}
                    {!servicio.servicioId && (
                      <span className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                        Manual
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {servicio.cantidad} × {formatPrice(servicio.precioUnitario)}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold">
                    {formatPrice(servicio.cantidad * servicio.precioUnitario)}
                  </span>
                  <IconButton label="Quitar servicio" variant="ghost" className="h-8 w-8" disabled={updating} onClick={() => handleRemoveServicio(servicio.id)}>
                    <Trash2 className="h-4 w-4 text-destructive-text" />
                  </IconButton>
                </div>
              </div>
            ))}
            <div className="flex justify-between pt-3 border-t font-semibold">
              <span>Subtotal servicios</span>
              <span>{formatPrice(subtotalServicios)}</span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            No hay servicios agregados
          </p>
        )}
      </CardContent>
    </Card>
  )
}
