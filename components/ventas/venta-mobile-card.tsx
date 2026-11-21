"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CobroResumen } from "@/components/ui/cobro-resumen"
import { VentaEstadoBadge } from "@/components/ventas/venta-estado-badge"
import { FileText, Calendar } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"

const metodoPagoLabels: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  TARJETA: "Tarjeta",
  TARJETA_DEBITO: "T. D\u00e9bito",
  TARJETA_CREDITO: "T. Cr\u00e9dito",
  MERCADOPAGO: "MercadoPago",
  OTRO: "Otro",
}

interface VentaListItem {
  id: string
  numeroVenta: number
  clienteNombre: string
  clienteTelefono?: string | null
  vendedor?: { nombre: string } | null
  items: Array<{ descripcion: string; cantidad: number }>
  total: number
  montoAbonado: number
  /** Lo que falta cobrar (total − cobrado − lo que descontaron las devoluciones). */
  saldoPendiente?: number
  estadoPago: string
  metodoPago: string
  estado: string
  garantias: Array<{ id: string }>
  createdAt: string
}

interface VentaMobileCardProps {
  venta: VentaListItem
  onClick: () => void
}

export function VentaMobileCard({ venta, onClick }: VentaMobileCardProps) {
  const { formatPrice, formatDate } = useCurrency()

  const anulada = venta.estado === "ANULADA"
  const productos = `${venta.items.length} producto${venta.items.length !== 1 ? "s" : ""}`

  return (
    <Card className="cursor-pointer active:bg-muted/50 transition-colors" onClick={onClick}>
      <CardContent className="p-3">
        {/* Row 1: number · client  |  total */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 font-mono text-sm font-semibold text-primary">
              V{String(venta.numeroVenta).padStart(4, "0")}
            </span>
            <span className="truncate text-sm font-medium">{venta.clienteNombre}</span>
          </div>
          <span
            className={
              anulada
                ? "shrink-0 font-semibold tabular-nums text-muted-foreground line-through"
                : "shrink-0 font-semibold tabular-nums"
            }
          >
            {formatPrice(venta.total)}
          </span>
        </div>

        {/* Row 2: date · items · method  |  payment/status · PDF */}
        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1">
            <Calendar className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {formatDate(venta.createdAt)} · {productos} · {metodoPagoLabels[venta.metodoPago] || venta.metodoPago}
            </span>
          </span>
          <div className="-my-1 -mr-1 flex shrink-0 items-center gap-1">
            {anulada ? (
              <VentaEstadoBadge estado={venta.estado} />
            ) : (
              <CobroResumen
                estadoPago={venta.estadoPago}
                saldoPendiente={venta.saldoPendiente}
                layout="inline"
                className="justify-end"
              />
            )}
            <div role="group" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <Button
                variant="ghost"
                size="sm"
                className="h-9 w-9 p-0 text-muted-foreground hover:text-primary"
                aria-label="Descargar comprobante"
                title="Descargar comprobante"
                onClick={(e) => {
                  e.stopPropagation()
                  window.open(`/api/ventas/${venta.id}/pdf`, "_blank")
                }}
              >
                <FileText className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
