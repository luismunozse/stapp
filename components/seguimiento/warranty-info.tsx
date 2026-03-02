"use client"

import { Shield, Calendar, Clock, CheckCircle2, AlertTriangle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface WarrantyInfoProps {
  garantia: {
    diasValidez: number
    fechaInicio: string
    fechaVencimiento: string
    estado: string
    diasRestantes: number
    notas: string | null
  }
  timezone?: string
}

function formatDate(dateStr: string, timezone?: string) {
  try {
    return new Intl.DateTimeFormat("es-AR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      timeZone: timezone || "America/Argentina/Buenos_Aires",
    }).format(new Date(dateStr))
  } catch {
    return dateStr
  }
}

export function WarrantyInfo({ garantia, timezone }: WarrantyInfoProps) {
  const isActive = garantia.estado === "ACTIVA"
  const isExpiringSoon = isActive && garantia.diasRestantes <= 7
  const isExpired = garantia.estado === "VENCIDA" || garantia.diasRestantes <= 0

  return (
    <Card
      className={cn(
        "border",
        isActive && !isExpiringSoon && "border-green-200 dark:border-green-800",
        isExpiringSoon && "border-amber-200 dark:border-amber-800",
        isExpired && "border-red-200 dark:border-red-800"
      )}
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Shield
            className={cn(
              "h-5 w-5",
              isActive && !isExpiringSoon && "text-green-600",
              isExpiringSoon && "text-amber-600",
              isExpired && "text-red-600"
            )}
          />
          Garantía de reparación
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          className={cn(
            "rounded-lg p-4",
            isActive && !isExpiringSoon && "bg-green-50 dark:bg-green-950/50",
            isExpiringSoon && "bg-amber-50 dark:bg-amber-950/50",
            isExpired && "bg-red-50 dark:bg-red-950/50"
          )}
        >
          {isActive && !isExpiringSoon && (
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <span className="font-medium text-green-700 dark:text-green-300">
                Garantía vigente
              </span>
            </div>
          )}
          {isExpiringSoon && (
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              <span className="font-medium text-amber-700 dark:text-amber-300">
                Garantía por vencer
              </span>
            </div>
          )}
          {isExpired && (
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              <span className="font-medium text-red-700 dark:text-red-300">
                Garantía vencida
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-muted-foreground">Duración</p>
                <p className="font-medium">{garantia.diasValidez} días</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-muted-foreground">
                  {isActive ? "Días restantes" : "Venció"}
                </p>
                <p className="font-medium">
                  {isActive ? `${garantia.diasRestantes} días` : formatDate(garantia.fechaVencimiento, timezone)}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-3 text-xs text-muted-foreground">
            <p>Desde: {formatDate(garantia.fechaInicio, timezone)}</p>
            <p>Hasta: {formatDate(garantia.fechaVencimiento, timezone)}</p>
          </div>
        </div>

        {garantia.notas && (
          <p className="text-sm text-muted-foreground">{garantia.notas}</p>
        )}
      </CardContent>
    </Card>
  )
}
