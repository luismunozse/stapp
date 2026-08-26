"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Plus, X } from "lucide-react"
import { InventarioForm } from "@/components/inventario/inventario-form"

export interface ArticuloVinculado {
  id: string
  codigo: string
  nombre: string
  precioCompra?: number | null
}

interface ResultadoBusqueda {
  id: string
  codigo: string
  nombre: string
  stock?: number
  precioCompra?: number | null
}

interface InventarioPickerProps {
  descripcion: string
  vinculado: ArticuloVinculado | null
  onDescripcionChange: (value: string) => void
  onVincular: (articulo: ArticuloVinculado) => void
  onDesvincular: () => void
}

/**
 * Campo de ítem de una OC: texto libre que además busca en inventario.
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
  const [resultados, setResultados] = useState<ResultadoBusqueda[]>([])
  const [abierto, setAbierto] = useState(false)
  const [creando, setCreando] = useState(false)
  const cerrarTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (vinculado || descripcion.trim().length < 2) {
      setResultados([])
      return
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/inventario/search?q=${encodeURIComponent(descripcion)}&limit=8&includeZeroStock=true`
        )
        if (res.ok) setResultados(await res.json())
      } catch {
        /* la búsqueda es una ayuda: si falla, queda el texto libre */
      }
    }, 300)
    return () => clearTimeout(t)
  }, [descripcion, vinculado])

  useEffect(() => {
    return () => {
      if (cerrarTimeout.current) clearTimeout(cerrarTimeout.current)
    }
  }, [])

  const vincular = (articulo: ArticuloVinculado) => {
    setAbierto(false)
    setResultados([])
    onVincular(articulo)
  }

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

  const mostrarDropdown = abierto && descripcion.trim().length >= 2

  return (
    <>
      <div className="relative">
        <Input
          placeholder="Buscar o escribir. Ej: Pantalla Samsung A55"
          value={descripcion}
          onChange={(e) => {
            onDescripcionChange(e.target.value)
            setAbierto(true)
          }}
          onFocus={() => setAbierto(true)}
          // El blur se difiere para que el click en una opción llegue primero.
          onBlur={() => {
            cerrarTimeout.current = setTimeout(() => setAbierto(false), 200)
          }}
          className="h-8"
        />

        {mostrarDropdown && (
          <div className="absolute z-50 mt-1 w-full max-w-sm overflow-hidden rounded-md border bg-popover shadow-md">
            <div className="max-h-40 overflow-y-auto">
              {resultados.map((inv) => (
                <button
                  key={inv.id}
                  type="button"
                  className="w-full px-2 py-1.5 text-left text-xs hover:bg-accent"
                  onMouseDown={() =>
                    vincular({
                      id: inv.id,
                      codigo: inv.codigo,
                      nombre: inv.nombre,
                      precioCompra: inv.precioCompra,
                    })
                  }
                >
                  <span className="font-medium">{inv.nombre}</span>
                  <span className="ml-1 font-mono text-muted-foreground">{inv.codigo}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="flex w-full items-center gap-1 border-t px-2 py-1.5 text-left text-xs font-medium hover:bg-accent"
              onMouseDown={() => {
                setAbierto(false)
                setCreando(true)
              }}
            >
              <Plus className="h-3 w-3" /> Crear artículo
            </button>
          </div>
        )}
      </div>

      <Dialog open={creando} onOpenChange={(open) => !open && setCreando(false)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-0">
          {creando && (
            <InventarioForm
              onClose={() => setCreando(false)}
              onSuccess={(saved) => {
                setCreando(false)
                // Sin el item guardado no hay nada que vincular: el alta corrió
                // igual, así que se deja el texto libre en vez de romper.
                if (saved) {
                  vincular({
                    id: saved.id,
                    codigo: saved.codigo,
                    nombre: saved.nombre,
                    precioCompra: saved.precioCompra,
                  })
                }
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
