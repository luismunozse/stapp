"use client"

import { Button } from "@/components/ui/button"
import { Download } from "lucide-react"

interface ExportButtonProps {
  fecha: string
  /** Phones: icon only, to sit in the date row instead of taking a row of its own. */
  iconOnly?: boolean
  className?: string
}

export function ExportButton({ fecha, iconOnly = false, className }: ExportButtonProps) {
  const handleExport = () => {
    window.open(`/api/caja/export?fecha=${fecha}`, "_blank")
  }

  return (
    <Button variant="outline" size="sm" onClick={handleExport} className={className} aria-label="Exportar CSV">
      <Download className={iconOnly ? "h-4 w-4" : "mr-2 h-4 w-4"} />
      {!iconOnly && "Exportar CSV"}
    </Button>
  )
}
