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

export interface ReingresoCreado {
  id: string
  numeroOrden: number
  codigoOrden: string | null
}

export interface ReingresoGarantiaDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  ordenId: string
  onCreado: (r: ReingresoCreado) => void
}

/**
 * "Re-ingreso por garantía" del menú de la orden (ADMIN): registra el reclamo
 * y lo acepta en un paso. Si la garantía venció, el servidor pide un motivo y
 * el campo aparece acá mismo.
 */
export function ReingresoGarantiaDialog({ open, onOpenChange, ordenId, onCreado }: ReingresoGarantiaDialogProps) {
  const [problema, setProblema] = useState("")
  const [motivo, setMotivo] = useState("")
  const [pideMotivo, setPideMotivo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const cerrar = (abierto: boolean) => {
    if (enviando) return
    if (!abierto) {
      setProblema("")
      setMotivo("")
      setPideMotivo(false)
      setError(null)
    }
    onOpenChange(abierto)
  }

  const listo = problema.trim().length > 0 && (!pideMotivo || motivo.trim().length > 0)

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!listo) return
    setEnviando(true)
    setError(null)
    try {
      const res = await fetch(`/api/ordenes/${encodeURIComponent(ordenId)}/reingreso`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          problemaReportado: problema.trim(),
          ...(pideMotivo ? { motivoFueraDeVigencia: motivo.trim() } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data?.code === "GARANTIA_VENCIDA" && data?.requiereMotivo) setPideMotivo(true)
        setError(data?.error || "No pudimos crear el re-ingreso. Probá de nuevo.")
        return
      }
      onCreado(data as ReingresoCreado)
    } catch {
      setError("No pudimos crear el re-ingreso. Revisá tu conexión y probá de nuevo.")
    } finally {
      setEnviando(false)
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={cerrar}>
      <ResponsiveDialogContent>
        <form onSubmit={enviar} className="space-y-4">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Re-ingreso por garantía</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Se registra el reclamo de garantía y se acepta en un paso: se crea una orden nueva sin cargo, vinculada a
              esta.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reingreso-problema">¿Qué problema trae?</Label>
            <Textarea
              id="reingreso-problema"
              value={problema}
              onChange={(e) => setProblema(e.target.value)}
              placeholder="Por ejemplo: volvió a fallar la carga."
              rows={3}
              maxLength={2000}
              required
              autoFocus
              disabled={enviando}
            />
          </div>
          {pideMotivo && (
            <div className="space-y-2">
              <Label htmlFor="reingreso-motivo">Motivo para aceptarlo fuera de garantía</Label>
              <Textarea
                id="reingreso-motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={2}
                maxLength={1000}
                required
                disabled={enviando}
              />
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
              {enviando ? "Creando re-ingreso…" : "Crear re-ingreso"}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
