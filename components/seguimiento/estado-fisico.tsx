"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { ScanSearch } from "lucide-react"
import { DiagramaDanos } from "@/components/ordenes/danos/diagrama-danos"
import { ListaDanos } from "@/components/ordenes/danos/lista-danos"
import type { PinVista } from "@/components/ordenes/danos/pin-vista"

export interface EstadoFisicoData {
  danos: PinVista[]
  sinDanos: boolean
  diagrama: string
}

/** Estado físico del equipo al recibirlo, solo lectura. Sin pins y sin "sin daños" no se muestra. */
export function EstadoFisico({ data }: { data: EstadoFisicoData }) {
  const [resaltado, setResaltado] = useState<number | null>(null)
  if (data.danos.length === 0 && !data.sinDanos) return null

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          <ScanSearch className="h-3.5 w-3.5" aria-hidden="true" />
          Estado físico
        </div>
        {data.danos.length === 0 ? (
          <p className="text-sm">El equipo se recibió sin daños visibles.</p>
        ) : (
          <>
            <DiagramaDanos
              diagrama={data.diagrama}
              pins={data.danos}
              editable={false}
              resaltado={resaltado}
              onSeleccionar={setResaltado}
            />
            <ListaDanos
              pins={data.danos}
              etiquetaDiagnostico="Detectado por el técnico"
              resaltado={resaltado}
              onSeleccionar={setResaltado}
            />
          </>
        )}
      </CardContent>
    </Card>
  )
}
