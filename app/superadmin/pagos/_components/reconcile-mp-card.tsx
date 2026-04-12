"use client"

import { useState, useEffect, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Wand2, Loader2, AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react"
import { toast } from "sonner"
import Link from "next/link"

/**
 * Reconciliador manual de pagos MercadoPago.
 *
 * El operador pega un Payment ID de MP y este componente:
 *  - llama al endpoint /api/superadmin/payments/reconcile-mp
 *  - muestra el resumen del pago real de MP
 *  - si hubo activación MANUAL reciente, pide confirmación con force=true
 *  - actualiza el listado de pagos al terminar
 *
 * Mejoras:
 *  - Tras cualquier error, el botón se deshabilita por 10 segundos
 *  - El error se muestra en rojo debajo del campo con link a la org
 *  - Si el error es plan_not_found, se muestra link a suscripciones de la org
 */
export function ReconcileMpCard({ onReconciled }: { onReconciled?: () => void }) {
  const [paymentId, setPaymentId] = useState("")
  const [conflict, setConflict] = useState<{
    message: string
    recentManual: { id: string; paid_at: string; amount: number } | null
    organizationSlug?: string | null
  } | null>(null)
  const [lastResult, setLastResult] = useState<any>(null)
  const [lastError, setLastError] = useState<{
    message: string
    error?: string
    organizationSlug?: string | null
    organizationId?: string | null
    _cached?: boolean
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Countdown timer para cooldown
  useEffect(() => {
    if (cooldown <= 0) {
      if (cooldownRef.current) clearInterval(cooldownRef.current)
      return
    }
    cooldownRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownRef.current) clearInterval(cooldownRef.current)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current)
    }
  }, [cooldown > 0]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (force: boolean) => {
    setConflict(null)
    setLastResult(null)
    setLastError(null)

    if (!paymentId.trim()) {
      toast.error("Pegá un Payment ID de MercadoPago")
      return
    }

    setLoading(true)
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
          organizationSlug: data.organizationSlug ?? null,
        })
        return
      }

      if (!res.ok) {
        // Activar cooldown de 10 segundos tras cualquier error
        setCooldown(10)
        setLastError({
          message: data?.message || data?.error || "Error reconciliando pago",
          error: data?.error,
          organizationSlug: data?.organizationSlug ?? null,
          organizationId: data?.organizationId ?? null,
          _cached: data?._cached ?? false,
        })
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
      setCooldown(10)
      setLastError({
        message: e?.message || "Error de red",
      })
    } finally {
      setLoading(false)
    }
  }

  const isDisabled = loading || cooldown > 0

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
          <Button onClick={() => submit(false)} disabled={isDisabled}>
            {loading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4 mr-2" />
            )}
            {cooldown > 0 ? `Esperar ${cooldown}s` : "Reconciliar"}
          </Button>
        </div>

        {/* Error feedback con link a organización */}
        {lastError && (
          <div className="p-3 rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 text-sm space-y-2">
            <div className="flex items-start gap-2 text-red-900 dark:text-red-100">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-red-600" />
              <div className="space-y-1">
                <p className="font-medium text-red-700 dark:text-red-300">
                  {lastError.message}
                </p>
                {lastError._cached && (
                  <p className="text-xs text-red-600 dark:text-red-400">
                    Este error fue cacheado. Esperá 60 segundos antes de reintentar.
                  </p>
                )}
                {lastError.organizationSlug && (
                  <div className="flex flex-col gap-1 mt-1">
                    <Link
                      href={`/superadmin/organizaciones/${lastError.organizationId || ""}`}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Ver organización: {lastError.organizationSlug}
                    </Link>
                    {lastError.error === "plan_not_found" && (
                      <Link
                        href={`/superadmin/organizaciones/${lastError.organizationId || ""}#suscripcion`}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1 font-medium"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Ir a Suscripciones de esta organización para asignar un plan
                      </Link>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

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
                {conflict.organizationSlug && (
                  <Link
                    href={`/superadmin/organizaciones/${conflict.organizationSlug}`}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Ver organización: {conflict.organizationSlug}
                  </Link>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                onClick={() => submit(true)}
                disabled={isDisabled}
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
