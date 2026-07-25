"use client"

import { useState, useEffect } from "react"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Wrench, Loader2 } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { printDeviceLabel } from "@/components/ordenes/print-label"
import { toast } from "sonner"

interface ConfirmarReparadoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  orden: {
    id: string
    numeroOrden: number
    codigoOrden?: string
    presupuesto?: number | null
    costoFinal?: number | null
    sena?: number
    totalCobrado?: number
    descuentoCobro?: number
    clienteNombre?: string
    dispositivo?: string
    problemaReportado?: string
    publicToken?: string | null
  }
  onSuccess: () => void
}

/**
 * Modal de cierre de precio al marcar una orden como REPARADO.
 *
 * Reemplaza el PUT directo (que fallaba con 400 "se requiere Costo final" cuando
 * la orden venía sin costo del flujo express) por un paso guiado: captura el
 * costo final del arreglo con el presupuesto / seña / ya cobrado como contexto, y
 * en una sola request setea el costo y transiciona a REPARADO. No cobra: eso
 * sigue siendo un paso aparte (CobrarOrdenDialog).
 */
export function ConfirmarReparadoDialog({ open, onOpenChange, orden, onSuccess }: ConfirmarReparadoDialogProps) {
  const { formatPrice, timezone } = useCurrency()
  const [costo, setCosto] = useState<string>("")
  const [loading, setLoading] = useState(false)
  const [imprimirEtiqueta, setImprimirEtiqueta] = useState(true)

  // Pre-carga al abrir: costo final existente o, si no hay, el presupuesto. En el
  // flujo con cotización costo_final ya viene sembrado; en el express arranca vacío.
  useEffect(() => {
    if (open) {
      const inicial = orden.costoFinal || orden.presupuesto || 0
      setCosto(inicial ? String(inicial) : "")
    }
  }, [open, orden.costoFinal, orden.presupuesto])

  const costoNum = parseFloat(costo) || 0
  const descuento = orden.descuentoCobro || 0
  const cobrado = orden.totalCobrado || 0
  const sena = orden.sena || 0
  const pendiente = Math.max(0, costoNum - descuento - cobrado)
  const hayContexto = !!orden.presupuesto || sena > 0 || cobrado > 0

  const handleConfirmar = async () => {
    if (costoNum <= 0) return
    setLoading(true)
    try {
      const res = await fetch(`/api/ordenes/${orden.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: "REPARADO", costoFinal: costoNum }),
      })
      if (res.ok) {
        if (imprimirEtiqueta) {
          const fecha = new Date().toLocaleDateString("es-AR", { timeZone: timezone })
          await printDeviceLabel(
            {
              codigoOrden: orden.codigoOrden || `#${orden.numeroOrden}`,
              numeroOrden: orden.numeroOrden,
              clienteNombre: orden.clienteNombre || "",
              dispositivo: orden.dispositivo || "",
              problemaReportado: orden.problemaReportado || "",
              fechaIngreso: fecha,
              publicToken: orden.publicToken,
              variant: "reparado",
              fechaReparacion: fecha,
            },
            window.location.origin,
          )
        }
        onSuccess()
        onOpenChange(false)
      } else {
        const error = await res.json().catch(() => ({}))
        toast.error(error.error || "No se pudo marcar como reparado")
      }
    } catch {
      toast.error("No se pudo marcar como reparado")
    } finally {
      setLoading(false)
    }
  }

  const ordenLabel = orden.codigoOrden || `#${String(orden.numeroOrden).padStart(4, "0")}`

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            Marcar como Reparado {ordenLabel}
            {orden.clienteNombre && (
              <span className="text-sm font-normal text-muted-foreground">- {orden.clienteNombre}</span>
            )}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="space-y-4">
          {hayContexto && (
            <div className="p-3 bg-muted rounded-lg space-y-1.5 text-sm">
              {orden.presupuesto ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Presupuesto</span>
                  <span>{formatPrice(orden.presupuesto)}</span>
                </div>
              ) : null}
              {sena > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Seña</span>
                  <span className="text-info">{formatPrice(sena)}</span>
                </div>
              )}
              {cobrado > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ya cobrado</span>
                  <span className="text-success">{formatPrice(cobrado)}</span>
                </div>
              )}
            </div>
          )}

          <div>
            <Label htmlFor="costo-reparado" className="text-sm">
              Costo final del arreglo
            </Label>
            <Input
              id="costo-reparado"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              autoFocus
              value={costo}
              onChange={(e) => setCosto(e.target.value)}
              placeholder="0.00"
              className="mt-1"
            />
          </div>

          {costoNum > 0 && (
            <div className="flex justify-between items-center font-semibold pt-2 border-t">
              <span>Queda a cobrar</span>
              <span className="text-lg">{formatPrice(pendiente)}</span>
            </div>
          )}

          <label className="flex items-center gap-2 cursor-pointer text-sm pt-1">
            <input
              type="checkbox"
              checked={imprimirEtiqueta}
              onChange={(e) => setImprimirEtiqueta(e.target.checked)}
              disabled={loading}
              className="rounded"
            />
            Imprimir etiqueta para el equipo
          </label>
        </div>

        <div className="mt-4 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button className="flex-1" onClick={handleConfirmar} disabled={loading || costoNum <= 0}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Marcar como Reparado
          </Button>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
