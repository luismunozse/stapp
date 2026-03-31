"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Search, User, Loader2, UserPlus } from "lucide-react"
import { ClienteForm } from "@/components/clientes/cliente-form"

interface Cliente {
  id: string
  nombre: string
  email?: string | null
  telefono?: string | null
  tipoCliente?: string | null
  razonSocial?: string | null
}

interface ClienteSelectorProps {
  value: string | null
  onChange: (clienteId: string | null, cliente: Cliente | null) => void
  disabled?: boolean
}

export function ClienteSelector({ value, onChange, disabled }: ClienteSelectorProps) {
  const [search, setSearch] = useState("")
  const [results, setResults] = useState<Cliente[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Cliente | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Close on outside click
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
    if (q.length < 2) {
      setResults([])
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/clientes?search=${encodeURIComponent(q)}&pageSize=10`)
      if (res.ok) {
        const data = await res.json()
        setResults(data.data || (Array.isArray(data) ? data : []))
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  const handleSearchChange = (val: string) => {
    setSearch(val)
    setOpen(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(val), 300)
  }

  const handleSelect = (cliente: Cliente) => {
    setSelected(cliente)
    setSearch(cliente.nombre)
    setOpen(false)
    onChange(cliente.id, cliente)
  }

  const handleClear = () => {
    setSelected(null)
    setSearch("")
    setResults([])
    onChange(null, null)
  }

  const handleClienteCreated = async () => {
    setShowCreateForm(false)
    // Re-search to find the newly created client
    if (search.length >= 2) {
      await doSearch(search)
      setOpen(true)
    }
  }

  if (showCreateForm) {
    return (
      <div className="space-y-2">
        <ClienteForm
          open={showCreateForm}
          onClose={() => setShowCreateForm(false)}
          onSuccess={handleClienteCreated}
        />
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      <Label className="text-sm">Cliente</Label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar cliente por nombre..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            onFocus={() => { if (search.length >= 2) setOpen(true) }}
            disabled={disabled}
            className="pl-9"
          />
          {selected && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
            >
              Cambiar
            </button>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => setShowCreateForm(true)}
          disabled={disabled}
          title="Crear nuevo cliente"
        >
          <UserPlus className="h-4 w-4" />
        </Button>
      </div>

      {open && (search.length >= 2) && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : results.length === 0 ? (
            <div className="py-3 px-4 space-y-2">
              <p className="text-sm text-muted-foreground">No se encontraron clientes</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => {
                  setOpen(false)
                  setShowCreateForm(true)
                }}
              >
                <UserPlus className="mr-2 h-4 w-4" />
                Crear nuevo cliente
              </Button>
            </div>
          ) : (
            <>
              {results.map((cliente) => (
                <button
                  key={cliente.id}
                  type="button"
                  className="w-full text-left px-4 py-2 hover:bg-accent flex items-center gap-2 text-sm"
                  onClick={() => handleSelect(cliente)}
                >
                  <User className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium truncate">{cliente.nombre}</p>
                    {(cliente.email || cliente.telefono) && (
                      <p className="text-xs text-muted-foreground truncate">
                        {cliente.email || cliente.telefono}
                      </p>
                    )}
                  </div>
                </button>
              ))}
              <div className="border-t px-4 py-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground"
                  onClick={() => {
                    setOpen(false)
                    setShowCreateForm(true)
                  }}
                >
                  <UserPlus className="mr-2 h-4 w-4" />
                  Crear nuevo cliente
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
