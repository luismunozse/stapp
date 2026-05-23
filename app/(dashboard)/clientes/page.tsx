"use client"

import { useState } from "react"
import { ClientesList } from "@/components/clientes/clientes-list"
import { ClientesSegmentacion } from "@/components/clientes/clientes-segmentacion"
import { Button } from "@/components/ui/button"
import { PieChart } from "lucide-react"

export default function ClientesPage() {
  const [showSegmentacion, setShowSegmentacion] = useState(false)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Clientes</h1>
          <p className="text-sm text-muted-foreground">
            Gestiona tus clientes y su información
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setShowSegmentacion(true)} className="gap-1.5 w-full sm:w-auto">
            <PieChart className="h-4 w-4" />
            Segmentación
          </Button>
        </div>
      </div>

      <ClientesList />

      <ClientesSegmentacion open={showSegmentacion} onOpenChange={setShowSegmentacion} />
    </div>
  )
}
