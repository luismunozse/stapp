"use client"

import { useCallback, useEffect, useState } from "react"
import { ListChecks, Trash2, Eye, EyeOff, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useCurrency } from "@/contexts/currency-context"
import { useModal } from "@/contexts/modal-context"
import { ESTADO_LABELS } from "@/lib/orden-state-machine"
import { AVANCE_MAX_CHARS } from "@/lib/ordenes/avances"

export interface Avance {
  id: string
  texto: string
  estado: string | null
  visibleCliente: boolean
  createdAt: string
  autorId: string | null
  autor: string | null
}

interface OrdenAvancesProps {
  ordenId: string
  userId?: string | null
  isAdmin: boolean
}

/**
 * Bitácora de avances de la orden. Cada entrada queda con fecha, autor y el
 * estado de la orden; las marcadas "visible para el cliente" salen en el PDF
 * de entrega.
 */
export function OrdenAvances({ ordenId, userId, isAdmin }: OrdenAvancesProps) {
  const { formatDateTime } = useCurrency()
  const { confirm } = useModal()
  const [avances, setAvances] = useState<Avance[]>([])
  const [loading, setLoading] = useState(true)
  const [texto, setTexto] = useState("")
  const [visibleCliente, setVisibleCliente] = useState(true)
  const [saving, setSaving] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/ordenes/${ordenId}/avances`)
      if (res.ok) setAvances(await res.json())
    } catch (error) {
      console.error("Error fetching avances:", error)
    } finally {
      setLoading(false)
    }
  }, [ordenId])

  useEffect(() => {
    cargar()
  }, [cargar])

  const agregar = async () => {
    const limpio = texto.trim()
    if (!limpio) return
    setSaving(true)
    try {
      const res = await fetch(`/api/ordenes/${ordenId}/avances`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: limpio, visibleCliente }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || "No se pudo guardar el avance")
        return
      }
      setAvances((prev) => [...prev, data as Avance])
      setTexto("")
      toast.success("Avance agregado")
    } catch {
      toast.error("No se pudo guardar el avance")
    } finally {
      setSaving(false)
    }
  }

  const borrar = async (avance: Avance) => {
    const ok = await confirm({
      title: "Borrar avance",
      description: "¿Borrar este avance? No se puede deshacer.",
      confirmText: "Borrar",
      variant: "danger",
    })
    if (!ok) return
    try {
      const res = await fetch(`/api/ordenes/${ordenId}/avances/${avance.id}`, { method: "DELETE" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || "No se pudo borrar el avance")
        return
      }
      setAvances((prev) => prev.filter((a) => a.id !== avance.id))
    } catch {
      toast.error("No se pudo borrar el avance")
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <ListChecks className="h-4 w-4" />
        Avances de la reparación
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : avances.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin avances todavía. Anotá lo que se va haciendo en cada etapa.</p>
      ) : (
        <ol className="space-y-2">
          {avances.map((a) => {
            const puedeBorrar = isAdmin || (!!userId && a.autorId === userId)
            return (
              <li key={a.id} className="rounded-md border p-2 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="whitespace-pre-wrap break-words">{a.texto}</p>
                  {puedeBorrar && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={() => borrar(a)}
                      aria-label="Borrar avance"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span>{formatDateTime(a.createdAt)}</span>
                  {a.autor && <span>· {a.autor}</span>}
                  {a.estado && <span>· {ESTADO_LABELS[a.estado as keyof typeof ESTADO_LABELS] ?? a.estado}</span>}
                  <span className="inline-flex items-center gap-1">
                    ·{" "}
                    {a.visibleCliente ? (
                      <>
                        <Eye className="h-3 w-3" /> Visible para el cliente
                      </>
                    ) : (
                      <>
                        <EyeOff className="h-3 w-3" /> Interno
                      </>
                    )}
                  </span>
                </div>
              </li>
            )
          })}
        </ol>
      )}

      <div className="space-y-2">
        <Textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Ej: Se cambió el módulo de pantalla, queda en prueba 24 hs"
          maxLength={AVANCE_MAX_CHARS}
          rows={2}
          aria-label="Nuevo avance"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={visibleCliente}
              onChange={(e) => setVisibleCliente(e.target.checked)}
              className="h-4 w-4"
            />
            Visible para el cliente (sale en el PDF de entrega)
          </label>
          <Button type="button" size="sm" onClick={agregar} disabled={saving || !texto.trim()}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Agregar avance
          </Button>
        </div>
      </div>
    </div>
  )
}
