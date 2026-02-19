"use client"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Trash2 } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"

interface ItemRowProps {
  item: {
    descripcion: string
    cantidad: number
    precioUnitario: number
  }
  index: number
  onUpdate: (index: number, field: string, value: string | number) => void
  onRemove: (index: number) => void
  disabled?: boolean
}

export function ItemRow({ item, index, onUpdate, onRemove, disabled }: ItemRowProps) {
  const { formatPrice } = useCurrency()
  const subtotal = item.cantidad * item.precioUnitario

  return (
    <>
      {/* Mobile Layout */}
      <div className="sm:hidden space-y-2 py-3 border-b">
        <div className="flex justify-between items-start">
          <Input
            placeholder="Descripción del item"
            value={item.descripcion}
            onChange={(e) => onUpdate(index, "descripcion", e.target.value)}
            disabled={disabled}
            className="flex-1"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onRemove(index)}
            disabled={disabled}
            className="h-8 w-8 text-destructive hover:text-destructive ml-2"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label htmlFor={`item-cantidad-${index}`} className="text-xs text-muted-foreground">Cantidad</label>
            <Input
              id={`item-cantidad-${index}`}
              type="number"
              min="1"
              placeholder="Cant."
              value={item.cantidad || ""}
              onChange={(e) => onUpdate(index, "cantidad", parseInt(e.target.value) || 0)}
              disabled={disabled}
            />
          </div>
          <div>
            <label htmlFor={`item-precio-${index}`} className="text-xs text-muted-foreground">Precio</label>
            <Input
              id={`item-precio-${index}`}
              type="number"
              min="0"
              step="0.01"
              placeholder="Precio"
              value={item.precioUnitario || ""}
              onChange={(e) => onUpdate(index, "precioUnitario", parseFloat(e.target.value) || 0)}
              disabled={disabled}
            />
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Subtotal</span>
            <div className="h-10 flex items-center justify-end font-medium">
              {formatPrice(subtotal)}
            </div>
          </div>
        </div>
      </div>

      {/* Desktop Layout */}
      <div className="hidden sm:grid grid-cols-12 gap-2 items-center py-2 border-b">
        <div className="col-span-5">
          <Input
            placeholder="Descripción del item"
            value={item.descripcion}
            onChange={(e) => onUpdate(index, "descripcion", e.target.value)}
            disabled={disabled}
          />
        </div>
        <div className="col-span-2">
          <Input
            type="number"
            min="1"
            placeholder="Cant."
            value={item.cantidad || ""}
            onChange={(e) => onUpdate(index, "cantidad", parseInt(e.target.value) || 0)}
            disabled={disabled}
          />
        </div>
        <div className="col-span-2">
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="Precio"
            value={item.precioUnitario || ""}
            onChange={(e) => onUpdate(index, "precioUnitario", parseFloat(e.target.value) || 0)}
            disabled={disabled}
          />
        </div>
        <div className="col-span-2 text-right font-medium">
          {formatPrice(subtotal)}
        </div>
        <div className="col-span-1 text-right">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onRemove(index)}
            disabled={disabled}
            className="h-8 w-8 text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </>
  )
}
