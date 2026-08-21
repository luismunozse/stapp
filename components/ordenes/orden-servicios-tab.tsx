"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Trash2, AlertTriangle } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { campoSincronizadoPara } from "@/lib/servicios/sincronizar-costo-final"
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
  /** Puede devolver una promesa: el llamador espera a que el refetch del
   *  padre termine antes de reactivar los controles, para evitar la ventana
   *  en la que el panel muestra "sin servicios" mientras el padre aun no
   *  refrescó (lo que invitaba a reintentar y crear un servicio duplicado). */
  onServiciosChanged: () => void | Promise<void>
}

export function OrdenServiciosTab({ ordenId, servicios, costoFinal, presupuesto, estado, totalCobrado, onServiciosChanged }: OrdenServiciosTabProps) {
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
          description: "Selecciona un servicio y cantidad",
          variant: "warning",
        })
        return
      }
    } else {
      if (!nuevoServicio.nombre.trim() || nuevoServicio.cantidad < 1 || nuevoServicio.precioUnitario < 0) {
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

  // PATCH a la ruta de servicios y NO PUT a /api/ordenes/[id]: ese PUT
  // auto-transiciona la orden a PRESUPUESTADO al escribir presupuesto y le
  // notifica al cliente. Aplicar un monto calculado no es presupuestar.
  const handleAplicarAlTotal = async () => {
    const confirmed = await confirm({
      title: "Aplicar al total",
      description:
        totalCobrado > 0
          ? `El ${etiquetaMonto} va a pasar a ${formatPrice(subtotalServicios)}. Esta orden ya tiene ${formatPrice(totalCobrado)} cobrados.`
          : `El ${etiquetaMonto} va a pasar a ${formatPrice(subtotalServicios)}.`,
      confirmText: "Aplicar",
      variant: totalCobrado > 0 ? "warning" : "info",
    })
    if (!confirmed) return

    setUpdating(true)
    try {
      const res = await fetch(`/api/ordenes/${ordenId}/servicios`, { method: "PATCH" })
      if (res.ok) {
        setMontoNoSincronizado(false)
        await onServiciosChanged?.()
      } else {
        const error = await res.json()
        await alert({ title: "Error", description: error.error || `Error al actualizar el ${etiquetaMonto}`, variant: "error" })
      }
    } catch (error) {
      console.error("Error aplicando al total:", error)
      await alert({ title: "Error", description: `Error al actualizar el ${etiquetaMonto}`, variant: "error" })
    } finally {
      setUpdating(false)
    }
  }

  const subtotalServicios = servicios?.reduce(
    (sum, s) => sum + s.cantidad * s.precioUnitario,
    0
  ) || 0

  // costo_final solo sigue a las lineas de servicio (ver sincronizar-costo-final.ts).
  // Si difiere es porque la orden tiene cobros o alguien lo edito a mano: en
  // ambos casos el backend deja de actualizarlo solo y hace falta este botón.
  //
  // El guard "servicios.length > 0" evita un falso positivo en ordenes viejas
  // (previas a esta funcionalidad) que ya tenian costo_final cargado a mano y
  // cero lineas de servicio: esas nunca estuvieron desincronizadas por esta
  // feature, asi que no hay nada que ofrecer reconciliar sin que el usuario
  // haya tocado esta tab. Pero ese mismo guard esconde el aviso justo cuando
  // hace falta: si se borra la ultima linea de una orden con cobros (o con el
  // costo editado a mano, o ya en REPARADO o un estado de entrega — ver
  // ESTADOS_COSTO_FINAL_BLOQUEADO), el backend no puede sincronizar
  // costo_final, la orden queda en 0 lineas con un costo desactualizado, y sin
  // costoFinalNoSincronizado el aviso nunca aparece.
  //
  // Por eso se combina con OR: costoFinalNoSincronizado solo se enciende
  // cuando una mutacion de ESTA sesion informo costoFinalActualizado:false,
  // asi que una orden vieja jamas lo activa. La comparacion numerica sigue
  // siendo la que decide si hace falta el aviso (y la unica que sobrevive un
  // reload de pagina, donde el estado de sesion se pierde).
  // Cual de los dos montos esta vivo lo decide el estado (ver
  // campoSincronizadoPara). En estados terminales no hay ninguno: la orden ya
  // se cerro y no se ofrece sincronizar nada.
  const campoVivo = campoSincronizadoPara(estado)
  const montoVivo = campoVivo === "presupuesto" ? presupuesto : costoFinal
  const montoVivoNum = Number(montoVivo ?? 0)
  const etiquetaMonto = campoVivo === "presupuesto" ? "presupuesto" : "costo final"

  const requiereAplicarAlTotal =
    campoVivo !== null &&
    ((servicios?.length ?? 0) > 0 || montoNoSincronizado) &&
    Math.round(subtotalServicios * 100) !== Math.round(montoVivoNum * 100)

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Servicios Realizados</CardTitle>
          {!showAddServicio && (
            <Button size="sm" variant="outline" onClick={() => setShowAddServicio(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Agregar
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {requiereAplicarAlTotal && (
          <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg p-3 mb-4">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <div className="font-medium mb-1">El {etiquetaMonto} no coincide con el subtotal de servicios</div>
              <div>
                Subtotal Servicios: {formatPrice(subtotalServicios)} — {campoVivo === "presupuesto" ? "Presupuesto" : "Costo final"} actual: {formatPrice(montoVivoNum)}
                {totalCobrado > 0 && <> — Cobrado: {formatPrice(totalCobrado)}</>}
              </div>
            </div>
            <Button size="sm" variant="outline" className="shrink-0 bg-background" disabled={updating} onClick={handleAplicarAlTotal}>
              Aplicar al total
            </Button>
          </div>
        )}

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
                  <span className="text-xs text-muted-foreground">Guardar en Servicios</span>
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
                  <Button variant="ghost" size="icon" className="h-8 w-8" disabled={updating} onClick={() => handleRemoveServicio(servicio.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
            <div className="flex justify-between pt-3 border-t font-semibold">
              <span>Subtotal Servicios</span>
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
