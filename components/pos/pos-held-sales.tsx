"use client"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RotateCcw, Trash2, Clock, ShoppingCart, User } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import type { HeldSale } from "./pos-types"
import { EmptyState } from "@/components/ui/empty-state"

interface PosHeldSalesProps {
  open: boolean
  onClose: () => void
  heldSales: HeldSale[]
  onRecall: (id: string) => void
  onDelete: (id: string) => void
}

export function PosHeldSales({
  open,
  onClose,
  heldSales,
  onRecall,
  onDelete,
}: PosHeldSalesProps) {
  const { formatPrice } = useCurrency()

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
  }

  const getTotal = (sale: HeldSale) =>
    sale.items.reduce((sum, item) => sum + item.precioUnitario * item.cantidad, 0)

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5" />
            Ventas Apartadas
            {heldSales.length > 0 && (
              <Badge variant="secondary">{heldSales.length}</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {heldSales.length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            title="No hay ventas apartadas"
          />
        ) : (
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {heldSales.map((sale) => (
              <div
                key={sale.id}
                className="rounded-lg border p-3 space-y-2 hover:border-primary/50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">{formatTime(sale.timestamp)}</span>
                  </div>
                  <span className="font-bold text-primary">{formatPrice(getTotal(sale))}</span>
                </div>

                {sale.cliente.nombre && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <User className="h-3 w-3" />
                    {sale.cliente.nombre}
                  </div>
                )}

                <div className="text-xs text-muted-foreground">
                  {sale.items.length} producto{sale.items.length !== 1 ? "s" : ""} —{" "}
                  {sale.items.map((i) => i.nombre).slice(0, 3).join(", ")}
                  {sale.items.length > 3 && "..."}
                </div>

                {sale.nota && (
                  <div className="text-xs italic text-muted-foreground/80">
                    "{sale.nota}"
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1 h-8"
                    onClick={() => {
                      onRecall(sale.id)
                      onClose()
                    }}
                  >
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                    Recuperar
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={() => onDelete(sale.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
