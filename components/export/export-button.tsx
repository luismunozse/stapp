"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Download, Loader2, Crown } from "lucide-react"
import { UpgradeModal } from "@/components/billing/upgrade-modal"
import { useSubscription } from "@/hooks/use-subscription"
import { downloadCSV } from "@/lib/csv-export"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export type ExportEntity =
  | "ordenes"
  | "ventas"
  | "clientes"
  | "inventario"
  | "garantias"

interface ExportButtonProps {
  entity: ExportEntity
  filters?: Record<string, string>
  label?: string
  variant?: "default" | "outline" | "ghost"
  size?: "default" | "sm" | "lg" | "icon"
  className?: string
}

const ENTITY_LABELS: Record<ExportEntity, string> = {
  ordenes: "órdenes",
  ventas: "ventas",
  clientes: "clientes",
  inventario: "inventario",
  garantias: "garantías",
}

/**
 * Botón de exportación a CSV
 * Muestra UpgradeModal si el usuario no es Premium
 */
export function ExportButton({
  entity,
  filters = {},
  label,
  variant = "outline",
  size = "default",
  className,
}: ExportButtonProps) {
  const { isPremium, loading: loadingSubscription } = useSubscription()
  const [loading, setLoading] = useState(false)
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleExport = async () => {
    setError(null)

    // Si no es premium, mostrar modal de upgrade
    if (!isPremium) {
      setShowUpgrade(true)
      return
    }

    setLoading(true)

    try {
      // Construir URL con filtros
      const params = new URLSearchParams(filters)
      const url = `/api/export/${entity}?${params.toString()}`

      const response = await fetch(url)

      if (!response.ok) {
        const data = await response.json()
        if (data.code === "PREMIUM_REQUIRED") {
          setShowUpgrade(true)
          return
        }
        throw new Error(data.error || "Error al exportar")
      }

      // Obtener el contenido CSV
      const csvContent = await response.text()

      // Obtener nombre de archivo del header o generar uno
      const disposition = response.headers.get("Content-Disposition")
      let filename = `${entity}_export.csv`
      if (disposition) {
        const match = disposition.match(/filename="(.+)"/)
        if (match) filename = match[1]
      }

      // Descargar archivo
      downloadCSV(csvContent, filename)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al exportar")
      console.error("Export error:", err)
    } finally {
      setLoading(false)
    }
  }

  const buttonLabel = label || `Exportar ${ENTITY_LABELS[entity]}`
  const isDisabled = loading || loadingSubscription

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={variant}
              size={size}
              onClick={handleExport}
              disabled={isDisabled}
              className={className}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              {size === "icon" ? null : buttonLabel}
              {!isPremium && !loadingSubscription && (
                <Crown className="h-3 w-3 ml-1 text-yellow-500" />
              )}
            </Button>
          </TooltipTrigger>
          {!isPremium && !loadingSubscription && (
            <TooltipContent>
              <p>Función Premium - Haz clic para desbloquear</p>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>

      {error && (
        <p className="text-sm text-red-500 mt-1">{error}</p>
      )}

      <UpgradeModal open={showUpgrade} onClose={() => setShowUpgrade(false)} />
    </>
  )
}
