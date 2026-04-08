"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Wand2, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react"
import { useSuperadminMutation } from "@/hooks/use-superadmin-fetch"
import { toast } from "sonner"

/**
 * Reconciliador manual de pagos MercadoPago.
 *
 * El operador pega un Payment ID de MP y este componente:
 *  - llama al endpoint /api/superadmin/payments/reconcile-mp
 *  - muestra el resumen del pago real de MP
 *  - si hubo activación MANUAL reciente, pide confirmación con force=true
 *  - actualiza el listado de pagos al terminar
 *
 * Es la única forma de "rescatar" un pago real cuya notificación nunca
 * llegó al webhook (firma rota, dominio caído, etc.) sin tener que
 * tocar SQL a mano.
 */
export function ReconcileMpCard({ onReconciled }: { onReconciled?: () => void }) {
  const [paymentId, setPaymentId] = useState("")
  const [conflict, setConflict] = useState<{
    message: string
    recentManual: { id: string; paid_at: string; amount: number } | null
  } | null>(null)
  const [lastResult, setLastResult] = useState<any>(null)
  const { mutate, loading } = useSuperadminMutation()

  const submit = async (force: boolean) => {
    setConflict(null)
    setLastResult(null)

    if (!paymentId.trim()) {
      toast.error("Pegá un Payment ID de MercadoPago")
      return
    }

    try {
      const res = await fetch("/api/superadmin/payments/reconcile-mp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paymentId: paymentId.trim(), force }),
      })
      const data = await res.json()

      if (res.status === 409 && data?.error === "manual_renewal_recent") {
        setConflict({
          message: data.message,
          recentManual: data.recentManual ?? null,
        })
        return
      }

      if (!res.ok) {
        toast.error(data?.error || "Error reconciliando pago")
        return
      }

      setLastResult(data)
      if (data.already_processed) {
        toast.info("El pago ya estaba registrado, no se hizo ningún cambio")
      } else if (data.result?.status === "PROCESSED") {
        toast.success("Pago reconciliado correctamente")
      } else {
        toast.warning(
          `Pago no aplicado: ${data.result?.reason || "razón desconocida"}`
        )
      }
      onReconciled?.()
    } catch (e: any) {
      toast.error(e?.message || "Error de red")
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wand2 className="h-4 w-4" />
          Reconciliar pago de MercadoPago
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Pegá el Payment ID de MercadoPago para forzar el procesamiento
          (usalo cuando el cliente pagó pero el webhook no impactó). Es
          idempotente: si ya estaba registrado, no duplica.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            placeholder="Payment ID (ej. 12345678901)"
            value={paymentId}
            onChange={(e) => setPaymentId(e.target.value)}
            disabled={loading}
            className="font-mono"
          />
          <Button onClick={() => submit(false)} disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4 mr-2" />
            )}
            Reconciliar
          </Button>
        </div>

        {conflict && (
          <div className="p-3 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 text-sm space-y-2">
            <div className="flex items-start gap-2 text-amber-900 dark:text-amber-100">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="font-medium">Conflicto: renovación manual reciente</p>
                <p className="text-xs">{conflict.message}</p>
                {conflict.recentManual && (
                  <p className="text-xs">
                    Último manual: ${conflict.recentManual.amount} el{" "}
                    {new Date(conflict.recentManual.paid_at).toLocaleString("es-AR")}
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                onClick={() => submit(true)}
                disabled={loading}
              >
                Continuar igual (extender encima)
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConflict(null)}
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {lastResult && !conflict && (
          <div className="p-3 rounded-md border bg-muted/30 text-sm">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span className="font-medium">Resultado</span>
              {lastResult.already_processed && (
                <Badge variant="secondary">ya procesado</Badge>
              )}
              {lastResult.result?.status && (
                <Badge>{lastResult.result.status}</Badge>
              )}
            </div>
            {lastResult.mpPayment && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Monto</dt>
                <dd>
                  {lastResult.mpPayment.amount} {lastResult.mpPayment.currency}
                </dd>
                <dt className="text-muted-foreground">Estado MP</dt>
                <dd>{lastResult.mpPayment.status}</dd>
                <dt className="text-muted-foreground">Aprobado</dt>
                <dd>{lastResult.mpPayment.date_approved || "—"}</dd>
              </dl>
            )}
            {lastResult.result?.reason && (
              <p className="text-xs text-muted-foreground mt-2">
                Razón: {lastResult.result.reason}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
