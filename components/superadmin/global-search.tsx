"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Search, Building2, Users, Headset, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface Organization {
  id: string
  nombre: string
  slug: string
  email: string
  activo: boolean
}

interface User {
  id: string
  nombre: string
  email: string
  organization_id: string
}

interface Ticket {
  id: string
  asunto: string
  estado: string
  prioridad: string
  organization_id: string
}

interface SearchResults {
  organizations: Organization[]
  users: User[]
  tickets: Ticket[]
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResults | null>(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const router = useRouter()

  // Ctrl+K / Cmd+K keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [])

  // Focus input when dialog opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0)
    } else {
      setQuery("")
      setResults(null)
    }
  }, [open])

  // Debounced search
  const performSearch = useCallback(async (searchQuery: string) => {
    if (searchQuery.length < 2) {
      setResults(null)
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const res = await fetch(
        `/api/superadmin/search?q=${encodeURIComponent(searchQuery)}`
      )
      if (res.ok) {
        const data = await res.json()
        setResults(data)
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }, [])

  const handleQueryChange = (value: string) => {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      performSearch(value)
    }, 300)
  }

  const navigateTo = (path: string) => {
    setOpen(false)
    router.push(path)
  }

  const hasResults =
    results &&
    (results.organizations.length > 0 ||
      results.users.length > 0 ||
      results.tickets.length > 0)

  const showEmptyState =
    results &&
    query.length >= 2 &&
    !loading &&
    !hasResults

  return (
    <>
      {/* Search trigger button for sidebar */}
      <button
        onClick={() => setOpen(true)}
        className="flex items-center w-full px-3 py-2 text-sm text-muted-foreground rounded-lg border border-input bg-background hover:bg-accent hover:text-accent-foreground transition-colors gap-2"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left">Buscar...</span>
        <kbd className="pointer-events-none hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
          <span className="text-xs">Ctrl</span>K
        </kbd>
      </button>

      {/* Search dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[520px] p-0 gap-0 overflow-hidden">
          <DialogTitle className="sr-only">Búsqueda global</DialogTitle>

          {/* Search input */}
          <div className="flex items-center border-b px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="Buscar organizaciones, usuarios, tickets..."
              className="h-12 border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            {loading && (
              <Loader2 className="h-4 w-4 shrink-0 text-muted-foreground animate-spin" />
            )}
          </div>

          {/* Results */}
          <div className="max-h-[360px] overflow-y-auto">
            {/* Empty state when query is too short */}
            {query.length < 2 && query.length > 0 && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                Escribe al menos 2 caracteres para buscar
              </div>
            )}

            {/* Empty state when no results */}
            {showEmptyState && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No se encontraron resultados para &quot;{query}&quot;
              </div>
            )}

            {/* Results groups */}
            {hasResults && (
              <div className="py-2">
                {/* Organizations */}
                {results.organizations.length > 0 && (
                  <div>
                    <div className="px-4 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Organizaciones
                    </div>
                    {results.organizations.map((org) => (
                      <button
                        key={org.id}
                        onClick={() =>
                          navigateTo(`/superadmin/organizaciones/${org.id}`)
                        }
                        className="flex items-center gap-3 w-full px-4 py-2.5 text-left hover:bg-accent transition-colors"
                      >
                        <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">
                            {org.nombre}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {org.slug} &middot; {org.email}
                          </div>
                        </div>
                        <span
                          className={cn(
                            "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
                            org.activo
                              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                              : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          )}
                        >
                          {org.activo ? "Activa" : "Inactiva"}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Users */}
                {results.users.length > 0 && (
                  <div>
                    <div className="px-4 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Usuarios
                    </div>
                    {results.users.map((user) => (
                      <button
                        key={user.id}
                        onClick={() =>
                          navigateTo(
                            `/superadmin/organizaciones/${user.organization_id}`
                          )
                        }
                        className="flex items-center gap-3 w-full px-4 py-2.5 text-left hover:bg-accent transition-colors"
                      >
                        <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">
                            {user.nombre}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {user.email}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Tickets */}
                {results.tickets.length > 0 && (
                  <div>
                    <div className="px-4 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Tickets
                    </div>
                    {results.tickets.map((ticket) => (
                      <button
                        key={ticket.id}
                        onClick={() =>
                          navigateTo(`/superadmin/soporte/${ticket.id}`)
                        }
                        className="flex items-center gap-3 w-full px-4 py-2.5 text-left hover:bg-accent transition-colors"
                      >
                        <Headset className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">
                            {ticket.asunto}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {ticket.estado} &middot; {ticket.prioridad}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Initial state */}
            {!results && query.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                Busca organizaciones, usuarios o tickets de soporte
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
            <span>
              <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">Esc</kbd>{" "}
              para cerrar
            </span>
            <span>
              <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">Ctrl</kbd>{" "}
              <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">K</kbd>{" "}
              búsqueda global
            </span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
