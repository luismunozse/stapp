"use client"

import { useState } from "react"
import { Loader2, Rocket } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { VerLoQueVeTuCliente } from "@/components/onboarding/ver-lo-que-ve-tu-cliente"
import type { PracticaOrden } from "@/lib/onboarding/practica-shared"

interface ListoStepProps {
  practica: PracticaOrden | null
  completando: boolean
  onCompletar: (destino: string) => void
}

const PRIMERA_ORDEN = "/ordenes?nueva=1"
const PANEL = "/dashboard"

export function ListoStep({ practica, completando, onCompletar }: ListoStepProps) {
  const [destino, setDestino] = useState<string | null>(null)
  const ir = (siguiente: string) => {
    setDestino(siguiente)
    onCompletar(siguiente)
  }

  return (
    <>
      <CardHeader className="pb-2 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
          <Rocket className="h-8 w-8 text-green-600 dark:text-green-400" aria-hidden="true" />
        </div>
        <CardTitle data-paso-titulo tabIndex={-1} className="text-2xl outline-none">
          ¡Listo! Ya viste cómo funciona
        </CardTitle>
        <CardDescription className="mt-2 text-base">
          Le mandamos el último email: la entrega quedó registrada.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        {practica && (
          <div className="flex justify-center">
            <VerLoQueVeTuCliente publicToken={practica.publicToken} />
          </div>
        )}
        <Button
          size="lg"
          className="h-auto min-h-11 w-full whitespace-normal py-3"
          onClick={() => ir(PRIMERA_ORDEN)}
          disabled={completando}
        >
          {completando && destino === PRIMERA_ORDEN && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          Cargar mi primera orden real
        </Button>
        <Button size="lg" variant="outline" className="w-full" onClick={() => ir(PANEL)} disabled={completando}>
          {completando && destino === PANEL && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          Ir al panel
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          La práctica queda en tu lista hasta que cargues tu primera orden real.
        </p>
      </CardContent>
    </>
  )
}
