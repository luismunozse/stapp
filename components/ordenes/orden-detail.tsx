"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import {
  ArrowLeft,
  User,
  Phone,
  Calendar,
  DollarSign,
  Package,
  Wrench,
  Plus,
  Trash2,
} from "lucide-react"
import Link from "next/link"
import { formatDate, formatCurrency, calculateIVA, calculateTotal } from "@/lib/utils"
import { DatePicker } from "@/components/ui/date-picker"
import type { OrdenServicio, EstadoOrden, User as UserType } from "@/types"

const estadoColors: Record<EstadoOrden, string> = {
  PENDIENTE: "bg-red-100 text-red-800",
  EN_REPARACION: "bg-yellow-100 text-yellow-800",
  ESPERANDO_REPUESTO: "bg-orange-100 text-orange-800",
  COMPLETADO: "bg-blue-100 text-blue-800",
  ENTREGADO: "bg-green-100 text-green-800",
  CANCELADO: "bg-gray-100 text-gray-800",
}

const estadoLabels: Record<EstadoOrden, string> = {
  PENDIENTE: "Pendiente",
  EN_REPARACION: "En Reparación",
  ESPERANDO_REPUESTO: "Esperando Repuesto",
  COMPLETADO: "Completado",
  ENTREGADO: "Entregado",
  CANCELADO: "Cancelado",
}

interface OrdenDetailProps {
  ordenId: string
}

