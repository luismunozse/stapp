"use client"

import Link from "next/link"
import { Lock, Crown, Check, ArrowRight } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface FeatureLockedViewProps {
  // Nombre de la feature mostrada en el banner (ej. "Reportes avanzados").
  featureName: string
  // Descripcion corta de para qué sirve.
  description: string
  // Lista de bullets concretos que el usuario obtiene al upgrade.
  benefits: string[]
  // Slug del plan target (default profesional). Llega como query a billing.
  targetPlanSlug?: string
  // Identificador interno opcional, para tracking/redirect.
  upgradeKey?: string
  className?: string
}

export function FeatureLockedView({
  featureName,
  description,
  benefits,
  targetPlanSlug = "profesional",
  upgradeKey,
  className,
}: FeatureLockedViewProps) {
  const billingHref = upgradeKey
    ? `/configuracion/billing?upgrade=${encodeURIComponent(upgradeKey)}&plan=${targetPlanSlug}`
    : `/configuracion/billing?plan=${targetPlanSlug}`

  return (
    <div className={cn("max-w-2xl mx-auto", className)}>
      <Card className="border-amber-200 dark:border-amber-800 overflow-hidden">
        <div className="bg-gradient-to-r from-amber-100 to-yellow-50 dark:from-amber-950/40 dark:to-yellow-950/30 px-6 py-8 text-center border-b border-amber-200 dark:border-amber-800">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-full bg-amber-200 dark:bg-amber-900/60 mb-3">
            <Lock className="h-7 w-7 text-amber-700 dark:text-amber-300" />
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-amber-900 dark:text-amber-100">
            {featureName} es una función Profesional
          </h2>
          <p className="text-sm sm:text-base text-amber-800 dark:text-amber-200/90 mt-2 max-w-md mx-auto">
            {description}
          </p>
        </div>

        <CardContent className="p-6 space-y-5">
          <div>
            <h3 className="text-sm font-semibold mb-3 text-foreground">
              Al pasarte a Profesional obtenés:
            </h3>
            <ul className="space-y-2">
              {benefits.map((b) => (
                <li key={b} className="flex items-start gap-2 text-sm">
                  <Check className="h-4 w-4 text-green-600 dark:text-green-500 shrink-0 mt-0.5" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 pt-3 border-t">
            <Link href={billingHref} className="flex-1">
              <Button className="w-full bg-amber-600 hover:bg-amber-700 text-white" size="lg">
                <Crown className="h-4 w-4 mr-2" />
                Ver planes
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
            <Link href="/dashboard" className="sm:w-auto">
              <Button variant="outline" size="lg" className="w-full">
                Volver al dashboard
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
