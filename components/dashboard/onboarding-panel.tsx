"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Settings, Users, ClipboardList, CheckCircle2, Rocket } from "lucide-react"
import { cn } from "@/lib/utils"

const ONBOARDING_DISMISSED_KEY = "stapp-onboarding-dismissed"

interface OnboardingStep {
  key: string
  label: string
  description: string
  href: string
  icon: typeof Settings
  completed: boolean
}

interface OnboardingPanelProps {
  hasConfig: boolean
  hasTecnicos: boolean
  hasOrdenes: boolean
}

export function OnboardingPanel({ hasConfig, hasTecnicos, hasOrdenes }: OnboardingPanelProps) {
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    const val = localStorage.getItem(ONBOARDING_DISMISSED_KEY)
    setDismissed(val === "1")
  }, [])

  if (dismissed || hasOrdenes) return null

  const steps: OnboardingStep[] = [
    {
      key: "config",
      label: "Configurar tu local",
      description: "Nombre, logo, datos de contacto",
      href: "/configuracion",
      icon: Settings,
      completed: hasConfig,
    },
    {
      key: "tecnico",
      label: "Agregar tu primer técnico",
      description: "Asigná órdenes a tu equipo",
      href: "/tecnicos",
      icon: Users,
      completed: hasTecnicos,
    },
    {
      key: "orden",
      label: "Crear tu primera orden",
      description: "Registrá un equipo en servicio",
      href: "/ordenes?nueva=1",
      icon: ClipboardList,
      completed: hasOrdenes,
    },
  ]

  const completedCount = steps.filter((s) => s.completed).length
  const progressPct = Math.round((completedCount / steps.length) * 100)

  const handleDismiss = () => {
    localStorage.setItem(ONBOARDING_DISMISSED_KEY, "1")
    setDismissed(true)
  }

  return (
    <Card className="border-primary/30 bg-primary/5 dark:bg-primary/10">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Rocket className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Primeros pasos</CardTitle>
          </div>
          <Button variant="ghost" size="sm" onClick={handleDismiss} className="text-xs text-muted-foreground">
            Ocultar
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">Completá estos pasos para empezar a usar GuruTech</p>
        {/* Barra de progreso */}
        <div className="mt-3 h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground mt-1">{completedCount} de {steps.length} completados</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {steps.map((step, idx) => {
          const Icon = step.icon
          return (
            <Link key={step.key} href={step.href}>
              <div className={cn(
                "flex items-center gap-3 p-3 rounded-lg transition-colors",
                step.completed
                  ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400"
                  : "bg-card hover:bg-muted"
              )}>
                <div className={cn(
                  "flex items-center justify-center h-8 w-8 rounded-full text-sm font-bold shrink-0",
                  step.completed
                    ? "bg-green-100 dark:bg-green-800 text-green-600 dark:text-green-400"
                    : "bg-primary/10 text-primary"
                )}>
                  {step.completed ? <CheckCircle2 className="h-5 w-5" /> : idx + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm font-medium", step.completed && "line-through")}>{step.label}</p>
                  <p className="text-xs text-muted-foreground">{step.description}</p>
                </div>
                {!step.completed && (
                  <span className="text-xs text-primary font-medium shrink-0">Ir →</span>
                )}
              </div>
            </Link>
          )
        })}
      </CardContent>
    </Card>
  )
}
