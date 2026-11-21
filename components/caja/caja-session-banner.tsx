"use client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { LockOpen, Lock, Loader2 } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { formatTimeValue } from "@/lib/timezone"

interface SesionInfo {
  id: string
  saldoInicial: number
  openedAt: string
  usuarioApertura?: { id: string; nombre: string } | null
}

interface CajaSessionBannerProps {
  sesion: SesionInfo | null
  loading?: boolean
  onAbrir: () => void
  onCerrar: () => void
}

export function CajaSessionBanner({ sesion, loading, onAbrir, onCerrar }: CajaSessionBannerProps) {
  const { formatPrice, timezone } = useCurrency()

  if (loading) {
    return (
      <div className="flex items-center justify-center p-3 rounded-lg bg-muted">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        <span className="text-sm">Cargando estado de caja...</span>
      </div>
    )
  }

  if (!sesion) {
    return (
      <div className="flex flex-row items-center justify-between gap-3 p-3 sm:p-4 rounded-lg border-2 border-warning/40 dark:border-warning/30 bg-warning-50 dark:bg-warning/10">
        <div className="flex min-w-0 items-center gap-3">
          <div className="hidden sm:block p-2 rounded-full bg-warning-100 dark:bg-warning/20">
            <Lock className="h-5 w-5 text-warning-600 dark:text-warning-400" />
          </div>
          <div>
            <span className="font-semibold text-warning-700 dark:text-warning-300">Caja cerrada</span>
            <p className="hidden sm:block text-xs text-warning-600 dark:text-warning-400">Abrí la caja para registrar movimientos del día</p>
          </div>
        </div>
        <Button onClick={onAbrir} size="sm" className="shrink-0 sm:h-10 sm:px-4">
          <LockOpen className="mr-2 h-4 w-4" />
          Abrir caja
        </Button>
      </div>
    )
  }

  // Formatear en la zona horaria de la organización (no la del entorno, que en
  // SSR/Vercel es UTC y mostraba la hora +3h). Ver lib/timezone.ts.
  const horaApertura = formatTimeValue(sesion.openedAt, timezone)

  return (
    <div className="flex flex-row items-center justify-between gap-3 p-3 sm:p-4 rounded-lg border-2 border-success/30 bg-success-50 dark:bg-success/15 dark:border-success/20">
      <div className="flex min-w-0 items-center gap-3">
        <LockOpen className="h-5 w-5 shrink-0 text-success-600" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium">Caja abierta</span>
            <Badge variant="outline" className="text-success-600 border-success-200">
              Desde {horaApertura}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Saldo inicial: {formatPrice(sesion.saldoInicial)}
            {sesion.usuarioApertura && ` · ${sesion.usuarioApertura.nombre}`}
          </p>
        </div>
      </div>
      <Button variant="outline" onClick={onCerrar} size="sm" className="shrink-0 sm:h-10 sm:px-4">
        <Lock className="mr-2 h-4 w-4" />
        Cerrar caja
      </Button>
    </div>
  )
}
