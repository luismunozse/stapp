"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, X, ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"

interface UsageData {
  usage: {
    ordenesMesActual: number
    tecnicos: number
    vendedores: number
    clientes: number
    storageMb: number
  }
  limits: {
    ordenes: number | null
    tecnicos: number | null
    vendedores: number | null
    clientes: number | null
    storageMb: number | null
  }
  percentages: {
    ordenes: number | null
    tecnicos: number | null
    clientes: number | null
    storage: number | null
  }
  planType: "FREE" | "PREMIUM"
}

interface Warning {
  key: string
  label: string
  current: number
  limit: number
  percentage: number
}

const LABELS: Record<string, string> = {
  ordenes: "órdenes este mes",
  tecnicos: "técnicos",
  vendedores: "vendedores",
  clientes: "clientes",
  storage: "almacenamiento (MB)",
}

const WARNING_THRESHOLD = 80
const CRITICAL_THRESHOLD = 95
const DISMISS_KEY = "stapp-usage-warning-dismissed"

export function UsageWarningBanner() {
  const [warnings, setWarnings] = useState<Warning[]>([])
  const [dismissed, setDismissed] = useState<Record<string, number>>({})
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DISMISS_KEY)
      if (raw) setDismissed(JSON.parse(raw))
    } catch {}

    fetch("/api/subscriptions/usage", { cache: "no-store" })
      .then(r => (r.ok ? r.json() : null))
      .then((data: UsageData | null) => {
        if (!data || data.planType === "PREMIUM") {
          setLoaded(true)
          return
        }

        const found: Warning[] = []
        const push = (key: string, current: number, limit: number | null) => {
          if (limit === null || limit <= 0) return
          const pct = Math.round((current / limit) * 100)
          if (pct >= WARNING_THRESHOLD) {
            found.push({ key, label: LABELS[key], current, limit, percentage: pct })
          }
        }

        push("ordenes", data.usage.ordenesMesActual, data.limits.ordenes)
        push("clientes", data.usage.clientes, data.limits.clientes)
        push("tecnicos", data.usage.tecnicos, data.limits.tecnicos)
        push("vendedores", data.usage.vendedores, data.limits.vendedores)
        push("storage", Math.round(data.usage.storageMb), data.limits.storageMb)

        setWarnings(found)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  if (!loaded || warnings.length === 0) return null

  // Dismissable siempre. Críticas re-aparecen tras 4h, advertencias tras 24h.
  const visible = warnings.filter(w => {
    const dismissTs = dismissed[w.key]
    if (!dismissTs) return true
    const reshowMs = w.percentage >= CRITICAL_THRESHOLD ? 4 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000
    return Date.now() - dismissTs > reshowMs
  })

  if (visible.length === 0) return null

  const dismiss = (key: string) => {
    const next = { ...dismissed, [key]: Date.now() }
    setDismissed(next)
    try {
      sessionStorage.setItem(DISMISS_KEY, JSON.stringify(next))
    } catch {}
  }

  // Mostrar la más crítica primero
  const sorted = [...visible].sort((a, b) => b.percentage - a.percentage)
  const top = sorted[0]
  const isCritical = top.percentage >= CRITICAL_THRESHOLD

  // Padding derecho en lg para no quedar debajo del toolbar fijo top-3 right-4
  // que contiene PlanBadge + GlobalSearch + DeadlineCalendar + Notif + Theme + Avatar.
  return (
    <div
      className={cn(
        "w-full pl-4 pr-3 lg:pr-[34rem] py-1.5 border-b flex items-center gap-2 sm:gap-3 text-xs",
        isCritical
          ? "bg-red-50/70 dark:bg-red-950/20 border-red-200/70 dark:border-red-900/40 text-red-900 dark:text-red-200"
          : "bg-amber-50/70 dark:bg-amber-950/20 border-amber-200/70 dark:border-amber-900/40 text-amber-900 dark:text-amber-200"
      )}
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <div className="flex-1 min-w-0 truncate">
        <span className="font-medium">
          {isCritical ? "Límite alcanzado: " : "Aviso: "}
        </span>
        <span>
          <strong>{top.current}/{top.limit}</strong> {top.label}
          <span className="hidden sm:inline"> ({top.percentage}%) — plan Free</span>
          {sorted.length > 1 && (
            <span className="hidden md:inline"> · +{sorted.length - 1} más</span>
          )}
        </span>
      </div>
      <Link
        href="/configuracion/billing"
        className={cn(
          "inline-flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-md font-semibold text-xs shrink-0 transition-colors",
          isCritical
            ? "bg-red-600 hover:bg-red-700 text-white"
            : "bg-amber-600 hover:bg-amber-700 text-white"
        )}
      >
        <span className="hidden sm:inline">Ver planes</span>
        <span className="sm:hidden">Upgrade</span>
        <ArrowRight className="h-3 w-3" />
      </Link>
      <button
        onClick={() => dismiss(top.key)}
        className="opacity-60 hover:opacity-100 shrink-0 p-0.5"
        aria-label="Cerrar aviso"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
