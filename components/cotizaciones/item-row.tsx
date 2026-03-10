"use client"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Trash2, Percent, DollarSign } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"

const UNIDADES = [
  { value: "Unidad", label: "Unidad" },
  { value: "Hora", label: "Hora" },
  { value: "Servicio", label: "Servicio" },
  { value: "Pieza", label: "Pieza" },
  { value: "Kit", label: "Kit" },
  { value: "Metro", label: "Metro" },
]

interface ItemRowProps {
  item: {
    descripcion: string
    cantidad: number
    precioUnitario: number
    unidad?: string
    descuentoTipo?: string
    descuentoValor?: number
  }
  index: number
  onUpdate: (index: number, field: string, value: string | number) => void
  onRemove: (index: number) => void
  disabled?: boolean
}

export function calcItemNeto(item: { cantidad: number; precioUnitario: number; descuentoTipo?: string; descuentoValor?: number }) {
  const bruto = item.cantidad * item.precioUnitario
  const dv = item.descuentoValor || 0
  if (dv <= 0) return bruto
  if (item.descuentoTipo === "fijo") return Math.max(0, bruto - dv)
  return Math.max(0, bruto * (1 - dv / 100))
}

export function ItemRow({ item, index, onUpdate, onRemove, disabled }: ItemRowProps) {
  const { formatPrice } = useCurrency()
  const bruto = item.cantidad * item.precioUnitario
  const neto = calcItemNeto(item)
  const hasDiscount = (item.descuentoValor || 0) > 0

  return (
    <>
      {/* Mobile Layout */}
      <div className="sm:hidden space-y-2 py-3 border-b">
        <div className="flex justify-between items-start gap-2">
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
            className="h-8 w-8 text-destructive hover:text-destructive shrink-0"
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
            <label className="text-xs text-muted-foreground">Unidad</label>
            <Select
              value={item.unidad || "Unidad"}
              onValueChange={(v) => onUpdate(index, "unidad", v)}
              disabled={disabled}
            >
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UNIDADES.map((u) => (
                  <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground shrink-0">Desc.</label>
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="0"
            value={item.descuentoValor || ""}
            onChange={(e) => onUpdate(index, "descuentoValor", parseFloat(e.target.value) || 0)}
            disabled={disabled}
            className="w-20"
          />
          <Button
            type="button"
            variant={item.descuentoTipo === "fijo" ? "default" : "outline"}
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => onUpdate(index, "descuentoTipo", item.descuentoTipo === "fijo" ? "porcentaje" : "fijo")}
            disabled={disabled}
          >
            {item.descuentoTipo === "fijo" ? <DollarSign className="h-3 w-3" /> : <Percent className="h-3 w-3" />}
          </Button>
          <div className="flex-1 text-right">
            <span className="text-xs text-muted-foreground">Neto</span>
            <div className="font-medium text-sm">
              {hasDiscount && <span className="line-through text-muted-foreground text-xs mr-1">{formatPrice(bruto)}</span>}
              {formatPrice(neto)}
            </div>
          </div>
        </div>
      </div>

      {/* Desktop Layout */}
      <div className="hidden sm:grid grid-cols-16 gap-2 items-center py-2 border-b" style={{ gridTemplateColumns: "4fr 1fr 1.5fr 1.5fr 1.5fr 2fr 0.5fr" }}>
        <div>
          <Input
            placeholder="Descripción del item"
            value={item.descripcion}
            onChange={(e) => onUpdate(index, "descripcion", e.target.value)}
            disabled={disabled}
          />
        </div>
        <div>
          <Select
            value={item.unidad || "Unidad"}
            onValueChange={(v) => onUpdate(index, "unidad", v)}
            disabled={disabled}
          >
            <SelectTrigger className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UNIDADES.map((u) => (
                <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Input
            type="number"
            min="1"
            placeholder="Cant."
            value={item.cantidad || ""}
            onChange={(e) => onUpdate(index, "cantidad", parseInt(e.target.value) || 0)}
            disabled={disabled}
          />
        </div>
        <div>
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
        <div className="flex items-center gap-1">
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="0"
            value={item.descuentoValor || ""}
            onChange={(e) => onUpdate(index, "descuentoValor", parseFloat(e.target.value) || 0)}
            disabled={disabled}
            className="w-full"
          />
          <Button
            type="button"
            variant={item.descuentoTipo === "fijo" ? "default" : "outline"}
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => onUpdate(index, "descuentoTipo", item.descuentoTipo === "fijo" ? "porcentaje" : "fijo")}
            disabled={disabled}
          >
            {item.descuentoTipo === "fijo" ? <DollarSign className="h-3 w-3" /> : <Percent className="h-3 w-3" />}
          </Button>
        </div>
        <div className="text-right font-medium">
          {hasDiscount && <span className="line-through text-muted-foreground text-xs mr-1">{formatPrice(bruto)}</span>}
          {formatPrice(neto)}
        </div>
        <div className="text-right">
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
