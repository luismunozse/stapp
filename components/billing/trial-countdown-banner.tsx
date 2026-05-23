"use client"

/**
 * Trial Countdown Banner
 *
 * Banner contextual de top de dashboard que reacciona al estado de billing:
 *
 *  - Trial activo:        countdown con color según urgencia (verde/amarillo/rojo).
 *                         Dismissable por día (excepto crítico ≤3d, no dismissable).
 *  - Trial vencido:       banner rojo persistente con CTA a /reactivar.
 *  - Free (post-trial):   banner suave con CTA upgrade, dismissable permanente.
 *  - Paid (ACTIVE+provider): banner oculto.
 *
 * Diseñado para montarse en app/(dashboard)/layout.tsx después del Navbar y
 * antes del main content. Estilo aligned con el resto de banners del dashboard
 * (usage-warning-banner, maintenance-banner).
 */

import { useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { AlertTriangle, Clock, Sparkles, X, Zap } from "lucide-react"
import { cn } from "@/lib/utils"

interface SubResponse {
  subscription: {
    id?: string
    planSlug?: string
    planTipo?: "FREE" | "PREMIUM"
    status?: string
    paymentProvider?: string | null
  } | null
  trialInfo?: {
    isInTrial: boolean
    isTrialExpired: boolean
    trialEnd: string | null
    daysRemaining: number
    isPaid: boolean
  }
}

type BannerKind = "trial-active" | "trial-expired" | "free-nudge" | null

function todayKey(): string {
  // YYYY-MM-DD en local
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function TrialCountdownBanner() {
  const [loaded, setLoaded] = useState(false)
  const [orgId, setOrgId] = useState<string | null>(null)
  const [kind, setKind] = useState<BannerKind>(null)
  const [daysRemaining, setDaysRemaining] = useState<number>(0)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false

    fetch("/api/subscriptions", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: SubResponse | null) => {
        if (cancelled || !data) {
          setLoaded(true)
          return
        }

        const sub = data.subscription
        const trial = data.trialInfo
        const subId = sub?.id || null
        setOrgId(subId)

        // Paid: NO banner.
        const isPaid =
          trial?.isPaid ||
          (sub?.status === "ACTIVE" &&
            sub?.paymentProvider != null &&
            sub?.paymentProvider !== "MANUAL")
        if (isPaid) {
          setKind(null)
          setLoaded(true)
          return
        }

        // Trial expirado (incluye case daysRemaining===0 con isTrialExpired)
        if (trial?.isTrialExpired) {
          setKind("trial-expired")
          setDaysRemaining(0)
          setLoaded(true)
          return
        }

        // Trial activo
        if (trial?.isInTrial) {
          setKind("trial-active")
          setDaysRemaining(trial.daysRemaining)
          setLoaded(true)
          return
        }

        // Free (no en trial, sub ACTIVE manual o sin payment_provider)
        if (sub?.planSlug === "free" || sub?.planTipo === "FREE") {
          setKind("free-nudge")
          setLoaded(true)
          return
        }

        setKind(null)
        setLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setLoaded(true)
      })

    return () => {
      cancelled = true
    }
  }, [])

  // Resolver dismiss persistente al cambiar kind/orgId
  useEffect(() => {
    if (!loaded || !kind) return

    try {
      if (kind === "free-nudge" && orgId) {
        const key = `free_banner_dismissed_${orgId}`
        if (localStorage.getItem(key) === "1") {
          setDismissed(true)
          return
        }
      }

      if (kind === "trial-active" && daysRemaining > 3 && orgId) {
        const key = `trial_banner_dismissed_${orgId}_${todayKey()}`
        if (localStorage.getItem(key) === "1") {
          setDismissed(true)
          return
        }
      }

      setDismissed(false)
    } catch {
      setDismissed(false)
    }
  }, [loaded, kind, orgId, daysRemaining])

  if (!loaded || !kind || dismissed) return null

  // Trial expirado: no se puede dismiss
  if (kind === "trial-expired") {
    return (
      <div
        className="w-full pl-4 pr-3 lg:pr-[34rem] py-1.5 border-b flex items-center gap-2 sm:gap-3 text-xs bg-red-50/70 dark:bg-red-950/20 border-red-200/70 dark:border-red-900/40 text-red-900 dark:text-red-200"
        role="alert"
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <div className="flex-1 min-w-0 truncate">
          <span className="font-medium">Tu prueba venció — </span>
          <span>reactivá para seguir usando STApp sin restricciones.</span>
        </div>
        <Link
          href="/reactivar"
          className="inline-flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-md font-semibold text-xs shrink-0 bg-red-600 hover:bg-red-700 text-white transition-colors"
        >
          <Sparkles className="h-3 w-3" />
          <span>Reactivar</span>
        </Link>
      </div>
    )
  }

  // Free nudge: dismiss permanente
  if (kind === "free-nudge") {
    return (
      <div
        className="w-full pl-4 pr-3 lg:pr-[34rem] py-1.5 border-b flex items-center gap-2 sm:gap-3 text-xs bg-blue-50/70 dark:bg-blue-950/20 border-blue-200/70 dark:border-blue-900/40 text-blue-900 dark:text-blue-200"
        role="status"
      >
        <Zap className="h-3.5 w-3.5 shrink-0" />
        <div className="flex-1 min-w-0 truncate">
          <span className="font-medium">Estás en plan Free — </span>
          <span>actualizá a Profesional para desbloquear todas las features.</span>
        </div>
        <Link
          href="/configuracion/billing"
          className="inline-flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-md font-semibold text-xs shrink-0 bg-blue-600 hover:bg-blue-700 text-white transition-colors"
        >
          <Sparkles className="h-3 w-3" />
          <span>Ver Profesional</span>
        </Link>
        <button
          onClick={() => {
            if (orgId) {
              try {
                localStorage.setItem(`free_banner_dismissed_${orgId}`, "1")
              } catch {}
            }
            setDismissed(true)
          }}
          className="opacity-60 hover:opacity-100 shrink-0 p-0.5"
          aria-label="Cerrar aviso"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }

  // Trial active — color por urgencia
  const isCritical = daysRemaining <= 3
  const isUrgent = daysRemaining > 3 && daysRemaining <= 7

  const colorClass = isCritical
    ? "bg-red-50/70 dark:bg-red-950/20 border-red-200/70 dark:border-red-900/40 text-red-900 dark:text-red-200"
    : isUrgent
      ? "bg-amber-50/70 dark:bg-amber-950/20 border-amber-200/70 dark:border-amber-900/40 text-amber-900 dark:text-amber-200"
      : "bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-200/70 dark:border-emerald-900/40 text-emerald-900 dark:text-emerald-200"

  const ctaClass = isCritical
    ? "bg-red-600 hover:bg-red-700 text-white"
    : isUrgent
      ? "bg-amber-600 hover:bg-amber-700 text-white"
      : "bg-emerald-600 hover:bg-emerald-700 text-white"

  return (
    <div
      className={cn(
        "w-full pl-4 pr-3 lg:pr-[34rem] py-1.5 border-b flex items-center gap-2 sm:gap-3 text-xs",
        colorClass
      )}
      role={isCritical ? "alert" : "status"}
    >
      <Clock className="h-3.5 w-3.5 shrink-0" />
      <div className="flex-1 min-w-0 truncate">
        <span className="font-medium">
          {daysRemaining === 0
            ? "Tu prueba termina hoy"
            : daysRemaining === 1
              ? "Tu prueba termina mañana"
              : `Quedan ${daysRemaining} días de prueba`}
        </span>
        <span className="hidden sm:inline"> — activá Profesional para no perder acceso.</span>
      </div>
      <Link
        href="/configuracion/billing"
        className={cn(
          "inline-flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-md font-semibold text-xs shrink-0 transition-colors",
          ctaClass
        )}
      >
        <Sparkles className="h-3 w-3" />
        <span className="hidden sm:inline">Activar ahora</span>
        <span className="sm:hidden">Activar</span>
      </Link>
      {!isCritical && (
        <button
          onClick={() => {
            if (orgId) {
              try {
                localStorage.setItem(
                  `trial_banner_dismissed_${orgId}_${todayKey()}`,
                  "1"
                )
              } catch {}
            }
            setDismissed(true)
          }}
          className="opacity-60 hover:opacity-100 shrink-0 p-0.5"
          aria-label="Cerrar aviso"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
