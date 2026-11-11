"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
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

export type AccionReclamo = "aceptar" | "rechazar"

export interface ResultadoDecision {
  accion: AccionReclamo
  orden: { id: string; numeroOrden: number; codigoOrden: string | null } | null
}

export interface DecidirReclamoDialogProps {
  /** null = cerrado. */
  pendiente: { reclamoId: string; accion: AccionReclamo; descripcion: string; detalle?: string } | null
  onClose: () => void
  onDecidido?: (r: ResultadoDecision) => void
}

const COPY: Record<AccionReclamo, { titulo: string; boton: string; enviando: string }> = {
  aceptar: { titulo: "Aceptar reclamo", boton: "Aceptar y crear re-ingreso", enviando: "Creando re-ingreso…" },
  rechazar: { titulo: "Rechazar reclamo", boton: "Rechazar reclamo", enviando: "Rechazando…" },
}

/**
 * Aceptar o rechazar un reclamo (solo ADMIN). Aceptar crea la orden de
 * re-ingreso sin cargo; rechazar pide el motivo, que queda en el historial.
 * Diálogo propio: nada de prompt() ni confirm() nativos.
 */
export function DecidirReclamoDialog({ pendiente, onClose, onDecidido }: DecidirReclamoDialogProps) {
  const [motivo, setMotivo] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [abiertoPara, setAbiertoPara] = useState<string | null>(null)

  // Cada vez que se abre para otro reclamo o acción, el formulario arranca limpio.
  const clave = pendiente ? `${pendiente.reclamoId}:${pendiente.accion}` : null
  if (clave !== abiertoPara) {
    setAbiertoPara(clave)
    setMotivo("")
    setError(null)
  }

  const cerrar = (abierto: boolean) => {
    if (!abierto && !enviando) onClose()
  }

  if (!pendiente) {
    return <ResponsiveDialog open={false} onOpenChange={cerrar} />
  }

  const { accion } = pendiente
  const rechazo = accion === "rechazar"
  const listo = !rechazo || motivo.trim().length > 0

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!listo) return
    setEnviando(true)
    setError(null)
    try {
      const res = await fetch(`/api/garantias/reclamos/${encodeURIComponent(pendiente.reclamoId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rechazo ? { accion, motivo: motivo.trim() } : { accion }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || "No pudimos guardar la decisión. Probá de nuevo.")
        return
      }
      onDecidido?.({ accion, orden: data?.orden ?? null })
      onClose()
    } catch {
      setError("No pudimos guardar la decisión. Revisá tu conexión y probá de nuevo.")
    } finally {
      setEnviando(false)
    }
  }

  return (
    <ResponsiveDialog open onOpenChange={cerrar}>
      <ResponsiveDialogContent>
        <form onSubmit={enviar} className="space-y-4">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{COPY[accion].titulo}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {rechazo
                ? "El motivo queda en el historial del reclamo."
                : "Se crea una orden de re-ingreso sin cargo, vinculada a la garantía. El reclamo se cierra solo cuando entregues esa orden."}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="rounded-lg bg-muted p-3 text-sm">
            {pendiente.detalle ? <p className="font-medium">{pendiente.detalle}</p> : null}
            <p className="text-muted-foreground">{pendiente.descripcion}</p>
          </div>
          {rechazo && (
            <div className="space-y-2">
              <Label htmlFor="reclamo-motivo-rechazo">Motivo del rechazo</Label>
              <Textarea
                id="reclamo-motivo-rechazo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Por ejemplo: el equipo tiene daño por humedad, que la garantía no cubre."
                rows={3}
                maxLength={1000}
                required
                autoFocus
                disabled={enviando}
                aria-describedby="reclamo-motivo-rechazo-ayuda"
              />
              <p id="reclamo-motivo-rechazo-ayuda" className="text-xs text-muted-foreground">
                El cliente va a ver este motivo en el seguimiento de su orden.
              </p>
            </div>
          )}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => cerrar(false)} disabled={enviando}>
              Cancelar
            </Button>
            <Button
              type="submit"
              className="min-h-11"
              variant={rechazo ? "destructive" : "default"}
              disabled={!listo || enviando}
            >
              {enviando ? COPY[accion].enviando : COPY[accion].boton}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
