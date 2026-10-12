"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { RubroPicker } from "@/components/registro/rubro-picker"
import { DEFAULT_RUBRO_ID } from "@/lib/rubros"
import { validarSeleccionRubro } from "@/lib/rubros/seleccion"
import { etiquetaRubro } from "./wizard-state"
import type { RubroVigente } from "./types"

interface RubroSelectorProps {
  rubro: string
  rubroDetalle: string | null
  /** True when the shop already has real orders: the server would answer 409. */
  bloqueado: boolean
  onGuardado: (rubro: RubroVigente) => void
  onBloqueado: () => void
}

const MOTIVO_BLOQUEO_ID = "rubro-bloqueado-motivo"
const MENSAJE_BLOQUEO = "Ya cargaste órdenes, así que el rubro no se puede cambiar desde acá."

export function RubroSelector({ rubro, rubroDetalle, bloqueado, onGuardado, onBloqueado }: RubroSelectorProps) {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [borrador, setBorrador] = useState(rubro)
  const [detalle, setDetalle] = useState(rubroDetalle ?? "")
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cambiado, setCambiado] = useState(false)

  const abrir = () => {
    setBorrador(rubro)
    setDetalle(rubroDetalle ?? "")
    setError(null)
    setAbierto(true)
  }

  // The request must finish before the dialog can close (X, Escape, overlay, Cancelar).
  const cambiarApertura = (open: boolean) => {
    if (guardando) return
    setAbierto(open)
  }

  const guardar = async () => {
    const esGenerico = borrador === DEFAULT_RUBRO_ID
    const detalleLimpio = esGenerico ? detalle.trim() : ""
    const invalido = validarSeleccionRubro(borrador, detalleLimpio)
    if (invalido) {
      setError(invalido)
      return
    }

    // No same-rubro shortcut here: the server decides the no-op from DB state.
    setGuardando(true)
    setError(null)
    try {
      const res = await fetch("/api/onboarding/rubro", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rubro: borrador, rubroDetalle: esGenerico ? detalleLimpio : null }),
      })
      const body = await res.json().catch(() => null)
      if (res.status === 409) {
        setError(body?.error || MENSAJE_BLOQUEO)
        onBloqueado()
        return
      }
      if (!res.ok) {
        // A failed rebuild may have changed the DB halfway: re-read the server state.
        if (res.status >= 500) router.refresh()
        setError(body?.error || "No pudimos cambiar el rubro. Probá de nuevo.")
        return
      }
      onGuardado({
        rubro: body?.rubro ?? borrador,
        rubroDetalle: body?.rubroDetalle ?? (esGenerico ? detalleLimpio : null),
      })
      setCambiado(true)
      setAbierto(false)
    } catch (err) {
      console.error("Error changing the rubro:", err)
      setError("No pudimos cambiar el rubro. Revisá tu conexión y probá de nuevo.")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="text-muted-foreground">Tu rubro:</span>
        <span className="font-medium">{etiquetaRubro(rubro, rubroDetalle)}</span>
        <span aria-hidden="true" className="text-muted-foreground">
          ·
        </span>
        <Button
          type="button"
          variant="link"
          className="h-auto p-0"
          onClick={abrir}
          disabled={bloqueado}
          aria-label="Cambiar rubro"
          aria-describedby={bloqueado ? MOTIVO_BLOQUEO_ID : undefined}
        >
          Cambiar
        </Button>
      </div>
      {bloqueado && (
        <p id={MOTIVO_BLOQUEO_ID} className="mt-1 text-xs text-muted-foreground">
          Ya cargaste órdenes, así que el rubro queda como está.
        </p>
      )}
      {cambiado && !bloqueado && (
        <p role="status" className="mt-1 text-xs text-success-700 dark:text-success-500">
          Listo, preparamos tu cuenta para este rubro.
        </p>
      )}

      <Dialog open={abierto} onOpenChange={cambiarApertura}>
        <DialogContent
          className="w-[calc(100%-2rem)] rounded-lg sm:max-w-xl"
          onEscapeKeyDown={(e) => {
            if (guardando) e.preventDefault()
          }}
          onInteractOutside={(e) => {
            if (guardando) e.preventDefault()
          }}
        >
          <DialogHeader>
            <DialogTitle>Cambiar rubro</DialogTitle>
            <DialogDescription>
              Preparamos tus tipos de equipo, el checklist de recepción y el vocabulario del sistema. Si hiciste una
              práctica, se borra.
            </DialogDescription>
          </DialogHeader>
          <RubroPicker
            value={borrador}
            onChange={(id) => {
              setBorrador(id)
              setError(null)
            }}
            detalle={detalle}
            onDetalleChange={(texto) => {
              setDetalle(texto)
              setError(null)
            }}
            disabled={guardando}
          />
          {error && (
            <div
              role="alert"
              className="rounded border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => cambiarApertura(false)} disabled={guardando}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void guardar()} disabled={guardando}>
              {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {guardando ? "Guardando…" : "Guardar rubro"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
