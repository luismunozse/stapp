"use client"

import { useState } from "react"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useCurrency } from "@/contexts/currency-context"
import { useModal } from "@/contexts/modal-context"
import { campoSincronizadoPara } from "@/lib/servicios/sincronizar-costo-final"

interface AplicarAlTotalAvisoProps {
  ordenId: string
  estado: string
  presupuesto: number | null
  costoFinal: number | null
  totalCobrado: number
  /** Servicios + repuestos (ver sumaLineasOrden). */
  sumaLineas: { servicios: number; repuestos: number; total: number }
  /** Cantidad de líneas (servicios + repuestos) de la orden. */
  cantidadLineas: number
  /** Una mutación de esta sesión informó que el monto no se sincronizó. Cubre
   *  el caso de borrar la última línea de una orden con cobros: sin líneas el
   *  aviso no se mostraría. */
  forzar?: boolean
  onAplicado: () => void | Promise<void>
}

/**
 * Aviso "Aplicar al total": el monto vivo de la orden (presupuesto antes de
 * APROBADO, costo_final desde APROBADO) no coincide con servicios + repuestos.
 *
 * Pasa cuando la orden ya tiene cobros o alguien escribió el monto a mano: en
 * esos casos el servidor deja de sincronizarlo solo (migraciones 303/304/419).
 * El guard de líneas evita el aviso en órdenes viejas con el monto cargado a
 * mano y sin líneas.
 */
export function AplicarAlTotalAviso({
  ordenId,
  estado,
  presupuesto,
  costoFinal,
  totalCobrado,
  sumaLineas,
  cantidadLineas,
  forzar = false,
  onAplicado,
}: AplicarAlTotalAvisoProps) {
  const { formatPrice } = useCurrency()
  const { confirm, alert } = useModal()
  const [aplicando, setAplicando] = useState(false)

  const campoVivo = campoSincronizadoPara(estado)
  const montoVivoNum = Number((campoVivo === "presupuesto" ? presupuesto : costoFinal) ?? 0)
  const etiquetaMonto = campoVivo === "presupuesto" ? "presupuesto" : "costo final"

  const visible =
    campoVivo !== null &&
    (cantidadLineas > 0 || forzar) &&
    Math.round(sumaLineas.total * 100) !== Math.round(montoVivoNum * 100)

  if (!visible) return null

  // PATCH a la ruta de servicios y NO PUT a /api/ordenes/[id]: ese PUT
  // auto-transiciona la orden a PRESUPUESTADO al escribir presupuesto y le
  // notifica al cliente. Aplicar un monto calculado no es presupuestar.
  const handleAplicar = async () => {
    const confirmed = await confirm({
      title: "Aplicar al total",
      description:
        totalCobrado > 0
          ? `El ${etiquetaMonto} va a pasar a ${formatPrice(sumaLineas.total)}. Esta orden ya tiene ${formatPrice(totalCobrado)} cobrados.`
          : `El ${etiquetaMonto} va a pasar a ${formatPrice(sumaLineas.total)}.`,
      confirmText: "Aplicar",
      variant: totalCobrado > 0 ? "warning" : "info",
    })
    if (!confirmed) return

    setAplicando(true)
    try {
      const res = await fetch(`/api/ordenes/${ordenId}/servicios`, { method: "PATCH" })
      if (res.ok) {
        await onAplicado()
      } else {
        const error = await res.json()
        await alert({ title: "Error", description: error.error || `Error al actualizar el ${etiquetaMonto}`, variant: "error" })
      }
    } catch (error) {
      console.error("Error aplicando al total:", error)
      await alert({ title: "Error", description: `Error al actualizar el ${etiquetaMonto}`, variant: "error" })
    } finally {
      setAplicando(false)
    }
  }

  return (
    <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg p-3 mb-4">
      <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
      <div className="flex-1">
        <div className="font-medium mb-1">
          El {etiquetaMonto} no coincide con servicios + repuestos
        </div>
        <div>
          Servicios: {formatPrice(sumaLineas.servicios)} — Repuestos: {formatPrice(sumaLineas.repuestos)} — Total:{" "}
          {formatPrice(sumaLineas.total)} — {campoVivo === "presupuesto" ? "Presupuesto" : "Costo final"} actual:{" "}
          {formatPrice(montoVivoNum)}
          {totalCobrado > 0 && <> — Cobrado: {formatPrice(totalCobrado)}</>}
        </div>
      </div>
      <Button size="sm" variant="outline" className="shrink-0 bg-background" disabled={aplicando} onClick={handleAplicar}>
        Aplicar al total
      </Button>
    </div>
  )
}
