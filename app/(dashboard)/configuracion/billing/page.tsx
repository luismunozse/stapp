"use client"

import { useState, useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { CurrentPlan } from "@/components/billing/current-plan"
import { UsageStats } from "@/components/billing/usage-stats"
import { PaymentHistory } from "@/components/billing/payment-history"
import { UpgradeModal } from "@/components/billing/upgrade-modal"
import { Button } from "@/components/ui/button"
import { ArrowLeft, CheckCircle, XCircle, Loader2 } from "lucide-react"
import Link from "next/link"
import { useModal } from "@/contexts/modal-context"
import type { SubscriptionInfo, UsageInfo } from "@/lib/subscriptions"
import { getMpRejectionInfo, type MpRejectionInfo } from "@/lib/mp-status-detail"

interface Plan {
  id: string
  nombre: string
  tipo: string
  precio_mensual: number
  precio_anual: number
}

interface Payment {
  id: string
  amount: number
  currency: string
  status: string
  payment_provider: string
  invoice_url?: string
  receipt_url?: string
  paid_at: string
}

function BillingContent() {
  const searchParams = useSearchParams()
  const { confirm, showError } = useModal()
  const [loading, setLoading] = useState(true)
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null)
  const [usage, setUsage] = useState<UsageInfo | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false)
  const [cancelLoading, setCancelLoading] = useState(false)
  const [rejectionInfo, setRejectionInfo] = useState<MpRejectionInfo | null>(null)

  const success = searchParams.get("success") === "true"
  const canceled = searchParams.get("canceled") === "true"
  const mpSuccess = searchParams.get("mp_success") === "true"
  const mpFailure = searchParams.get("mp_failure") === "true"
  const lsSuccess = searchParams.get("ls_success") === "true"
  // MP agrega payment_id al back_url, pero NO el status_detail. Lo buscamos
  // para mostrar el motivo real del rechazo y qué puede hacer el usuario.
  const mpPaymentId = searchParams.get("payment_id")

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (!mpFailure || !mpPaymentId) return
    let cancelled = false
    fetch(`/api/mercadopago/payment-status?payment_id=${encodeURIComponent(mpPaymentId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        if (data.status === "rejected") {
          setRejectionInfo(getMpRejectionInfo(data.statusDetail))
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [mpFailure, mpPaymentId])

  const loadData = async () => {
    setLoading(true)
    try {
      // Cargar suscripción y uso
      const subResponse = await fetch("/api/subscriptions")
      const subData = await subResponse.json()
      setSubscription(subData.subscription)
      setUsage(subData.usage)
      setPlans(subData.plans)

      // Cargar historial de pagos
      const paymentsResponse = await fetch("/api/subscriptions/payments")
      const paymentsData = await paymentsResponse.json()
      setPayments(paymentsData.payments || [])
    } catch (error) {
      console.error("Error loading billing data:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleCancelSubscription = async () => {
    const confirmed = await confirm({
      title: "Cancelar Suscripción",
      description: "¿Estás seguro de que deseas cancelar tu suscripción? Mantendrás acceso hasta el final del período actual.",
      confirmText: "Sí, cancelar",
      cancelText: "No, mantener",
      variant: "warning",
    })

    if (!confirmed) return

    setCancelLoading(true)
    try {
      const response = await fetch("/api/subscriptions/cancel", {
        method: "POST",
      })
      const data = await response.json()
      if (data.success) {
        await loadData()
      } else {
        await showError(data.error || "Error al cancelar suscripción")
      }
    } catch (error) {
      console.error("Error canceling subscription:", error)
      await showError("Error al cancelar suscripción")
    } finally {
      setCancelLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 sm:gap-4">
        <Link href="/configuracion">
          <Button variant="ghost" size="icon" className="shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Facturación</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Gestiona tu suscripción y pagos
          </p>
        </div>
      </div>

      {/* Success/Error messages */}
      {(success || mpSuccess || lsSuccess) && (
        <div className="bg-green-50 dark:bg-green-950/50 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 px-3 sm:px-4 py-2 sm:py-3 rounded-lg flex items-center gap-2">
          <CheckCircle className="h-4 w-4 sm:h-5 sm:w-5 shrink-0" />
          <div>
            <p className="font-medium text-sm">¡Pago exitoso!</p>
            <p className="text-xs sm:text-sm">
              Tu suscripción Premium ha sido activada.
            </p>
          </div>
        </div>
      )}

      {(canceled || mpFailure) && (
        <div className="bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-3 sm:px-4 py-2 sm:py-3 rounded-lg flex items-start gap-2">
          <XCircle className="h-4 w-4 sm:h-5 sm:w-5 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-sm">
              {canceled
                ? "Pago cancelado"
                : rejectionInfo
                  ? rejectionInfo.title
                  : "No pudimos procesar el pago"}
            </p>
            <p className="text-xs sm:text-sm">
              {canceled
                ? "Puedes intentarlo de nuevo cuando quieras."
                : rejectionInfo
                  ? rejectionInfo.message
                  : "El pago no se completó. Intentá de nuevo o usá otro medio de pago."}
            </p>
            {mpFailure && (
              <Button
                size="sm"
                variant="outline"
                className="mt-2 h-8 border-red-300 dark:border-red-800"
                onClick={() => setUpgradeModalOpen(true)}
              >
                Reintentar pago
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <CurrentPlan
          subscription={subscription}
          onUpgrade={() => setUpgradeModalOpen(true)}
          onManage={() => {}}
          onCancel={handleCancelSubscription}
        />

        {subscription && usage && (
          <UsageStats
            usage={usage}
            limits={subscription.limits}
            planType={subscription.planTipo}
          />
        )}
      </div>

      {/* Payment history */}
      <PaymentHistory payments={payments} />

      {/* Upgrade modal */}
      <UpgradeModal
        open={upgradeModalOpen}
        onClose={() => setUpgradeModalOpen(false)}
      />
    </div>
  )
}

export default function BillingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <BillingContent />
    </Suspense>
  )
}
