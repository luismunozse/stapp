"use client"

import { useRef, useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { StatusBanner } from "@/components/ui/status-banner"
import { Textarea } from "@/components/ui/textarea"
import { useCurrency } from "@/contexts/currency-context"
import { reversaDeNotaCredito, type NotaCreditoParaReversa } from "@/lib/notas-credito/anulacion"

export interface NotaCreditoParaAnular extends NotaCreditoParaReversa {
  id: string
  numeroDevolucion: string
}

export interface AnularNotaCreditoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  ventaId: string
  nc: NotaCreditoParaAnular
  /** La venta tiene cliente: lo que bajó la deuda se había acreditado en su cuenta corriente. */
  tieneCliente: boolean
  /** Saldo actual de su cuenta corriente, si se conoce: avisa si queda debiendo. */
  saldoCliente: number | null
  onAnulada: () => void
}

/**
 * Anular una nota de crédito de venta (spec, UI: "Diálogo de anulación"): pide
 * el motivo y muestra qué se revierte; si la base la rechaza (stock que ya no
 * está, una serie revendida, otra NC más reciente) muestra por qué y queda
 * abierto. El padre lo monta por NC, así cada apertura arranca limpia.
 */
export function AnularNotaCreditoDialog({
  open,
  onOpenChange,
  ventaId,
  nc,
  tieneCliente,
  saldoCliente,
  onAnulada,
}: AnularNotaCreditoDialogProps) {
  const { formatPrice } = useCurrency()
  const [motivo, setMotivo] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  // El state llega tarde para un doble click: la guarda es esta ref.
  const enviandoRef = useRef(false)

  const lineas = reversaDeNotaCredito(nc, { formatPrice, tieneCliente, saldoCliente })

  const anular = async () => {
    const texto = motivo.trim()
    if (enviandoRef.current || !texto) return
    enviandoRef.current = true
    setEnviando(true)
    setError(null)
    try {
      const res = await fetch(`/api/ventas/${ventaId}/devolucion/${nc.id}/anular`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: texto }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || "No se pudo anular la nota de crédito")
        return
      }
      toast.success(`Nota de crédito ${nc.numeroDevolucion} anulada`)
      if (json.efectivoSinEgreso) {
        toast.warning(
          "No encontramos la salida de efectivo de esta nota de crédito en la caja, así que no se registró ningún ingreso. Si le habías devuelto plata, cargá el ingreso a mano en Caja."
        )
      }
      onOpenChange(false)
      onAnulada()
    } catch {
      setError("No se pudo anular la nota de crédito")
    } finally {
      enviandoRef.current = false
      setEnviando(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Anular la nota de crédito {nc.numeroDevolucion}</DialogTitle>
          <DialogDescription>Deja la venta como estaba antes de esta nota de crédito.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Qué se revierte</p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {lineas.map((linea) => (
                <li key={linea}>{linea}</li>
              ))}
            </ul>
          </div>

          <div className="space-y-2">
            <Label htmlFor="nc-anular-motivo">Motivo de la anulación</Label>
            <Textarea
              id="nc-anular-motivo"
              rows={2}
              maxLength={500}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: se cargó en la venta equivocada"
            />
          </div>

          {error ? (
            <StatusBanner tone="danger" icon={AlertTriangle}>
              {error}
            </StatusBanner>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="button" variant="destructive" onClick={anular} disabled={enviando || !motivo.trim()}>
              {enviando ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Anulando...
                </>
              ) : (
                "Anular nota de crédito"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
