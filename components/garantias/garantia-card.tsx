"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import {
  Shield,
  ShieldCheck,
  ShieldX,
  ShieldAlert,
  Plus,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  FileText,
} from "lucide-react"
import { ReclamoForm } from "./reclamo-form"
import { useModal } from "@/contexts/modal-context"
import { useCurrency } from "@/contexts/currency-context"

interface Reclamo {
  id: string
  descripcion: string
  estado: string
  ordenReparacionId: string | null
  resolucion: string | null
  fechaReclamo: string
  fechaResolucion: string | null
}

interface Garantia {
  id: string
  ordenId: string
  diasValidez: number
  fechaInicio: string
  fechaVencimiento: string
  estado: string
  notas: string | null
  reclamos: Reclamo[]
}

interface GarantiaCardProps {
  ordenId: string
  ordenEstado: string
}

const estadoGarantiaConfig: Record<string, { label: string; icon: typeof Shield; color: string }> = {
  ACTIVA: { label: "Activa", icon: ShieldCheck, color: "bg-green-100 text-green-800" },
  VENCIDA: { label: "Vencida", icon: ShieldX, color: "bg-gray-100 text-gray-800" },
  RECLAMADA: { label: "En Reclamo", icon: ShieldAlert, color: "bg-yellow-100 text-yellow-800" },
}

const estadoReclamoConfig: Record<string, { label: string; color: string }> = {
  PENDIENTE: { label: "Pendiente", color: "bg-yellow-100 text-yellow-800" },
  EN_REVISION: { label: "En Revisión", color: "bg-blue-100 text-blue-800" },
  ACEPTADO: { label: "Aceptado", color: "bg-green-100 text-green-800" },
  RECHAZADO: { label: "Rechazado", color: "bg-red-100 text-red-800" },
  RESUELTO: { label: "Resuelto", color: "bg-gray-100 text-gray-800" },
}

