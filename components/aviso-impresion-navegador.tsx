"use client"

import { useEffect, useId, useState } from "react"
import { Switch } from "@/components/ui/switch"
import { readAlinearArriba, saveAlinearArriba } from "@/lib/thermal-paper"

/**
 * Ayuda bajo los botones de impresión térmica. Por navegador el largo del
 * papel lo decide el driver: si tiene un papel de largo fijo, expulsa la hoja
 * entera aunque el comprobante sea corto, y eso no se corrige desde la página.
 * "Alinear arriba" se guarda por dispositivo y la lee ajustarPaginaImpresion
 * al imprimir.
 */
export function AvisoImpresionNavegador() {
  const id = useId()
  const [alinearArriba, setAlinearArriba] = useState(false)

  useEffect(() => {
    setAlinearArriba(readAlinearArriba())
  }, [])

  return (
    <div className="space-y-2 text-xs text-muted-foreground">
      <p>
        ¿Sale con mucho papel en blanco? En las preferencias de la impresora elegí un papel de rollo
        (largo variable) y, en la ventana de impresión, destildá «Encabezados y pies de página».
      </p>
      <div className="flex items-center gap-2">
        <Switch
          id={id}
          checked={alinearArriba}
          onCheckedChange={(valor) => {
            setAlinearArriba(valor)
            saveAlinearArriba(valor)
          }}
        />
        <label htmlFor={id}>
          Alinear arriba al imprimir por navegador (si el blanco queda antes del comprobante)
        </label>
      </div>
    </div>
  )
}
