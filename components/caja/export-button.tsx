"use client"

import { Button } from "@/components/ui/button"
import { Download } from "lucide-react"

interface ExportButtonProps {
  fecha: string
}

export function ExportButton({ fecha }: ExportButtonProps) {
  const handleExport = () => {
    window.open(`/api/caja/export?fecha=${fecha}`, "_blank")
  }

  return (
    <Button variant="outline" size="sm" onClick={handleExport}>
      <Download className="mr-2 h-4 w-4" />
      Exportar CSV
    </Button>
  )
}