export function GarantiaCard({ ordenId, ordenEstado }: GarantiaCardProps) {
  const { confirm } = useModal()
  const { formatDate } = useCurrency()
  const [garantia, setGarantia] = useState<Garantia | null>(null)
  const [loading, setLoading] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [showReclamoForm, setShowReclamoForm] = useState(false)
  const [creating, setCreating] = useState(false)
  const [diasValidez, setDiasValidez] = useState("30")
  const [notas, setNotas] = useState("")
  const [updatingReclamo, setUpdatingReclamo] = useState<string | null>(null)

  const fetchGarantia = async () => {
    try {
      const res = await fetch(`/api/garantias?ordenId=${ordenId}`)
      const data = await res.json()
      // Buscar la garantía de esta orden
      const garantiaOrden = data.find((g: Garantia) => g.ordenId === ordenId)
      setGarantia(garantiaOrden || null)
    } catch (error) {
      console.error("Error fetching garantia:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (ordenEstado === "ENTREGADO") {
      fetchGarantia()
    } else {
      setLoading(false)
    }
  }, [ordenId, ordenEstado])

  const handleCreateGarantia = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreating(true)
    try {
      const res = await fetch("/api/garantias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ordenId,
          diasValidez: Math.max(1, parseInt(diasValidez, 10) || 30),
          notas: notas || undefined,
        }),
      })

      if (!res.ok) {
        const error = await res.json()
        alert(error.error || "Error al crear garantía")
        return
      }

      setShowCreateForm(false)
      fetchGarantia()
    } catch (error) {
      console.error("Error:", error)
      alert("Error al crear garantía")
    } finally {
      setCreating(false)
    }
  }

  const handleUpdateReclamo = async (
    reclamoId: string,
    nuevoEstado: string,
    crearOrden?: boolean,
    resolucion?: string
  ) => {
    if (!garantia) return

    setUpdatingReclamo(reclamoId)
    try {
      const res = await fetch(
        `/api/garantias/${garantia.id}/reclamos?reclamoId=${reclamoId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            estado: nuevoEstado,
            crearOrden,
            resolucion,
          }),
        }
      )

      if (!res.ok) {
        const error = await res.json()
        alert(error.error || "Error al actualizar reclamo")
        return
      }

      fetchGarantia()
    } catch (error) {
      console.error("Error:", error)
    } finally {
      setUpdatingReclamo(null)
    }
  }

  // Solo mostrar si la orden está ENTREGADO
  if (ordenEstado !== "ENTREGADO") {
    return null
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-4 text-center text-muted-foreground">
          Cargando garantía...
        </CardContent>
      </Card>
    )
  }

  // Si no hay garantía, mostrar opción de crear
  if (!garantia) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Garantía
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!showCreateForm ? (
            <div className="text-center py-4">
              <p className="text-muted-foreground mb-4">
                Esta orden no tiene garantía registrada
              </p>
              <Button onClick={() => setShowCreateForm(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Crear Garantía
              </Button>
            </div>
          ) : (
            <form onSubmit={handleCreateGarantia} className="space-y-4">
              <div>
                <Label htmlFor="diasValidez">Días de validez</Label>
                <Input
                  id="diasValidez"
                  type="number"
                  min="1"
                  value={diasValidez}
                  onChange={(e) => setDiasValidez(e.target.value)}
                  disabled={creating}
                />
              </div>
              <div>
                <Label htmlFor="notas">Notas</Label>
                <Textarea
                  id="notas"
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                  placeholder="Condiciones de la garantía..."
                  rows={2}
                  disabled={creating}
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowCreateForm(false)}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={creating}>
                  {creating ? "Creando..." : "Crear Garantía"}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    )
  }

  // Mostrar garantía existente
  const config = estadoGarantiaConfig[garantia.estado] || estadoGarantiaConfig.ACTIVA
  const Icon = config.icon
  const diasRestantes = Math.ceil(
    (new Date(garantia.fechaVencimiento).getTime() - new Date().getTime()) /
      (1000 * 60 * 60 * 24)
  )

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Garantía
          </CardTitle>
          <Badge className={config.color}>
            <Icon className="mr-1 h-3 w-3" />
            {config.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Info de la garantía */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3 bg-muted rounded-lg">
          <div>
            <div className="text-xs text-muted-foreground">Inicio</div>
            <div className="font-medium">{formatDate(garantia.fechaInicio)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Vencimiento</div>
            <div className="font-medium">{formatDate(garantia.fechaVencimiento)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Duración</div>
            <div className="font-medium">{garantia.diasValidez} días</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Días restantes</div>
            <div
              className={`font-medium ${
                diasRestantes <= 7
                  ? "text-red-600"
                  : diasRestantes <= 14
                  ? "text-yellow-600"
                  : "text-green-600"
              }`}
            >
              {diasRestantes > 0 ? `${diasRestantes} días` : "Vencida"}
            </div>
          </div>
        </div>

        {garantia.notas && (
          <div className="text-sm">
            <span className="font-medium">Notas:</span>
            <p className="text-muted-foreground">{garantia.notas}</p>
          </div>
        )}

        {/* Botón para nuevo reclamo */}
        {garantia.estado === "ACTIVA" && !showReclamoForm && (
          <Button
            variant="outline"
            className="w-full border-yellow-300 text-yellow-700 hover:bg-yellow-50"
            onClick={() => setShowReclamoForm(true)}
          >
            <AlertTriangle className="mr-2 h-4 w-4" />
            Registrar Reclamo
          </Button>
        )}

        {/* Formulario de reclamo */}
        {showReclamoForm && (
          <ReclamoForm
            garantiaId={garantia.id}
            onClose={() => setShowReclamoForm(false)}
            onSuccess={() => {
              setShowReclamoForm(false)
              fetchGarantia()
            }}
          />
        )}

        {/* Lista de reclamos */}
        {garantia.reclamos && garantia.reclamos.length > 0 && (
          <div className="space-y-3">
            <h4 className="font-medium flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Historial de Reclamos ({garantia.reclamos.length})
            </h4>
            {garantia.reclamos.map((reclamo) => {
              const reclamoConfig =
                estadoReclamoConfig[reclamo.estado] || estadoReclamoConfig.PENDIENTE
              const isUpdating = updatingReclamo === reclamo.id

              return (
                <div
                  key={reclamo.id}
                  className="p-3 border rounded-lg space-y-2"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <Badge className={reclamoConfig.color}>
                        {reclamoConfig.label}
                      </Badge>
                      <span className="text-xs text-muted-foreground ml-2">
                        {formatDate(reclamo.fechaReclamo)}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm">{reclamo.descripcion}</p>

                  {reclamo.resolucion && (
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium">Resolución:</span> {reclamo.resolucion}
                    </p>
                  )}

                  {reclamo.ordenReparacionId && (
                    <p className="text-sm text-blue-600">
                      Nueva orden de reparación creada
                    </p>
                  )}

                  {/* Acciones según estado */}
                  {reclamo.estado === "PENDIENTE" && (
                    <div className="flex gap-2 pt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleUpdateReclamo(reclamo.id, "EN_REVISION")}
                        disabled={isUpdating}
                      >
                        <Clock className="mr-1 h-3 w-3" />
                        Revisar
                      </Button>
                    </div>
                  )}

                  {reclamo.estado === "EN_REVISION" && (
                    <div className="flex gap-2 pt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-green-600"
                        onClick={async () => {
                          const crearOrden = await confirm({
                            title: "Crear Orden",
                            description: "¿Desea crear una nueva orden de reparación?",
                            confirmText: "Sí, crear",
                            cancelText: "No",
                            variant: "info",
                          })
                          handleUpdateReclamo(reclamo.id, "ACEPTADO", crearOrden)
                        }}
                        disabled={isUpdating}
                      >
                        <CheckCircle className="mr-1 h-3 w-3" />
                        Aceptar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600"
                        onClick={() => {
                          const resolucion = prompt("Motivo del rechazo:")
                          if (resolucion) {
                            handleUpdateReclamo(reclamo.id, "RECHAZADO", false, resolucion)
                          }
                        }}
                        disabled={isUpdating}
                      >
                        <XCircle className="mr-1 h-3 w-3" />
                        Rechazar
                      </Button>
                    </div>
                  )}

                  {reclamo.estado === "ACEPTADO" && (
                    <div className="flex gap-2 pt-2">
                      <Button
                        size="sm"
                        onClick={() => {
                          const resolucion = prompt("Descripción de la resolución:")
                          if (resolucion) {
                            handleUpdateReclamo(reclamo.id, "RESUELTO", false, resolucion)
                          }
                        }}
                        disabled={isUpdating}
                      >
                        <CheckCircle className="mr-1 h-3 w-3" />
                        Marcar Resuelto
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
