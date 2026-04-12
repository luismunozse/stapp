"use client"

import { useState } from "react"
import { InventarioList } from "@/components/inventario/inventario-list"
import { InventarioAnalytics } from "@/components/inventario/inventario-analytics"
import { Button } from "@/components/ui/button"
import { BarChart3 } from "lucide-react"

export default function InventarioPage() {
  const [showAnalytics, setShowAnalytics] = useState(false)

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Inventario</h1>
          <p className="text-sm text-muted-foreground">
            Gestiona el stock de repuestos, accesorios y productos
          </p>
        </div>
        <Button variant="outline" onClick={() => setShowAnalytics(true)} className="gap-1.5 w-full sm:w-auto">
          <BarChart3 className="h-4 w-4" />
          Análisis
        </Button>
      </div>

      <InventarioList />

      <InventarioAnalytics open={showAnalytics} onOpenChange={setShowAnalytics} />
    </div>
  )
}
