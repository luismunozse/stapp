"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Loader2, FileText, Pencil, Trash2, ExternalLink } from "lucide-react"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import type { EstadoTurno, TipoTurno, TurnoConRelaciones } from "@/types"

const TIPO_LABELS: Record<TipoTurno, string> = {
  visita_diagnostico: "Visita de diagnóstico",
  reparacion_onsite: "Reparación en sitio",
  retiro: "Retiro de equipo",
  entrega: "Entrega de equipo",
  mantenimiento: "Mantenimiento",
}

const ESTADO_LABELS: Record<EstadoTurno, string> = {
  agendado: "Agendado",
  confirmado: "Confirmado",
  en_camino: "En camino",
  realizado: "Realizado",
  orden_generada: "Orden generada",
  cancelado: "Cancelado",
  no_show: "No se presentó",
}

const ESTADO_COLORS: Record<EstadoTurno, string> = {
  agendado: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  confirmado: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300",
  en_camino: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  realizado: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  orden_generada: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  cancelado: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400",
  no_show: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
}

const ESTADOS_EDITABLES: EstadoTurno[] = [
  "agendado", "confirmado", "en_camino", "realizado", "cancelado", "no_show",
]

interface TurnoDetailSheetProps {
  open: boolean
  onClose: () => void
  turno: TurnoConRelaciones | null
  onChanged: () => void
  onEdit: (turno: TurnoConRelaciones) => void
}

export function TurnoDetailSheet({ open, onClose, turno, onChanged, onEdit }: TurnoDetailSheetProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!turno) return null

  const cliente = turno.cliente
  const snap = turno.clienteSnapshot
  const tieneOrden = !!turno.ordenId
  const puedeEditarEstado = !tieneOrden && turno.estado !== "orden_generada"

  const updateEstado = async (nuevo: EstadoTurno) => {
    if (busy) return
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(`/api/turnos/${turno.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: nuevo }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || "Error al cambiar estado")
      }
      onChanged()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleEliminar = async () => {
    if (busy) return
    if (!confirm("¿Eliminar turno? Esta acción no se puede deshacer.")) return
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(`/api/turnos/${turno.id}`, { method: "DELETE" })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || "Error al eliminar")
      }
      onChanged()
      onClose()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleGenerarOrden = () => {
    router.push(`/ordenes?fromTurno=${turno.id}`)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between pr-8">
            <DialogTitle>Detalle del turno</DialogTitle>
            <span className={`text-xs font-medium px-2 py-1 rounded-full ${ESTADO_COLORS[turno.estado]}`}>
              {ESTADO_LABELS[turno.estado]}
            </span>
          </div>
          <DialogDescription>
            {TIPO_LABELS[turno.tipo]}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Fecha */}
          <div>
            <p className="text-xs text-muted-foreground">Fecha y hora</p>
            <p className="font-medium">
              {format(new Date(turno.inicio), "EEEE d 'de' MMMM, HH:mm", { locale: es })}
              {turno.fin && (
                <span className="text-muted-foreground">
                  {" "}— {format(new Date(turno.fin), "HH:mm")}
                </span>
              )}
            </p>
          </div>

          {/* Cliente */}
          <div>
            <p className="text-xs text-muted-foreground">Cliente</p>
            {cliente ? (
              <div>
                <p className="font-medium">{cliente.nombre}</p>
                <p className="text-sm text-muted-foreground">{cliente.telefono}</p>
              </div>
            ) : snap ? (
              <div>
                <p className="font-medium">{snap.nombre} <span className="text-xs text-amber-700 dark:text-amber-400">(sin registrar)</span></p>
                <p className="text-sm text-muted-foreground">{snap.telefono}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Sin cliente</p>
            )}
          </div>

          {/* Técnico */}
          {turno.tecnico && (
            <div>
              <p className="text-xs text-muted-foreground">Técnico</p>
              <p className="font-medium">{turno.tecnico.nombre}</p>
            </div>
          )}

          {/* Dirección */}
          {turno.direccion && (
            <div>
              <p className="text-xs text-muted-foreground">Dirección</p>
              <p className="text-sm">{turno.direccion}</p>
            </div>
          )}

          {/* Equipo */}
          {(turno.tipoDispositivo || turno.marca || turno.modelo) && (
            <div>
              <p className="text-xs text-muted-foreground">Equipo</p>
              <p className="text-sm">
                {[turno.tipoDispositivo, turno.marca, turno.modelo].filter(Boolean).join(" — ")}
              </p>
            </div>
          )}

          {turno.problemaReportado && (
            <div>
              <p className="text-xs text-muted-foreground">Problema reportado</p>
              <p className="text-sm whitespace-pre-wrap">{turno.problemaReportado}</p>
            </div>
          )}

          {turno.notas && (
            <div>
              <p className="text-xs text-muted-foreground">Notas internas</p>
              <p className="text-sm whitespace-pre-wrap">{turno.notas}</p>
            </div>
          )}

          {/* Orden vinculada */}
          {turno.orden && (
            <div className="border rounded-lg p-3 bg-muted/30">
              <p className="text-xs text-muted-foreground mb-1">Orden generada</p>
              <Link
                href={`/ordenes/${turno.orden.id}`}
                className="font-medium text-primary hover:underline flex items-center gap-1"
              >
                {turno.orden.codigoOrden || `#${turno.orden.numeroOrden}`}
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          )}

          {/* Cambio de estado */}
          {puedeEditarEstado && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Cambiar estado</p>
              <Select
                value={turno.estado}
                onValueChange={(v) => updateEstado(v as EstadoTurno)}
                disabled={busy}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ESTADOS_EDITABLES.map((e) => (
                    <SelectItem key={e} value={e}>{ESTADO_LABELS[e]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {error && (
            <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded p-2">
              {error}
            </div>
          )}

          {/* Acciones */}
          <div className="flex flex-wrap gap-2 pt-2 border-t">
            {!tieneOrden && turno.estado !== "cancelado" && (
              <Button onClick={handleGenerarOrden} disabled={busy}>
                <FileText className="mr-2 h-4 w-4" />
                Generar orden
              </Button>
            )}
            {!tieneOrden && (
              <Button variant="outline" onClick={() => onEdit(turno)} disabled={busy}>
                <Pencil className="mr-2 h-4 w-4" />
                Editar
              </Button>
            )}
            {!tieneOrden && (
              <Button
                variant="ghost"
                className="text-red-600 hover:text-red-700"
                onClick={handleEliminar}
                disabled={busy}
              >
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                Eliminar
              </Button>
            )}
            <Button variant="ghost" onClick={onClose} disabled={busy} className="ml-auto">
              Cerrar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