export function OrdenDetail({ ordenId }: OrdenDetailProps) {
  const router = useRouter()
  const [orden, setOrden] = useState<any>(null)
  const [tecnicos, setTecnicos] = useState<UserType[]>([])
  const [inventario, setInventario] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [showAddRepuesto, setShowAddRepuesto] = useState(false)
  const [nuevoRepuesto, setNuevoRepuesto] = useState({
    inventarioId: "",
    cantidad: 1,
  })

  useEffect(() => {
    fetchOrden()
    fetchTecnicos()
    fetchInventario()
  }, [ordenId])

  const fetchOrden = async () => {
    try {
      const res = await fetch(`/api/ordenes/${ordenId}`)
      if (!res.ok) {
        router.push("/ordenes")
        return
      }
      const data = await res.json()
      setOrden(data)
    } catch (error) {
      console.error("Error fetching orden:", error)
    } finally {
      setLoading(false)
    }
  }

  const fetchTecnicos = async () => {
    try {
      const res = await fetch("/api/tecnicos")
      const data = await res.json()
      setTecnicos(data)
    } catch (error) {
      console.error("Error fetching tecnicos:", error)
    }
  }

  const fetchInventario = async () => {
    try {
      const res = await fetch("/api/inventario")
      const data = await res.json()
      setInventario(data)
    } catch (error) {
      console.error("Error fetching inventario:", error)
    }
  }

  const handleUpdateEstado = async (nuevoEstado: EstadoOrden) => {
    setUpdating(true)
    try {
      const res = await fetch(`/api/ordenes/${ordenId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: nuevoEstado }),
      })

      if (res.ok) {
        fetchOrden()
      }
    } catch (error) {
      console.error("Error updating estado:", error)
    } finally {
      setUpdating(false)
    }
  }

  const handleAsignarTecnico = async (tecnicoId: string | null) => {
    setUpdating(true)
    try {
      const res = await fetch(`/api/ordenes/${ordenId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tecnicoId }),
      })

      if (res.ok) {
        fetchOrden()
      }
    } catch (error) {
      console.error("Error assigning tecnico:", error)
    } finally {
      setUpdating(false)
    }
  }

  const handleUpdatePresupuesto = async () => {
    const input = document.getElementById("presupuesto-input") as HTMLInputElement
    const presupuesto = parseFloat(input.value) || null

    setUpdating(true)
    try {
      const res = await fetch(`/api/ordenes/${ordenId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presupuesto }),
      })

      if (res.ok) {
        fetchOrden()
      }
    } catch (error) {
      console.error("Error updating presupuesto:", error)
    } finally {
      setUpdating(false)
    }
  }

  const handleUpdateCostoFinal = async () => {
    const input = document.getElementById("costo-final-input") as HTMLInputElement
    const costoFinal = parseFloat(input.value) || null

    setUpdating(true)
    try {
      const res = await fetch(`/api/ordenes/${ordenId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ costoFinal }),
      })

      if (res.ok) {
        fetchOrden()
      }
    } catch (error) {
      console.error("Error updating costo final:", error)
    } finally {
      setUpdating(false)
    }
  }

  const handleAddRepuesto = async () => {
    if (!nuevoRepuesto.inventarioId || nuevoRepuesto.cantidad < 1) {
      alert("Selecciona un item y cantidad")
      return
    }

    setUpdating(true)
    try {
      const res = await fetch(`/api/ordenes/${ordenId}/repuestos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nuevoRepuesto),
      })

      if (res.ok) {
        setNuevoRepuesto({ inventarioId: "", cantidad: 1 })
        setShowAddRepuesto(false)
        fetchOrden()
      } else {
        const error = await res.json()
        alert(error.error || "Error al agregar repuesto")
      }
    } catch (error) {
      console.error("Error adding repuesto:", error)
    } finally {
      setUpdating(false)
    }
  }

  const handleRemoveRepuesto = async (repuestoId: string) => {
    if (!confirm("¿Eliminar este repuesto?")) return

    setUpdating(true)
    try {
      const res = await fetch(
        `/api/ordenes/${ordenId}/repuestos?repuestoId=${repuestoId}`,
        { method: "DELETE" }
      )

      if (res.ok) {
        fetchOrden()
      }
    } catch (error) {
      console.error("Error removing repuesto:", error)
    } finally {
      setUpdating(false)
    }
  }

  const handleGenerarFactura = async () => {
    if (!confirm("¿Generar factura para esta orden?")) return

    setUpdating(true)
    try {
      const res = await fetch("/api/facturacion/generar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ordenId: ordenId }),
      })

      if (res.ok) {
        alert("Factura generada correctamente")
        router.push("/facturacion")
      } else {
        const error = await res.json()
        alert(error.error || "Error al generar factura")
      }
    } catch (error) {
      console.error("Error generating factura:", error)
      alert("Error al generar factura")
    } finally {
      setUpdating(false)
    }
  }

  if (loading) {
    return <div className="text-center py-8">Cargando...</div>
  }

  if (!orden) {
    return <div>Orden no encontrada</div>
  }

  const subtotalRepuestos =
    orden.repuestos?.reduce(
      (sum: number, r: any) => sum + r.cantidad * r.precioUnitario,
      0
    ) || 0

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/ordenes">
          <Button variant="outline" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold">Orden #{orden.numeroOrden}</h1>
          <Badge className={estadoColors[orden.estado]}>
            {estadoLabels[orden.estado]}
          </Badge>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Información del Cliente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{orden.cliente.nombre}</span>
            </div>
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span>{orden.cliente.telefono}</span>
            </div>
            {orden.cliente.email && (
              <div className="text-sm text-muted-foreground">
                {orden.cliente.email}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Información del Dispositivo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <span className="font-medium">Dispositivo:</span> {orden.dispositivo}
            </div>
            <div>
              <span className="font-medium">Tipo:</span> {orden.tipoDispositivo}
            </div>
            <div>
              <span className="font-medium">Problema:</span>
              <p className="text-sm text-muted-foreground mt-1">
                {orden.problemaReportado}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Asignación</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Técnico</Label>
              <Select
                value={orden.tecnicoId || ""}
                onChange={(e) =>
                  handleAsignarTecnico(e.target.value || null)
                }
                disabled={updating}
              >
                <option value="">Sin asignar</option>
                {tecnicos.map((tecnico) => (
                  <option key={tecnico.id} value={tecnico.id}>
                    {tecnico.nombre}
                  </option>
                ))}
              </Select>
            </div>
            {orden.tecnico && (
              <div className="flex items-center gap-2 text-sm">
                <Wrench className="h-4 w-4 text-muted-foreground" />
                {orden.tecnico.nombre}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Estado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {(Object.keys(estadoLabels) as EstadoOrden[]).map((estado) => (
                <Button
                  key={estado}
                  variant={orden.estado === estado ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleUpdateEstado(estado)}
                  disabled={updating}
                >
                  {estadoLabels[estado]}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span>Ingreso: {formatDate(orden.fechaIngreso)}</span>
            </div>
            {orden.fechaPrometida && (
              <div className="text-sm">
                Prometida: {formatDate(orden.fechaPrometida)}
              </div>
            )}
            {orden.fechaCompletado && (
              <div className="text-sm">
                Completado: {formatDate(orden.fechaCompletado)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Presupuesto y Costos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Presupuesto</Label>
              <div className="flex gap-2">
                <Input
                  id="presupuesto-input"
                  type="number"
                  step="0.01"
                  defaultValue={orden.presupuesto || ""}
                  placeholder="0.00"
                />
                <Button onClick={handleUpdatePresupuesto} disabled={updating}>
                  Actualizar
                </Button>
              </div>
            </div>
            <div>
              <Label>Costo Final</Label>
              <div className="flex gap-2">
                <Input
                  id="costo-final-input"
                  type="number"
                  step="0.01"
                  defaultValue={orden.costoFinal || ""}
                  placeholder="0.00"
                />
                <Button onClick={handleUpdateCostoFinal} disabled={updating}>
                  Actualizar
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Repuestos Utilizados</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {orden.repuestos && orden.repuestos.length > 0 ? (
              <div className="space-y-2">
                {orden.repuestos.map((repuesto: any) => (
                  <div
                    key={repuesto.id}
                    className="flex items-center justify-between p-2 border rounded"
                  >
                    <div>
                      <div className="font-medium">
                        {repuesto.inventario.nombre}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {repuesto.cantidad} x {formatCurrency(repuesto.precioUnitario)} ={" "}
                        {formatCurrency(repuesto.cantidad * repuesto.precioUnitario)}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveRepuesto(repuesto.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
                <div className="pt-2 border-t">
                  <div className="flex justify-between font-medium">
                    <span>Subtotal:</span>
                    <span>{formatCurrency(subtotalRepuestos)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No hay repuestos agregados
              </p>
            )}
            {!showAddRepuesto ? (
              <Button
                onClick={() => setShowAddRepuesto(true)}
                variant="outline"
                className="w-full"
              >
                <Plus className="mr-2 h-4 w-4" />
                Agregar Repuesto
              </Button>
            ) : (
              <div className="space-y-2 p-3 border rounded">
                <div>
                  <Label>Item</Label>
                  <Select
                    value={nuevoRepuesto.inventarioId}
                    onChange={(e) =>
                      setNuevoRepuesto({
                        ...nuevoRepuesto,
                        inventarioId: e.target.value,
                      })
                    }
                  >
                    <option value="">Seleccionar...</option>
                    {inventario.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.nombre} (Stock: {item.stock})
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label>Cantidad</Label>
                  <Input
                    type="number"
                    min="1"
                    value={nuevoRepuesto.cantidad}
                    onChange={(e) =>
                      setNuevoRepuesto({
                        ...nuevoRepuesto,
                        cantidad: parseInt(e.target.value) || 1,
                      })
                    }
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={handleAddRepuesto}
                    disabled={updating}
                    className="flex-1"
                  >
                    Agregar
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowAddRepuesto(false)
                      setNuevoRepuesto({ inventarioId: "", cantidad: 1 })
                    }}
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {orden.observaciones && (
        <Card>
          <CardHeader>
            <CardTitle>Observaciones</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap">{orden.observaciones}</p>
          </CardContent>
        </Card>
      )}

      {orden.estado === "COMPLETADO" && (
        <Card>
          <CardHeader>
            <CardTitle>Facturación</CardTitle>
          </CardHeader>
          <CardContent>
            <Button
              onClick={handleGenerarFactura}
              disabled={updating}
              className="w-full"
            >
              <FileText className="mr-2 h-4 w-4" />
              Generar Factura
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

