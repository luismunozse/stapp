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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Clientes</h1>
          <p className="text-muted-foreground">
            Gestiona tus clientes y su información
          </p>
        </div>
        <Button variant="outline" onClick={() => setShowSegmentacion(true)} className="gap-1.5">
          <PieChart className="h-4 w-4" />
          Segmentación
        </Button>
      </div>

      <ClientesList />

      <ClientesSegmentacion open={showSegmentacion} onOpenChange={setShowSegmentacion} />
    </div>
  )
}
