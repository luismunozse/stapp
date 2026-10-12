"use client"

import { useEffect, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Plus } from "lucide-react"
import { InventarioForm } from "@/components/inventario/inventario-form"

export interface ArticuloInventario {
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

interface BuscadorInventarioProps {
  valor: string
  onValorChange: (valor: string) => void
  onSeleccionar: (articulo: ArticuloInventario) => void
  placeholder?: string
  autoFocus?: boolean
  className?: string
  /**
   * Se dispara cuando el buscador pierde el foco sin haber elegido nada. Sirve
   * para que el llamador lo esconda. NO se dispara mientras está abierto el
   * alta de artículo: si el llamador desmonta el buscador ahí, se lleva puesto
   * el formulario que está adentro.
   */
  onCancelar?: () => void
}

/**
 * Buscador de artículos de inventario con alta inline.
 *
 * Lo comparten el alta de una OC (donde el campo de descripción ES el
 * buscador) y el diálogo de recepción (donde la descripción viene fija de la
 * OC y solo se busca el vínculo). Antes cada uno tenía su copia del debounce y
 * del dropdown, y solo el alta sabía crear artículos.
 */
export function BuscadorInventario({
  valor,
  onValorChange,
  onSeleccionar,
  placeholder = "Buscar o escribir. Ej: Pantalla Samsung A55",
  autoFocus,
  className,
  onCancelar,
}: BuscadorInventarioProps) {
  const [resultados, setResultados] = useState<ResultadoBusqueda[]>([])
  const [abierto, setAbierto] = useState(false)
  const [creando, setCreando] = useState(false)
  const cerrarTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  // El blur corre diferido, así que para entonces el estado capturado en el
  // closure está viejo. El ref dice la verdad en el momento del timeout.
  const creandoRef = useRef(false)

  useEffect(() => {
    if (valor.trim().length < 2) {
      setResultados([])
      return
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/inventario/search?q=${encodeURIComponent(valor)}&limit=8&includeZeroStock=true`
        )
        if (res.ok) setResultados(await res.json())
      } catch {
        /* la búsqueda es una ayuda: si falla, queda lo escrito */
      }
    }, 300)
    return () => clearTimeout(t)
  }, [valor])

  useEffect(() => {
    return () => {
      if (cerrarTimeout.current) clearTimeout(cerrarTimeout.current)
    }
  }, [])

  const abrirAlta = () => {
    creandoRef.current = true
    setCreando(true)
    setAbierto(false)
  }

  const cerrarAlta = () => {
    creandoRef.current = false
    setCreando(false)
  }

  const elegir = (articulo: ArticuloInventario) => {
    cerrarAlta()
    setAbierto(false)
    setResultados([])
    onSeleccionar(articulo)
  }

  const mostrarDropdown = abierto && valor.trim().length >= 2

  return (
    <>
      <div className="relative">
        <Input
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={valor}
          onChange={(e) => {
            onValorChange(e.target.value)
            setAbierto(true)
          }}
          onFocus={() => setAbierto(true)}
          // Diferido para que el click en una opción llegue primero.
          onBlur={() => {
            cerrarTimeout.current = setTimeout(() => {
              if (creandoRef.current) return
              setAbierto(false)
              onCancelar?.()
            }, 200)
          }}
          className={className ?? "h-8"}
        />

        {mostrarDropdown && (
          <div className="absolute z-50 mt-1 w-full min-w-[16rem] max-w-sm overflow-hidden rounded-md border bg-popover shadow-md">
            <div className="max-h-40 overflow-y-auto">
              {resultados.map((inv) => (
                <button
                  key={inv.id}
                  type="button"
                  className="w-full px-2 py-1.5 text-left text-xs hover:bg-accent"
                  onMouseDown={() =>
                    elegir({
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
              onMouseDown={abrirAlta}
            >
              <Plus className="h-3 w-3" /> Crear artículo
            </button>
          </div>
        )}
      </div>

      <Dialog open={creando} onOpenChange={(open) => !open && cerrarAlta()}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-0">
          {creando && (
            <InventarioForm
              onClose={cerrarAlta}
              onSuccess={(saved) => {
                // Sin el item guardado no hay nada que vincular: el alta corrió
                // igual, así que se cierra sin romper.
                if (saved) {
                  elegir({
                    id: saved.id,
                    codigo: saved.codigo,
                    nombre: saved.nombre,
                    precioCompra: saved.precioCompra,
                  })
                } else {
                  cerrarAlta()
                }
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
