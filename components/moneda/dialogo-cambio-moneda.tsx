"use client"

import { Button } from "@/components/ui/button"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { useMoneda } from "@/hooks/use-moneda"
import type { MonedaCatalogo } from "@/lib/currency/catalogo"

interface DialogoCambioMonedaProps {
  open: boolean
  de: MonedaCatalogo
  a: MonedaCatalogo
  /** There is a rate to convert with; without one only "keep the number" is possible. */
  puedeConvertir: boolean
  /** Why "Convertir" is off; shown under it when `puedeConvertir` is false. */
  motivoSinConvertir?: string
  onConvertir: () => void
  onMantener: () => void
  onCancelar: () => void
}

/**
 * Switching the currency of a catalog price that already has amounts: convert them at today's rate
 * or keep the same numbers in the new currency. Three outcomes, so it is built on ResponsiveDialog
 * (ConfirmDialog has two buttons and cannot disable only one of them).
 */
export function DialogoCambioMoneda({
  open,
  de,
  a,
  puedeConvertir,
  motivoSinConvertir = "No hay cotización disponible",
  onConvertir,
  onMantener,
  onCancelar,
}: DialogoCambioMonedaProps) {
  const { config } = useMoneda()
  const nombre = (m: MonedaCatalogo) => (m === null ? (config?.monedaLocal ?? "moneda local") : m)

  return (
    <ResponsiveDialog open={open} onOpenChange={(abierto) => !abierto && onCancelar()}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader className="pr-8 text-left">
          <ResponsiveDialogTitle>
            Pasar los precios de {nombre(de)} a {nombre(a)}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Podés convertir los precios con la cotización de hoy o dejar los mismos números en {nombre(a)}.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="flex flex-col gap-2">
          <Button type="button" onClick={onConvertir} disabled={!puedeConvertir}>
            Convertir con la cotización de hoy
          </Button>
          {!puedeConvertir && <p className="text-xs text-muted-foreground">{motivoSinConvertir}</p>}
          <Button type="button" variant="outline" onClick={onMantener}>
            Mantener el número
          </Button>
        </div>
        <ResponsiveDialogFooter>
          <Button type="button" variant="ghost" onClick={onCancelar}>
            Cancelar
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
