"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Download, Loader2, ChevronDown } from "lucide-react"
import { triggerDownload } from "@/lib/csv-export"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export type ExportEntity =
  | "ordenes"
  | "ventas"
  | "clientes"
  | "inventario"
  | "garantias"

type ExportFormat = "csv" | "xlsx"

interface ExportButtonProps {
  entity: ExportEntity
  filters?: Record<string, string>
  /**
   * Exportar solo estos ids en vez de todo lo que matchea los filtros.
   * Con selección se usa POST: una lista de cuids no entra en un query string.
   */
  ids?: string[]
  /** Juego de columnas alternativo del backend (ej: "pedido"). */
  preset?: string
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

const EMPTY_FILTERS: Record<string, string> = {}

/**
 * Botón de exportación de datos propios (CSV o Excel).
 * Portabilidad: disponible en cualquier plan, sin gate premium.
 */
export function ExportButton({
  entity,
  filters = EMPTY_FILTERS,
  ids,
  preset,
  label,
  variant = "outline",
  size = "default",
  className,
}: ExportButtonProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasSelection = Boolean(ids && ids.length > 0)

  const handleExport = async (format: ExportFormat) => {
    setError(null)
    setLoading(true)
    try {
      const response = hasSelection
        ? await fetch(`/api/export/${entity}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids, preset, format }),
          })
        : await fetch(
            `/api/export/${entity}?${new URLSearchParams({
              ...filters,
              ...(preset ? { preset } : {}),
              format,
            }).toString()}`
          )
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || "Error al exportar")
      }

      const disposition = response.headers.get("Content-Disposition")
      let filename = `${preset || entity}_export.${format}`
      if (disposition) {
        const match = disposition.match(/filename="(.+)"/)
        if (match) filename = match[1]
      }

      const blob = await response.blob()
      await triggerDownload(blob, filename)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al exportar")
      console.error("Export error:", err)
    } finally {
      setLoading(false)
    }
  }

  const buttonLabel = label || `Exportar ${ENTITY_LABELS[entity]}`

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={variant}
            size={size}
            disabled={loading}
            className={className}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            {size === "icon" ? null : buttonLabel}
            {size !== "icon" && <ChevronDown className="h-3 w-3 ml-1" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => handleExport("csv")}>
            CSV
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleExport("xlsx")}>
            Excel (.xlsx)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {error && <p className="text-sm text-red-500 mt-1">{error}</p>}
    </>
  )
}
