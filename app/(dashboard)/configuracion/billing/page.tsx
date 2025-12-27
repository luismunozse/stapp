"use client"

import { useState, useEffect } from "react"
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

export default function BillingPage() {
  const searchParams = useSearchParams()
  const { confirm, showError } = useModal()
  const [loading, setLoading] = useState(true)
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null)
  const [usage, setUsage] = useState<UsageInfo | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false)
  const [cancelLoading, setCancelLoading] = useState(false)

  const success = searchParams.get("success") === "true"
  const canceled = searchParams.get("canceled") === "true"
  const mpSuccess = searchParams.get("mp_success") === "true"
  const mpFailure = searchParams.get("mp_failure") === "true"

  useEffect(() => {
    loadData()
  }, [])

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

  const handleManageBilling = async () => {
    try {
      const response = await fetch("/api/stripe/portal", {
        method: "POST",
      })
      const data = await response.json()
      if (data.url) {
        window.location.href = data.url
      }
    } catch (error) {
      console.error("Error opening billing portal:", error)
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/configuracion">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Facturación</h1>
          <p className="text-muted-foreground">
            Gestiona tu suscripción y pagos
          </p>
        </div>
      </div>

      {/* Success/Error messages */}
      {(success || mpSuccess) && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg flex items-center gap-2">
          <CheckCircle className="h-5 w-5" />
          <div>
            <p className="font-medium">¡Pago exitoso!</p>
            <p className="text-sm">
              Tu suscripción Premium ha sido activada correctamente.
            </p>
          </div>
        </div>
      )}

      {(canceled || mpFailure) && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
          <XCircle className="h-5 w-5" />
          <div>
            <p className="font-medium">Pago cancelado</p>
            <p className="text-sm">
              El proceso de pago fue cancelado. Puedes intentarlo de nuevo cuando quieras.
            </p>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CurrentPlan
          subscription={subscription}
          onUpgrade={() => setUpgradeModalOpen(true)}
          onManage={handleManageBilling}
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
