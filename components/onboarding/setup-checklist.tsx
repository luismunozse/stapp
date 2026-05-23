"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  CheckCircle2,
  Circle,
  Users,
  Package,
  ClipboardList,
  Image as ImageIcon,
  Sparkles,
  Loader2,
  Rocket,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface OnboardingStatus {
  hasClients: boolean
  hasProducts: boolean
  hasFirstOrder: boolean
  hasLogo: boolean
  completionPct: number
}

type IconType = typeof Users

interface ChecklistItem {
  key: keyof Omit<OnboardingStatus, "completionPct">
  label: string
  description: string
  href: string
  icon: IconType
  optional?: boolean
}

const ITEMS: ChecklistItem[] = [
  {
    key: "hasClients",
    label: "Cargá tu primer cliente",
    description: "Empezá registrando a quién le hacés el servicio",
    href: "/clientes?nuevo=1",
    icon: Users,
  },
  {
    key: "hasProducts",
    label: "Cargá tu primer producto o servicio",
    description: "Sumá lo que vendés o usás como repuesto",
    href: "/inventario?nuevo=1",
    icon: Package,
  },
  {
    key: "hasFirstOrder",
    label: "Creá tu primera orden",
    description: "El corazón del taller: registrá una reparación",
    href: "/ordenes?nueva=1",
    icon: ClipboardList,
  },
  {
    key: "hasLogo",
    label: "Personalizá tu logo",
    description: "Para que tus tickets y recibos tengan tu marca",
    href: "/configuracion",
    icon: ImageIcon,
    optional: true,
  },
]

export function SetupChecklist() {
  const router = useRouter()
  const [status, setStatus] = useState<OnboardingStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [seedError, setSeedError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch("/api/onboarding/status", { cache: "no-store" })
        if (!res.ok) return
        const data: OnboardingStatus = await res.json()
        if (!cancelled) setStatus(data)
      } catch {
        // silencioso: si falla, no mostramos checklist
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const handleSeed = async () => {
    setSeeding(true)
    setSeedError(null)
    try {
      const res = await fetch("/api/onboarding/seed-demo-data", {
        method: "POST",
      })
      const data = await res.json()
      if (!res.ok) {
        setSeedError(data?.error || "No se pudieron cargar los datos de ejemplo")
        return
      }
      setConfirmOpen(false)
      // refrescar dashboard y volver a pedir status
      router.refresh()
      const fresh = await fetch("/api/onboarding/status", { cache: "no-store" })
      if (fresh.ok) setStatus(await fresh.json())
    } catch (err) {
      setSeedError("Error de red. Probá de nuevo.")
    } finally {
      setSeeding(false)
    }
  }

  if (loading || !status) return null
  if (status.completionPct >= 100) return null

  const isBrandNew = status.completionPct === 0

  return (
    <>
      <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-blue-500/5 dark:from-primary/10 dark:to-blue-500/10">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-primary/10 p-2 shrink-0">
                <Rocket className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">
                  {isBrandNew
                    ? "Empecemos a configurar tu taller"
                    : "Te falta poco para tener todo listo"}
                </CardTitle>
                <CardDescription>
                  {isBrandNew
                    ? "Te guiamos paso a paso. En 5 minutos lo tenés andando."
                    : `${status.completionPct}% completado — seguí desde donde lo dejaste.`}
                </CardDescription>
              </div>
            </div>
            {isBrandNew && (
              <Button
                onClick={() => setConfirmOpen(true)}
                size="sm"
                className="gap-2 shrink-0"
              >
                <Sparkles className="h-4 w-4" />
                Cargar datos de ejemplo
              </Button>
            )}
          </div>

          {/* Barra de progreso */}
          <div className="mt-4 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500"
              style={{ width: `${status.completionPct}%` }}
              aria-label={`${status.completionPct}% completado`}
            />
          </div>
        </CardHeader>

        <CardContent className="space-y-2">
          {ITEMS.map((item) => {
            const done = status[item.key]
            const Icon = item.icon
            return (
              <Link
                key={item.key}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg transition-colors group",
                  done
                    ? "bg-green-50 dark:bg-green-900/20"
                    : "bg-card hover:bg-muted border border-border/50"
                )}
              >
                <div
                  className={cn(
                    "flex items-center justify-center h-9 w-9 rounded-full shrink-0",
                    done
                      ? "bg-green-100 dark:bg-green-800/40 text-green-600 dark:text-green-400"
                      : "bg-primary/10 text-primary"
                  )}
                >
                  {done ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    <Icon className="h-5 w-5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-sm font-medium flex items-center gap-2",
                      done
                        ? "text-green-700 dark:text-green-400 line-through"
                        : "text-foreground"
                    )}
                  >
                    {item.label}
                    {item.optional && !done && (
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-normal">
                        opcional
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.description}
                  </p>
                </div>
                {!done && (
                  <span className="text-xs font-medium text-primary shrink-0 group-hover:translate-x-0.5 transition-transform">
                    Ir →
                  </span>
                )}
                {done && (
                  <Circle className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0 fill-current" />
                )}
              </Link>
            )
          })}
        </CardContent>
      </Card>

      {/* Modal de confirmación seed */}
      <Dialog open={confirmOpen} onOpenChange={(o) => !seeding && setConfirmOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Cargar datos de ejemplo
            </DialogTitle>
            <DialogDescription className="pt-2">
              Esto va a cargar datos de ejemplo en tu cuenta para que puedas
              ver cómo funciona el sistema:
            </DialogDescription>
          </DialogHeader>

          <ul className="text-sm text-muted-foreground space-y-1.5 pl-4 list-disc">
            <li>3 clientes (Juan Pérez, Laura Gómez, Servicio Express SRL)</li>
            <li>5 productos típicos de taller (cargadores, baterías, vidrio templado, etc.)</li>
            <li>2 órdenes de servicio en distintos estados</li>
          </ul>

          <p className="text-xs text-muted-foreground">
            Todos los items quedan marcados con <code className="bg-muted px-1 py-0.5 rounded text-[11px]">[demo]</code>{" "}
            para que los puedas identificar y borrar después cuando quieras.
          </p>

          {seedError && (
            <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded">
              {seedError}
            </p>
          )}

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
              disabled={seeding}
            >
              Cancelar
            </Button>
            <Button onClick={handleSeed} disabled={seeding} className="gap-2">
              {seeding && <Loader2 className="h-4 w-4 animate-spin" />}
              {seeding ? "Cargando..." : "Sí, cargar datos de ejemplo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
