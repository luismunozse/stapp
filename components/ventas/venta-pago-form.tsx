"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { X, DollarSign } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { useOffline } from "@/contexts/offline-context"
import { STORES } from "@/lib/offline/constants"
import { MultiPagoInput, createPagoLine, type PagoLineItem } from "@/components/pagos/multi-pago-input"

interface VentaPagoFormProps {
  ventaId: string
  total: number
  montoAbonado: number
  clienteId?: string | null
  onClose: () => void
  onSuccess: () => void
}

export function VentaPagoForm({
  ventaId,
  total,
  montoAbonado,
  clienteId,
  onClose,
  onSuccess,
}: VentaPagoFormProps) {
  const { formatPrice } = useCurrency()
  const { offlineFetch } = useOffline()
  const [loading, setLoading] = useState(false)
  const pendiente = total - montoAbonado
  const [pagosLines, setPagosLines] = useState<PagoLineItem[]>([createPagoLine(pendiente)])
  const [observaciones, setObservaciones] = useState("")
  const [saldoCuenta, setSaldoCuenta] = useState(0)

  // Fetch saldo cuenta corriente si hay cliente
  useEffect(() => {
    if (!clienteId) return
    const fetchSaldo = async () => {
      try {
        const res = await fetch(`/api/clientes/${clienteId}/cuenta-corriente`)
        if (res.ok) {
          const data = await res.json()
          setSaldoCuenta(data.saldo || 0)
        }
      } catch {
        setSaldoCuenta(0)
      }
    }
    fetchSaldo()
  }, [clienteId])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const totalPagos = pagosLines.reduce((sum, p) => sum + (p.monto || 0), 0)
    if (totalPagos <= 0) {
      alert("Debe registrar al menos un pago")
      return
    }
    if (totalPagos > pendiente + 0.01) {
      alert(`El total de pagos (${formatPrice(totalPagos)}) excede el pendiente (${formatPrice(pendiente)})`)
      return
    }

    // Validar cuenta corriente
    const pagoCC = pagosLines.find(p => p.metodo === "CUENTA_CORRIENTE")
    if (pagoCC && pagoCC.monto > saldoCuenta) {
      alert(`El monto de cuenta corriente excede el saldo disponible (${formatPrice(saldoCuenta)})`)
      return
    }

    setLoading(true)
    try {
      const payload = {
        pagos: pagosLines.map(p => ({
          monto: p.monto,
          metodo: p.metodo,
          referencia: p.referencia || null,
          cuotas: p.cuotas,
          recargo: p.recargo,
          montoOriginal: p.montoOriginal,
          costoFinanciero: p.costoFinanciero,
        })),
        observaciones: observaciones || undefined,
        clienteId: clienteId || undefined,
      }

      const res = await offlineFetch(`/api/ventas/${ventaId}/pagos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }, { store: STORES.PAYMENTS, description: `Pago venta` })

      if (res.status === 202) {
        alert("Pago guardado offline. Se sincronizará automáticamente.")
        onSuccess()
        return
      }

      if (!res.ok) {
        const error = await res.json()
        alert(error.error || "Error al registrar pago")
        return
      }

      onSuccess()
    } catch (error) {
      console.error("Error:", error)
      alert("Error al registrar pago")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="mb-4">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <DollarSign className="h-5 w-5" />
            Registrar Pago
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-5 p-3 bg-muted rounded-lg">
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <span className="text-muted-foreground">Total</span>
              <div className="font-semibold">{formatPrice(total)}</div>
            </div>
            <div>
              <span className="text-muted-foreground">Abonado</span>
              <div className="font-semibold text-green-600">
                {formatPrice(montoAbonado)}
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">Pendiente</span>
              <div className="font-semibold text-red-600">
                {formatPrice(pendiente)}
              </div>
            </div>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <MultiPagoInput
            montoPendiente={pendiente}
            pagos={pagosLines}
            onChange={setPagosLines}
            saldoCuenta={saldoCuenta}
            showCuentaCorriente={!!clienteId && saldoCuenta > 0}
          />

          {/* Observaciones */}
          <div>
            <Label htmlFor="observaciones">Observaciones</Label>
            <Textarea
              id="observaciones"
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              placeholder="Notas adicionales..."
              rows={2}
            />
          </div>

          {/* Acciones */}
          <div className="flex gap-2 justify-end pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Registrando..." : "Registrar Pago"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
