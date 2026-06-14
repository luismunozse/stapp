"use client"

import { useState } from "react"
import { InventarioList } from "@/components/inventario/inventario-list"
import { InventarioAnalytics } from "@/components/inventario/inventario-analytics"
import { Button } from "@/components/ui/button"
import { BarChart3 } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"

export default function InventarioPage() {
  const [showAnalytics, setShowAnalytics] = useState(false)

  return (
    <PageShell
      title="Inventario"
      description="Gestiona el stock de repuestos, accesorios y productos"
      actions={
        <Button variant="outline" onClick={() => setShowAnalytics(true)} className="gap-1.5 flex-1 sm:flex-none">
          <BarChart3 className="h-4 w-4" />
          Análisis
        </Button>
      }
    >
      <InventarioList />

      <InventarioAnalytics open={showAnalytics} onOpenChange={setShowAnalytics} />
    </PageShell>
  )
}
