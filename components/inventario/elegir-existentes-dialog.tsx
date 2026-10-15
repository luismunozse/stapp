"use client"

import { useCallback, useEffect, useState } from "react"
import { Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { motivoDeBloqueo } from "@/lib/variantes-agrupar"
import type { Inventario } from "@/types"

/*
 * "Sumar productos existentes": the way to group products that already exist from the product form, which is
 * also the way on a phone (the bulk bar is list view only). The user searches, ticks two or more and moves on
 * to the grouping dialog. Only products that can join a group are listed.
 */

interface Props {
  open: boolean
  onClose: () => void
  onElegidos: (items: Inventario[]) => void
  /** The product open in the form, already ticked. */
  incluir?: Inventario | null
}

const LIMITE = 20
const ESPERA_BUSQUEDA_MS = 300
const MENSAJE_ERROR = "No pudimos buscar los productos. Probá de nuevo"

export function ElegirExistentesDialog({ open, onClose, onElegidos, incluir }: Props) {
  // The state lives in an inner component that exists only while the dialog is open: every opening starts fresh.
  if (!open) return null
  return <Contenido onClose={onClose} onElegidos={onElegidos} incluir={incluir} />
}

function Contenido({ onClose, onElegidos, incluir }: Omit<Props, "open">) {
  const [texto, setTexto] = useState("")
  const [busqueda, setBusqueda] = useState("")
  const [resultados, setResultados] = useState<Inventario[]>([])
  const [estado, setEstado] = useState<"cargando" | "listo" | "error">("cargando")
  const [intento, setIntento] = useState(0)
  const [elegidos, setElegidos] = useState<Map<string, Inventario>>(() =>
    incluir && motivoDeBloqueo(incluir) === null ? new Map([[incluir.id, incluir]]) : new Map()
  )

  useEffect(() => {
    const espera = setTimeout(() => setBusqueda(texto.trim()), texto.trim() === busqueda ? 0 : ESPERA_BUSQUEDA_MS)
    return () => clearTimeout(espera)
  }, [texto, busqueda])

  useEffect(() => {
    const control = new AbortController()
    setEstado("cargando")
    const params = new URLSearchParams()
    if (busqueda) params.set("search", busqueda)
    params.set("limit", String(LIMITE))
    params.set("page", "1")
    fetch(`/api/inventario?${params.toString()}`, { signal: control.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("fallo")
        const cuerpo = await res.json()
        const lista: Inventario[] = Array.isArray(cuerpo?.data) ? cuerpo.data : Array.isArray(cuerpo) ? cuerpo : []
        setResultados(lista.filter((i) => motivoDeBloqueo(i) === null))
        setEstado("listo")
      })
      .catch(() => {
        if (!control.signal.aborted) setEstado("error")
      })
    return () => control.abort()
  }, [busqueda, intento])

  const alternar = useCallback((item: Inventario) => {
    setElegidos((previos) => {
      const siguientes = new Map(previos)
      if (siguientes.has(item.id)) siguientes.delete(item.id)
      else siguientes.set(item.id, item)
      return siguientes
    })
  }, [])

  const cantidad = elegidos.size

  return (
    <ResponsiveDialog open onOpenChange={(abierto) => !abierto && onClose()}>
      <ResponsiveDialogContent className="sm:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Sumar productos existentes</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>Elegí dos o más productos que ya tenés cargados para agruparlos como variantes de uno solo.</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Buscar producto" className="pl-9" placeholder="Buscá por nombre o código" value={texto} onChange={(e) => setTexto(e.target.value)} />
        </div>

        <div className="max-h-[50vh] overflow-y-auto">
          {estado === "error" ? (
            <div className="space-y-2 py-4 text-center text-sm">
              <p>{MENSAJE_ERROR}</p>
              <Button type="button" variant="outline" onClick={() => setIntento((n) => n + 1)}>
                Reintentar
              </Button>
            </div>
          ) : estado === "cargando" && resultados.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Buscando…</p>
          ) : resultados.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No encontramos productos para agrupar</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {resultados.map((item) => (
                <li key={item.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                    <input type="checkbox" className="size-4" aria-label={item.nombre} checked={elegidos.has(item.id)} onChange={() => alternar(item)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{item.nombre}</span>
                      <span className="block truncate text-xs text-muted-foreground">{item.codigo}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <ResponsiveDialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" disabled={cantidad < 2} onClick={() => onElegidos([...elegidos.values()])}>
            {cantidad >= 2 ? `Seguir con ${cantidad} productos` : "Seguir"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
