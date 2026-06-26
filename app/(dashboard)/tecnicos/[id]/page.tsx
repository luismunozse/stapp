"use client"

import { useState, useEffect, use } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  ArrowLeft,
  Mail,
  Calendar,
  ClipboardList,
  CheckCircle,
  Edit,
  Trash2,
  Phone,
  Tag,
  Power,
  PowerOff,
  ArrowRightLeft,
  AlertTriangle,
} from "lucide-react"
import { toast } from "sonner"
import { TecnicoForm } from "@/components/tecnicos/tecnico-form"
import { TecnicoComisiones } from "@/components/tecnicos/tecnico-comisiones"
import { TecnicoInsights } from "@/components/tecnicos/tecnico-insights"
import { TecnicoHistorial } from "@/components/tecnicos/tecnico-historial"
import { ReasignarOrdenesDialog } from "@/components/tecnicos/reasignar-ordenes-dialog"
import { HorarioLaboralEditor } from "@/components/tecnicos/horario-laboral-editor"
import { useModal } from "@/contexts/modal-context"
import { useCurrency } from "@/contexts/currency-context"

interface TecnicoDetalle {
  id: string
  nombre: string
  email: string
  telefono?: string | null
  activo: boolean
  especialidades: string[]
  fechaIngresoTecnico?: string | null
  avatarUrl?: string | null
  porcentajeComision?: number
  costoHora?: number
  createdAt: string
  ordenesActivas: number
  ordenesCompletadas: number
  horarioLaboral?: Record<string, Array<{ de: string; a: string }>> | null
}

const formatDate = (dateStr: string, timezone: string) => {
  return new Date(dateStr).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: timezone,
  })
}

