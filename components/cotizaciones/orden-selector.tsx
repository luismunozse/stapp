"use client"

import { useTerminologia } from "@/contexts/currency-context"

import { useState, useEffect, useRef, useCallback } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Search, Wrench, Loader2 } from "lucide-react"

interface OrdenLite {
  id: string
  numeroOrden: number
  codigoOrden?: string | null
  dispositivo?: string | null
  marca?: string | null
  estado: string
  clienteId?: string | null
  sectorId?: string | null
  cliente?: {
    id: string
    nombre: string
    email?: string | null
    telefono?: string | null
    tipoCliente?: string | null
    razonSocial?: string | null
  } | null
}

interface OrdenSelectorProps {
  value: string | null
  onChange: (ordenId: string | null, orden: OrdenLite | null) => void
  disabled?: boolean
  label?: string
  placeholder?: string
  excludeEstados?: string[]
}

const DEFAULT_EXCLUDE = ["ENTREGADO", "ENTREGADO_SIN_REPARACION", "CANCELADO", "SIN_REPARACION"]

export function OrdenSelector({
  value,
  onChange,
  disabled,
  label,
  placeholder,
  excludeEstados = DEFAULT_EXCLUDE,
}: OrdenSelectorProps) {
  const term = useTerminologia()
  // Los defaults se resuelven aca (y no en la firma) porque dependen del
  // vocabulario de la organizacion, que solo esta disponible via hook.
  const labelFinal = label ?? `${term("orden")} (opcional)`
  const placeholderFinal =
    placeholder ?? `Buscar por N° de orden, ${term("equipo").toLowerCase()} o cliente...`
  const [search, setSearch] = useState("")
  const [results, setResults] = useState<OrdenLite[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<OrdenLite | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 1) {
      setResults([])
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/ordenes?search=${encodeURIComponent(q)}&limit=15`)
      if (res.ok) {
        const data = await res.json()
        const list: OrdenLite[] = (data.data || []).filter(
          (o: OrdenLite) => !excludeEstados.includes(o.estado)
        )
        setResults(list)
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [excludeEstados])

  const handleSearchChange = (val: string) => {
    setSearch(val)
    setOpen(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(val), 300)
  }

  const handleSelect = (orden: OrdenLite) => {
    setSelected(orden)
    setSearch(formatOrdenLabel(orden))
    setOpen(false)
    onChange(orden.id, orden)
  }

  const handleClear = () => {
    setSelected(null)
    setSearch("")
    setResults([])
    onChange(null, null)
  }

  return (
    <div ref={containerRef} className="relative">
      <Label className="text-sm">{labelFinal}</Label>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={placeholderFinal}
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          onFocus={() => { if (search.length >= 1) setOpen(true) }}
          disabled={disabled || !!value}
          className="pl-9"
        />
        {(selected || value) && (
          <button
            type="button"
            onClick={handleClear}
            disabled={disabled}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
          >
            Cambiar
          </button>
        )}
      </div>

      {open && search.length >= 1 && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-lg shadow-lg max-h-72 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : results.length === 0 ? (
            <div className="py-3 px-4">
              <p className="text-sm text-muted-foreground">Sin resultados</p>
            </div>
          ) : (
            results.map((orden) => (
              <button
                key={orden.id}
                type="button"
                className="w-full text-left px-4 py-2 hover:bg-accent flex items-center gap-2 text-sm"
                onClick={() => handleSelect(orden)}
              >
                <Wrench className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">
                    #{orden.numeroOrden}
                    {orden.dispositivo ? ` — ${orden.dispositivo}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {orden.cliente?.nombre || "Sin cliente"}
                    {orden.estado ? ` · ${orden.estado}` : ""}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function formatOrdenLabel(o: OrdenLite) {
  return `#${o.numeroOrden}${o.dispositivo ? ` — ${o.dispositivo}` : ""}${o.cliente?.nombre ? ` (${o.cliente.nombre})` : ""}`
}

export type { OrdenLite }
