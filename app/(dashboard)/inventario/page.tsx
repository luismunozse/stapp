"use client"

import { useState } from "react"
import Link from "next/link"
import { InventarioList } from "@/components/inventario/inventario-list"
import { InventarioAnalytics } from "@/components/inventario/inventario-analytics"
import { Button } from "@/components/ui/button"
import { BarChart3, FileSpreadsheet } from "lucide-react"

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
        <div className="flex gap-2 w-full sm:w-auto">
          <Link href="/inventario/importar-precios" className="flex-1 sm:flex-none">
            <Button variant="outline" className="gap-1.5 w-full">
              <FileSpreadsheet className="h-4 w-4" />
              Importar precios
            </Button>
          </Link>
          <Button variant="outline" onClick={() => setShowAnalytics(true)} className="gap-1.5 flex-1 sm:flex-none">
            <BarChart3 className="h-4 w-4" />
            Análisis
          </Button>
        </div>
      </div>

      <InventarioList />

      <InventarioAnalytics open={showAnalytics} onOpenChange={setShowAnalytics} />
    </div>
  )
}