export default function TecnicoDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { data: session } = useSession()
  const role = session?.user?.role
  const isAdmin = role === "ADMIN"
  const isSelf = role === "TECNICO" && session?.user?.id === id
  const canView = isAdmin || isSelf
  const { confirm, showError } = useModal()
  const { timezone } = useCurrency()
  const [tecnico, setTecnico] = useState<TecnicoDetalle | null>(null)
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [togglingEstado, setTogglingEstado] = useState(false)
  const [reasignarOpen, setReasignarOpen] = useState(false)

  useEffect(() => {
    if (session && !canView) {
      router.push("/dashboard")
      return
    }
    fetchTecnico()
  }, [id, session, canView])

  const fetchTecnico = async () => {
    try {
      const res = await fetch(`/api/tecnicos/${id}`)
      if (!res.ok) {
        router.push("/tecnicos")
        return
      }
      const data = await res.json()
      setTecnico(data)
    } catch (error) {
      console.error("Error fetching tecnico:", error)
      router.push("/tecnicos")
    } finally {
      setLoading(false)
    }
  }

  const handleToggleEstado = async () => {
    if (!tecnico) return
    const nuevo = !tecnico.activo
    const confirmed = await confirm({
      title: nuevo ? "Reactivar técnico" : "Desactivar técnico",
      description: nuevo
        ? "El técnico volverá a poder recibir asignaciones."
        : `El técnico dejará de recibir asignaciones nuevas.${
            tecnico.ordenesActivas > 0
              ? ` Aún tiene ${tecnico.ordenesActivas} orden(es) activa(s) — considerá reasignarlas.`
              : ""
          }`,
      confirmText: nuevo ? "Reactivar" : "Desactivar",
      variant: nuevo ? "info" : "danger",
    })
    if (!confirmed) return

    setTogglingEstado(true)
    try {
      const res = await fetch(`/api/tecnicos/${id}/estado`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: nuevo }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Error al actualizar estado")
      }
      const data = await res.json()
      toast.success(nuevo ? "Técnico reactivado" : "Técnico desactivado")
      if (data.warning) toast.warning(data.warning)
      fetchTecnico()
    } catch (err) {
      await showError(err instanceof Error ? err.message : "Error al actualizar estado")
    } finally {
      setTogglingEstado(false)
    }
  }

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: "Eliminar Técnico",
      description: "¿Estás seguro de eliminar este técnico? Esta acción no se puede deshacer.",
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      variant: "danger",
    })

    if (!confirmed) return

    setDeleting(true)
    try {
      const res = await fetch(`/api/tecnicos/${id}`, { method: "DELETE" })
      if (res.ok) {
        router.push("/tecnicos")
      } else {
        const data = await res.json()
        await showError(data.error || "Error al eliminar")
      }
    } catch (error) {
      console.error("Error deleting tecnico:", error)
      await showError("Error al eliminar técnico")
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (!tecnico) {
    return null
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3 sm:gap-4">
          {isAdmin && (
            <Button variant="ghost" size="icon" asChild className="shrink-0">
              <Link href="/tecnicos">
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-3xl font-bold truncate">
                {isSelf ? "Mi desempeño" : tecnico.nombre}
              </h1>
              {!tecnico.activo && (
                <Badge variant="outline" className="bg-muted text-muted-foreground text-[10px]">
                  Inactivo
                </Badge>
              )}
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground">
              {isSelf ? tecnico.nombre : "Detalle del técnico"}
            </p>
          </div>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2 pl-12 sm:pl-0">
            {tecnico.ordenesActivas > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReasignarOpen(true)}
              >
                <ArrowRightLeft className="mr-1.5 h-4 w-4" />
                Reasignar órdenes
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleToggleEstado}
              disabled={togglingEstado}
            >
              {tecnico.activo ? (
                <PowerOff className="mr-1.5 h-4 w-4" />
              ) : (
                <Power className="mr-1.5 h-4 w-4" />
              )}
              {tecnico.activo ? "Desactivar" : "Reactivar"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Edit className="mr-1.5 h-4 w-4" />
              Editar
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={deleting || tecnico.ordenesActivas > 0}
              title={tecnico.ordenesActivas > 0 ? "No se puede eliminar con órdenes activas" : ""}
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              <span className="hidden sm:inline">{deleting ? "Eliminando..." : "Eliminar"}</span>
              <span className="sm:hidden">{deleting ? "..." : "Eliminar"}</span>
            </Button>
          </div>
        )}
      </div>

      {!tecnico.activo && (
        <div className="flex items-start gap-2 p-3 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">Técnico desactivado</div>
            <div className="text-xs">
              Conserva su historial y comisiones, pero no recibirá asignaciones nuevas hasta
              reactivarlo.
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid gap-3 sm:gap-6 grid-cols-3">
        <Card>
          <CardHeader className="p-3 sm:p-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
              Información
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0 space-y-2 sm:space-y-3">
            <div className="flex items-center gap-2 min-w-0">
              <Mail className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground shrink-0" />
              <span className="text-xs sm:text-sm truncate">{tecnico.email}</span>
            </div>
            {tecnico.telefono ? (
              <div className="flex items-center gap-2 min-w-0">
                <Phone className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground shrink-0" />
                <a
                  href={`tel:${tecnico.telefono}`}
                  className="text-xs sm:text-sm truncate hover:underline"
                >
                  {tecnico.telefono}
                </a>
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground shrink-0" />
              <span className="text-xs sm:text-sm">
                {tecnico.fechaIngresoTecnico
                  ? `Ingreso ${formatDate(tecnico.fechaIngresoTecnico, timezone)}`
                  : `Desde ${formatDate(tecnico.createdAt, timezone)}`}
              </span>
            </div>
            {tecnico.especialidades && tecnico.especialidades.length > 0 && (
              <div className="flex items-start gap-2">
                <Tag className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground shrink-0 mt-0.5" />
                <div className="flex flex-wrap gap-1">
                  {tecnico.especialidades.map((esp) => (
                    <Badge
                      key={esp}
                      variant="secondary"
                      className="text-[10px] font-normal"
                    >
                      {esp}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center justify-between pt-2 border-t">
              <span className="text-xs sm:text-sm text-muted-foreground">% Comisión</span>
              <Badge variant="outline" className="text-[10px] sm:text-xs">
                {Number(tecnico.porcentajeComision ?? 0).toFixed(2)}%
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs sm:text-sm text-muted-foreground">Costo/hora</span>
              <Badge variant="outline" className="text-[10px] sm:text-xs">
                ${Number(tecnico.costoHora ?? 0).toFixed(2)}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-3 sm:p-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground flex items-center gap-1.5 sm:gap-2">
              <ClipboardList className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Órdenes Activas</span>
              <span className="sm:hidden">Activas</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className="text-xl sm:text-3xl font-bold">{tecnico.ordenesActivas}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-3 sm:p-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground flex items-center gap-1.5 sm:gap-2">
              <CheckCircle className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Completadas</span>
              <span className="sm:hidden">Hechas</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className="text-xl sm:text-3xl font-bold text-green-600">{tecnico.ordenesCompletadas}</div>
          </CardContent>
        </Card>
      </div>

      {/* Insights operativos */}
      {canView && <TecnicoInsights tecnicoId={tecnico.id} />}

      {/* Comisiones del técnico */}
      {canView && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base sm:text-lg font-semibold">
              {isSelf ? "Mis comisiones" : "Comisiones"}
            </h2>
            <span className="text-xs text-muted-foreground">
              % Comisión base aplicada a ganancia (cobrado − repuestos)
            </span>
          </div>
          <TecnicoComisiones
            tecnicoId={tecnico.id}
            tecnicoNombre={tecnico.nombre}
            porcentajeDefault={tecnico.porcentajeComision}
            readOnly={!isAdmin}
          />
        </div>
      )}

      {/* Horario laboral (sólo admin) */}
      {isAdmin && (
        <HorarioLaboralEditor
          tecnicoId={tecnico.id}
          initial={(tecnico.horarioLaboral as any) || null}
          onSaved={fetchTecnico}
        />
      )}

      {/* Historial */}
      <TecnicoHistorial tecnicoId={tecnico.id} />

      <TecnicoForm
        open={editOpen}
        onOpenChange={setEditOpen}
        tecnico={tecnico}
        onSuccess={fetchTecnico}
      />

      <ReasignarOrdenesDialog
        open={reasignarOpen}
        onOpenChange={setReasignarOpen}
        tecnicoOrigenId={tecnico.id}
        tecnicoOrigenNombre={tecnico.nombre}
        ordenesActivas={tecnico.ordenesActivas}
        onSuccess={fetchTecnico}
      />
    </div>
  )
}
