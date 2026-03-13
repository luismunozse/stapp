"use client"

import { useState } from "react"
import { VentasList } from "@/components/ventas/ventas-list"
import { VentasDashboard } from "@/components/ventas/ventas-dashboard"
import { GarantiasVentasPanel } from "@/components/ventas/garantias-ventas-panel"
import { Button } from "@/components/ui/button"
import { Shield } from "lucide-react"

export default function VentasPage() {
  const [showGarantias, setShowGarantias] = useState(false)

  return (
    <div className="container py-6 space-y-6">
      <VentasDashboard />

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setShowGarantias(true)} className="gap-1.5">
          <Shield className="h-4 w-4" />
          Gestión de Garantías
        </Button>
      </div>

      <VentasList />

      <GarantiasVentasPanel open={showGarantias} onOpenChange={setShowGarantias} />
    </div>
  )
}
