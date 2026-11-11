"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import Link from "next/link"
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
  Pencil,
} from "lucide-react"
import { ReclamoForm } from "./reclamo-form"
import { useModal } from "@/contexts/modal-context"
import { useCurrency } from "@/contexts/currency-context"
import type { BadgeProps } from "@/components/ui/badge"

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
  garantiaDiasDefault?: number
  /** Crear, editar y decidir reclamos es solo de ADMIN (la API responde 403 al
   *  resto). Registrar un reclamo lo puede hacer cualquier rol. */
  isAdmin?: boolean
}

type BadgeVariant = NonNullable<BadgeProps["variant"]>

const estadoGarantiaConfig: Record<string, { label: string; icon: typeof Shield; variant: BadgeVariant }> = {
  ACTIVA: { label: "Activa", icon: ShieldCheck, variant: "successSoft" },
  VENCIDA: { label: "Vencida", icon: ShieldX, variant: "secondary" },
  RECLAMADA: { label: "En reclamo", icon: ShieldAlert, variant: "warningSoft" },
}

const estadoReclamoConfig: Record<string, { label: string; variant: BadgeVariant }> = {
  PENDIENTE: { label: "Pendiente", variant: "warningSoft" },
  EN_REVISION: { label: "En revisión", variant: "infoSoft" },
  ACEPTADO: { label: "Aceptado", variant: "successSoft" },
  RECHAZADO: { label: "Rechazado", variant: "destructiveSoft" },
  RESUELTO: { label: "Resuelto", variant: "secondary" },
}

/** Rechazar o resolver un reclamo pide un texto: motivo o resolución. */
type MotivoPendiente = { reclamoId: string; estado: "RECHAZADO" | "RESUELTO" }

const motivoDialogCopy: Record<
  MotivoPendiente["estado"],
  { title: string; description: string; label: string; confirm: string }
> = {
  RECHAZADO: {
    title: "Rechazar reclamo",
    description: "El motivo queda registrado en el historial del reclamo.",
    label: "Motivo del rechazo",
    confirm: "Rechazar reclamo",
  },
  RESUELTO: {
    title: "Marcar reclamo como resuelto",
    description: "Contá cómo se resolvió. Queda registrado en el historial del reclamo.",
    label: "Descripción de la resolución",
    confirm: "Marcar resuelto",
  },
}

