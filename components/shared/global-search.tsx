"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Search, User, ClipboardList, X } from "lucide-react"
import { useGlobalSearch } from "@/hooks/use-global-search"
import { OrderStatusBadge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export function GlobalSearch() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const { query, results, loading, hasResults, search, clear } = useGlobalSearch()
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [selectedIndex, setSelectedIndex] = useState(-1)

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setOpen(true)
        setTimeout(() => inputRef.current?.focus(), 50)
      }
      if (e.key === "Escape" && open) {
        handleClose()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [open])

  // Click outside to close
  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        handleClose()
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [open])

  const handleClose = () => {
    setOpen(false)
    clear()
    setSelectedIndex(-1)
  }

  const handleSelect = (type: "cliente" | "orden", id: string) => {
    handleClose()
    if (type === "cliente") {
      router.push(`/clientes?search=${id}`)
    } else {
      router.push(`/ordenes/${id}`)
    }
  }

  // Build flat list for keyboard navigation
  const allItems = [
    ...results.clientes.map((c) => ({ type: "cliente" as const, ...c })),
    ...results.ordenes.map((o) => ({ type: "orden" as const, ...o })),
  ]

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelectedIndex((prev) => Math.min(prev + 1, allItems.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelectedIndex((prev) => Math.max(prev - 1, -1))
    } else if (e.key === "Enter" && selectedIndex >= 0 && selectedIndex < allItems.length) {
      e.preventDefault()
      const item = allItems[selectedIndex]
      handleSelect(item.type, item.id)
    }
  }

  // Trigger button for desktop
  if (!open) {
    return (
      <button
        onClick={() => {
          setOpen(true)
          setTimeout(() => inputRef.current?.focus(), 50)
        }}
        className="hidden lg:flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground bg-muted/50 border rounded-md hover:bg-muted transition-colors"
      >
        <Search className="h-4 w-4" />
        <span>Buscar...</span>
        <kbd className="ml-2 px-1.5 py-0.5 text-[10px] bg-background border rounded font-mono">
          Ctrl+K
        </kbd>
      </button>
    )
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-50" />

      {/* Search dialog */}
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
        <div
          ref={containerRef}
          className="w-full max-w-lg bg-background border rounded-lg shadow-2xl overflow-hidden"
        >
          {/* Search input */}
          <div className="flex items-center gap-2 px-4 border-b">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                search(e.target.value)
                setSelectedIndex(-1)
              }}
              onKeyDown={handleKeyDown}
              placeholder="Buscar clientes, órdenes..."
              className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 h-12"
              autoComplete="off"
            />
            <button onClick={handleClose} className="p-1 hover:bg-muted rounded">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Results */}
          <div className="max-h-80 overflow-y-auto">
            {loading && (
              <div className="p-4 text-center text-sm text-muted-foreground">
                Buscando...
              </div>
            )}

            {!loading && query.length >= 2 && !hasResults && (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No se encontraron resultados para &quot;{query}&quot;
              </div>
            )}

            {!loading && hasResults && (
              <div className="py-2">
                {/* Clientes */}
                {results.clientes.length > 0 && (
                  <>
                    <div className="px-4 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Clientes
                    </div>
                    {results.clientes.map((cliente, idx) => (
                      <button
                        key={cliente.id}
                        onClick={() => handleSelect("cliente", cliente.id)}
                        className={cn(
                          "w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-muted transition-colors",
                          selectedIndex === idx && "bg-muted"
                        )}
                      >
                        <User className="h-4 w-4 text-blue-500 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{cliente.nombre}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {cliente.telefono}
                            {cliente.email ? ` · ${cliente.email}` : ""}
                          </p>
                        </div>
                      </button>
                    ))}
                  </>
                )}

                {/* Órdenes */}
                {results.ordenes.length > 0 && (
                  <>
                    <div className="px-4 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-1">
                      Órdenes
                    </div>
                    {results.ordenes.map((orden, idx) => {
                      const globalIdx = results.clientes.length + idx
                      return (
                        <button
                          key={orden.id}
                          onClick={() => handleSelect("orden", orden.id)}
                          className={cn(
                            "w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-muted transition-colors",
                            selectedIndex === globalIdx && "bg-muted"
                          )}
                        >
                          <ClipboardList className="h-4 w-4 text-green-500 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium">#{orden.numero_orden}</p>
                              <OrderStatusBadge status={orden.estado} />
                            </div>
                            <p className="text-xs text-muted-foreground truncate">
                              {orden.dispositivo}
                              {orden.cliente_nombre ? ` · ${orden.cliente_nombre}` : ""}
                            </p>
                          </div>
                        </button>
                      )
                    })}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-2 border-t text-xs text-muted-foreground">
            <span>
              <kbd className="px-1 py-0.5 bg-muted border rounded font-mono text-[10px]">↑↓</kbd>
              {" "}navegar
              {" "}
              <kbd className="px-1 py-0.5 bg-muted border rounded font-mono text-[10px]">Enter</kbd>
              {" "}seleccionar
            </span>
            <span>
              <kbd className="px-1 py-0.5 bg-muted border rounded font-mono text-[10px]">Esc</kbd>
              {" "}cerrar
            </span>
          </div>
        </div>
      </div>
    </>
  )
}
