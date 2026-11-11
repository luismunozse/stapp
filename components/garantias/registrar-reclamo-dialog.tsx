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
import type { OrigenGarantia } from "@/lib/garantias/estado"

export interface RegistrarReclamoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  origen: OrigenGarantia
  garantiaId: string
  /** Qué se reclama, para el subtítulo: "iPhone 13 · Juan Pérez". */
  detalle?: string
  /** "forzar": la garantía venció y el ADMIN la reclama igual dejando un motivo. */
  modo?: "vigente" | "forzar"
  onRegistrado?: () => void
}

/**
 * Registrar un reclamo de garantía (reparación o venta). Cualquier rol lo
 * registra; si la garantía venció, solo el ADMIN y con motivo. Si el servidor
 * contesta que hace falta el motivo (la garantía venció mientras tanto), el
 * campo aparece sin cerrar el diálogo.
 */
export function RegistrarReclamoDialog({
  open,
  onOpenChange,
  origen,
  garantiaId,
  detalle,
  modo = "vigente",
  onRegistrado,
}: RegistrarReclamoDialogProps) {
  const [descripcion, setDescripcion] = useState("")
  const [motivo, setMotivo] = useState("")
  const [pideMotivo, setPideMotivo] = useState(modo === "forzar")
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const reiniciar = () => {
    setDescripcion("")
    setMotivo("")
    setPideMotivo(modo === "forzar")
    setError(null)
  }

  const cerrar = (abierto: boolean) => {
    if (enviando) return
    if (!abierto) reiniciar()
    onOpenChange(abierto)
  }

  const listo = descripcion.trim().length > 0 && (!pideMotivo || motivo.trim().length > 0)

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!listo) return
    setEnviando(true)
    setError(null)
    try {
      const res = await fetch("/api/garantias/reclamos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origen,
          garantiaId,
          descripcion: descripcion.trim(),
          ...(pideMotivo ? { motivoFueraDeVigencia: motivo.trim() } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data?.code === "GARANTIA_VENCIDA" && data?.requiereMotivo) setPideMotivo(true)
        setError(data?.error || "No pudimos registrar el reclamo. Probá de nuevo.")
        return
      }
      reiniciar()
      onOpenChange(false)
      onRegistrado?.()
    } catch {
      setError("No pudimos registrar el reclamo. Revisá tu conexión y probá de nuevo.")
    } finally {
      setEnviando(false)
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={cerrar}>
      <ResponsiveDialogContent>
        <form onSubmit={enviar} className="space-y-4">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Registrar reclamo de garantía</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {detalle ? `${detalle}. ` : ""}Un administrador lo revisa y, si lo acepta, se abre una orden de re-ingreso
              sin cargo.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reclamo-descripcion">¿Qué problema tiene?</Label>
            <Textarea
              id="reclamo-descripcion"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Por ejemplo: la pantalla volvió a quedar en negro."
              rows={3}
              maxLength={2000}
              required
              autoFocus
              disabled={enviando}
            />
          </div>
          {pideMotivo && (
            <div className="space-y-2">
              <Label htmlFor="reclamo-motivo-vigencia">Motivo para aceptarlo fuera de garantía</Label>
              <Textarea
                id="reclamo-motivo-vigencia"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Por ejemplo: venció hace dos días y el cliente es habitual."
                rows={2}
                maxLength={1000}
                required
                disabled={enviando}
              />
              <p className="text-xs text-muted-foreground">La garantía ya venció: el motivo queda en el historial.</p>
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
            <Button type="submit" className="min-h-11" disabled={!listo || enviando}>
              {enviando ? "Registrando…" : "Registrar reclamo"}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
