"use client"

import { Button } from "@/components/ui/button"
import { X } from "lucide-react"
import { BuscadorInventario, type ArticuloInventario } from "./buscador-inventario"

export type ArticuloVinculado = ArticuloInventario

interface InventarioPickerProps {
  descripcion: string
  vinculado: ArticuloVinculado | null
  onDescripcionChange: (value: string) => void
  onVincular: (articulo: ArticuloVinculado) => void
  onDesvincular: () => void
}

/**
 * Campo de ítem de una OC: el texto libre de la descripción ES el buscador de
 * inventario.
 *
 * Vincular acá y no al recibir es lo que saca el doble trabajo — el operador
 * escribía el producto al pedirlo y lo volvía a buscar cuando llegaba. El
 * texto libre sigue valiendo: se pide seguido algo que no está en el catálogo.
 */
export function InventarioPicker({
  descripcion,
  vinculado,
  onDescripcionChange,
  onVincular,
  onDesvincular,
}: InventarioPickerProps) {
  if (vinculado) {
    return (
      <div className="flex items-center gap-1">
        <div className="min-w-0 text-sm">
          <div className="truncate">{descripcion}</div>
          <div className="text-xs text-muted-foreground">
            <span className="font-mono">{vinculado.codigo}</span> · {vinculado.nombre}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Desvincular artículo"
          className="h-6 w-6 shrink-0"
          onClick={onDesvincular}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    )
  }

  return (
    <BuscadorInventario
      valor={descripcion}
      onValorChange={onDescripcionChange}
      onSeleccionar={onVincular}
    />
  )
}
