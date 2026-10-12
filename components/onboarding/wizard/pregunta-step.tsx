"use client"

import { useState } from "react"
import { ChevronLeft, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { articuloIndefinido, minusculaInicial, t, type Terminologia } from "@/lib/terminologia"

interface PreguntaStepProps {
  terminologia: Terminologia
  completando: boolean
  /** Real orders already loaded: the practice option no longer makes sense. */
  ordenesRealesCount: number
  onSi: () => void
  onPracticar: () => void
  onAtras: () => void
}

const BOTON_GRANDE = "h-auto min-h-11 w-full whitespace-normal py-3"

export function PreguntaStep({ terminologia, completando, ordenesRealesCount, onSi, onPracticar, onAtras }: PreguntaStepProps) {
  const [eligioSi, setEligioSi] = useState(false)
  const equipo = minusculaInicial(t(terminologia, "equipo"))
  const articulo = articuloIndefinido(equipo)
  const puedePracticar = ordenesRealesCount === 0
  const titulo = `¿Tenés ${articulo} ${equipo} para cargar ahora?`
  const si = `Sí, tengo ${articulo === "una" ? "una" : "uno"}`

  return (
    <>
      <CardHeader>
        <CardTitle data-paso-titulo tabIndex={-1} className="text-xl outline-none">
          {titulo}
        </CardTitle>
        <CardDescription>Si ya te dejaron algo para arreglar, cargalo directo: es la mejor forma de arrancar.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          size="lg"
          className={BOTON_GRANDE}
          onClick={() => {
            setEligioSi(true)
            onSi()
          }}
          disabled={completando}
        >
          {completando && eligioSi && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          {si}
        </Button>
        {puedePracticar ? (
          <>
            <Button size="lg" variant="outline" className={BOTON_GRANDE} onClick={onPracticar} disabled={completando}>
              Todavía no, quiero practicar
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Cargás una orden de prueba a tu nombre y ves los avisos que le llegan al cliente. No suma a los límites de tu plan.
            </p>
          </>
        ) : (
          <p className="text-center text-xs text-muted-foreground">
            Ya cargaste órdenes reales, así que no hace falta practicar.
          </p>
        )}
        <div className="pt-2">
          <Button variant="ghost" onClick={onAtras} disabled={completando}>
            <ChevronLeft className="mr-2 h-4 w-4" aria-hidden="true" />
            Atrás
          </Button>
        </div>
      </CardContent>
    </>
  )
}