export function GarantiaCard({
  ordenId,
  ordenEstado,
  garantiaDiasDefault = 30,
  isAdmin = false,
}: GarantiaCardProps) {
  const { confirm, showError } = useModal()
  const { formatDate } = useCurrency()
  const [garantia, setGarantia] = useState<Garantia | null>(null)
  const [loading, setLoading] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [showReclamoForm, setShowReclamoForm] = useState(false)
  const [creating, setCreating] = useState(false)
  const [diasValidez, setDiasValidez] = useState(String(garantiaDiasDefault))
  const [notas, setNotas] = useState("")
  const [updatingReclamo, setUpdatingReclamo] = useState<string | null>(null)
  const [showEditForm, setShowEditForm] = useState(false)
  const [editDias, setEditDias] = useState("30")
  const [editNotas, setEditNotas] = useState("")
  const [saving, setSaving] = useState(false)
  const [motivoPendiente, setMotivoPendiente] = useState<MotivoPendiente | null>(null)
  const [motivo, setMotivo] = useState("")

  const fetchGarantia = async () => {
    try {
      const res = await fetch(`/api/garantias?ordenId=${encodeURIComponent(ordenId)}`)
      const data = await res.json()
      // La API ya filtra por orden; el find es una red de seguridad.
      const garantiaOrden = Array.isArray(data)
        ? data.find((g: Garantia) => g.ordenId === ordenId)
        : null
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
        await showError(error.error || "Error al crear garantía")
        return
      }

      setShowCreateForm(false)
      fetchGarantia()
    } catch (error) {
      console.error("Error:", error)
      await showError("Error al crear garantía")
    } finally {
      setCreating(false)
    }
  }

  const openEditForm = () => {
    if (!garantia) return
    setEditDias(String(garantia.diasValidez))
    setEditNotas(garantia.notas || "")
    setShowEditForm(true)
  }

  const handleUpdateGarantia = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!garantia) return
    setSaving(true)
    try {
      const res = await fetch(`/api/garantias/${garantia.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          diasValidez: Math.max(1, parseInt(editDias, 10) || 30),
          notas: editNotas,
        }),
      })

      if (!res.ok) {
        const error = await res.json()
        await showError(error.error || "Error al actualizar garantía")
        return
      }

      setShowEditForm(false)
      fetchGarantia()
    } catch (error) {
      console.error("Error:", error)
      await showError("Error al actualizar garantía")
    } finally {
      setSaving(false)
    }
  }

  const handleUpdateReclamo = async (
    reclamoId: string,
    nuevoEstado: string,
    crearOrden?: boolean,
    resolucion?: string
  ) => {
    if (!garantia) return false

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
        await showError(error.error || "Error al actualizar reclamo")
        return false
      }

      fetchGarantia()
      return true
    } catch (error) {
      console.error("Error:", error)
      await showError("Error al actualizar reclamo")
      return false
    } finally {
      setUpdatingReclamo(null)
    }
  }

  const abrirMotivo = (reclamoId: string, estado: MotivoPendiente["estado"]) => {
    setMotivo("")
    setMotivoPendiente({ reclamoId, estado })
  }

  const confirmarMotivo = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!motivoPendiente || !motivo.trim()) return
    const ok = await handleUpdateReclamo(
      motivoPendiente.reclamoId,
      motivoPendiente.estado,
      false,
      motivo.trim()
    )
    if (ok) setMotivoPendiente(null)
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
          {!showCreateForm || !isAdmin ? (
            <div className="text-center py-4">
              <p className="text-muted-foreground mb-4">
                Esta orden no tiene garantía registrada
              </p>
              {isAdmin && (
                <Button onClick={() => setShowCreateForm(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Crear garantía
                </Button>
              )}
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
                  {creating ? "Creando..." : "Crear garantía"}
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
          <div className="flex items-center gap-2">
            <Badge variant={config.variant} icon={Icon} showIcon>
              {config.label}
            </Badge>
            {isAdmin && !showEditForm && (
              <Button variant="ghost" size="sm" onClick={openEditForm} title="Editar garantía">
                <Pencil className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isAdmin && showEditForm ? (
          <form onSubmit={handleUpdateGarantia} className="space-y-4">
            <div>
              <Label htmlFor="editDias">Días de validez</Label>
              <Input
                id="editDias"
                type="number"
                min="1"
                value={editDias}
                onChange={(e) => setEditDias(e.target.value)}
                disabled={saving}
              />
              <p className="text-xs text-muted-foreground mt-1">
                El vencimiento se recalcula desde la fecha de inicio.
              </p>
            </div>
            <div>
              <Label htmlFor="editNotas">Notas</Label>
              <Textarea
                id="editNotas"
                value={editNotas}
                onChange={(e) => setEditNotas(e.target.value)}
                placeholder="Condiciones de la garantía..."
                rows={2}
                disabled={saving}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowEditForm(false)}
                disabled={saving}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Guardando..." : "Guardar cambios"}
              </Button>
            </div>
          </form>
        ) : (
        <>
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
                  ? "text-destructive"
                  : diasRestantes <= 14
                  ? "text-warning-700 dark:text-warning-500"
                  : "text-success-700 dark:text-success-400"
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
            className="w-full"
            onClick={() => setShowReclamoForm(true)}
          >
            <AlertTriangle className="mr-2 h-4 w-4" />
            Registrar reclamo
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
              Historial de reclamos ({garantia.reclamos.length})
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
                      <Badge variant={reclamoConfig.variant}>
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
                    <p className="text-sm">
                      <Link
                        href={`/ordenes/${reclamo.ordenReparacionId}`}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        Nueva orden de reparación creada
                      </Link>
                    </p>
                  )}

                  {/* Acciones según estado */}
                  {isAdmin && reclamo.estado === "PENDIENTE" && (
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

                  {isAdmin && reclamo.estado === "EN_REVISION" && (
                    <div className="flex gap-2 pt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          const crearOrden = await confirm({
                            title: "Crear orden",
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
                        className="text-destructive"
                        onClick={() => abrirMotivo(reclamo.id, "RECHAZADO")}
                        disabled={isUpdating}
                      >
                        <XCircle className="mr-1 h-3 w-3" />
                        Rechazar
                      </Button>
                    </div>
                  )}

                  {isAdmin && reclamo.estado === "ACEPTADO" && (
                    <div className="flex gap-2 pt-2">
                      <Button
                        size="sm"
                        onClick={() => abrirMotivo(reclamo.id, "RESUELTO")}
                        disabled={isUpdating}
                      >
                        <CheckCircle className="mr-1 h-3 w-3" />
                        Marcar resuelto
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        </>
        )}
      </CardContent>

      <ResponsiveDialog
        open={motivoPendiente !== null}
        onOpenChange={(open) => {
          if (!open && !updatingReclamo) setMotivoPendiente(null)
        }}
      >
        {motivoPendiente && (
          <ResponsiveDialogContent>
            <form onSubmit={confirmarMotivo} className="space-y-4">
              <ResponsiveDialogHeader>
                <ResponsiveDialogTitle>{motivoDialogCopy[motivoPendiente.estado].title}</ResponsiveDialogTitle>
                <ResponsiveDialogDescription>
                  {motivoDialogCopy[motivoPendiente.estado].description}
                </ResponsiveDialogDescription>
              </ResponsiveDialogHeader>
              <div className="space-y-2">
                <Label htmlFor="motivo-reclamo">{motivoDialogCopy[motivoPendiente.estado].label}</Label>
                <Textarea
                  id="motivo-reclamo"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  rows={3}
                  required
                  autoFocus
                  disabled={updatingReclamo !== null}
                />
              </div>
              <ResponsiveDialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setMotivoPendiente(null)}
                  disabled={updatingReclamo !== null}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  variant={motivoPendiente.estado === "RECHAZADO" ? "destructive" : "default"}
                  disabled={!motivo.trim() || updatingReclamo !== null}
                >
                  {updatingReclamo !== null
                    ? "Guardando..."
                    : motivoDialogCopy[motivoPendiente.estado].confirm}
                </Button>
              </ResponsiveDialogFooter>
            </form>
          </ResponsiveDialogContent>
        )}
      </ResponsiveDialog>
    </Card>
  )
}
