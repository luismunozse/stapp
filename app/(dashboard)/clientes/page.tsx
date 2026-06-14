"use client"

import { useState } from "react"
import { ClientesList } from "@/components/clientes/clientes-list"
import { ClientesSegmentacion } from "@/components/clientes/clientes-segmentacion"
import { Button } from "@/components/ui/button"
import { PieChart } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"

export default function ClientesPage() {
  const [showSegmentacion, setShowSegmentacion] = useState(false)

  return (
    <PageShell
      title="Clientes"
      description="Gestiona tus clientes y su información"
      actions={
        <Button variant="outline" onClick={() => setShowSegmentacion(true)} className="gap-1.5 w-full sm:w-auto">
          <PieChart className="h-4 w-4" />
          Segmentación
        </Button>
      }
    >
      <ClientesList />

      <ClientesSegmentacion open={showSegmentacion} onOpenChange={setShowSegmentacion} />
    </PageShell>
  )
}
