"use client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { LockOpen, Lock, Loader2 } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"

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
  const { formatPrice } = useCurrency()

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
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/50">
        <div className="flex items-center gap-2">
          <Lock className="h-5 w-5 text-muted-foreground" />
          <div>
            <span className="font-medium">Caja cerrada</span>
            <p className="text-xs text-muted-foreground">No hay sesión de caja abierta</p>
          </div>
        </div>
        <Button onClick={onAbrir} className="w-full sm:w-auto">
          <LockOpen className="mr-2 h-4 w-4" />
          Abrir Caja
        </Button>
      </div>
    )
  }

  const horaApertura = new Date(sesion.openedAt).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
  })

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 rounded-lg border-2 border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-800">
      <div className="flex items-center gap-3">
        <LockOpen className="h-5 w-5 text-green-600" />
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">Caja abierta</span>
            <Badge variant="outline" className="text-green-600 border-green-300">
              Desde {horaApertura}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Saldo inicial: {formatPrice(sesion.saldoInicial)}
            {sesion.usuarioApertura && ` · ${sesion.usuarioApertura.nombre}`}
          </p>
        </div>
      </div>
      <Button variant="outline" onClick={onCerrar} className="w-full sm:w-auto">
        <Lock className="mr-2 h-4 w-4" />
        Cerrar Caja
      </Button>
    </div>
  )
}
