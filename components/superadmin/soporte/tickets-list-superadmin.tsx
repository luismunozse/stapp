"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import {
  Bug,
  Lightbulb,
  HelpCircle,
  MessageSquare,
  Search,
  Loader2,
  Headset,
  Building2,
  ChevronLeft,
  ChevronRight,
  CircleDot,
} from "lucide-react"

interface TicketItem {
  id: string
  tipo: string
  prioridad: string
  asunto: string
  estado: string
  createdAt: string
  updatedAt: string
  usuario: { nombre: string; email: string } | null
  organizacion: { nombre: string; slug: string } | null
  totalMensajes: number
  noLeidos: number
  ultimoMensaje: {
    contenido: string
    autorTipo: string
    createdAt: string
  } | null
}

const tipoConfig: Record<string, { label: string; icon: any; color: string }> = {
  BUG: { label: "Bug", icon: Bug, color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  SUGERENCIA: { label: "Sugerencia", icon: Lightbulb, color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  PREGUNTA: { label: "Pregunta", icon: HelpCircle, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
}

const estadoConfig: Record<string, { label: string; color: string }> = {
  ABIERTO: { label: "Abierto", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  EN_PROCESO: { label: "En proceso", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  RESUELTO: { label: "Resuelto", color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  CERRADO: { label: "Cerrado", color: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400" },
}

const prioridadConfig: Record<string, { label: string; color: string }> = {
  BAJA: { label: "Baja", color: "bg-slate-100 text-slate-600" },
  MEDIA: { label: "Media", color: "bg-yellow-100 text-yellow-700" },
  ALTA: { label: "Alta", color: "bg-red-100 text-red-700" },
}

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const date = new Date(dateStr).getTime()
  const diff = Math.floor((now - date) / 1000)

  if (diff < 60) return "ahora"
  if (diff < 3600) return `hace ${Math.floor(diff / 60)}m`
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`
  if (diff < 604800) return `hace ${Math.floor(diff / 86400)}d`
  return new Date(dateStr).toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
  })
}

interface Stats {
  abiertos: number
  enProceso: number
  resueltos: number
  total: number
}

export function TicketsListSuperadmin() {
  const router = useRouter()
  const [tickets, setTickets] = useState<TicketItem[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [filtroEstado, setFiltroEstado] = useState("")
  const [filtroPrioridad, setFiltroPrioridad] = useState("")
  const [filtroTipo, setFiltroTipo] = useState("")
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 20
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounce search
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [search])

  const fetchTickets = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      params.append("page", page.toString())
      params.append("limit", pageSize.toString())
      if (filtroEstado) params.append("estado", filtroEstado)
      if (filtroPrioridad) params.append("prioridad", filtroPrioridad)
      if (filtroTipo) params.append("tipo", filtroTipo)
      if (debouncedSearch) params.append("search", debouncedSearch)

      const res = await fetch(`/api/superadmin/soporte?${params}`)
      if (res.ok) {
        const data = await res.json()
        setTickets(data.tickets || [])
        setTotal(data.total || 0)
      }
    } catch (err) {
      console.error("Error:", err)
    } finally {
      setLoading(false)
    }
  }, [filtroEstado, filtroPrioridad, filtroTipo, debouncedSearch, page])

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/superadmin/soporte/stats")
      if (res.ok) {
        setStats(await res.json())
      }
    } catch (err) {
      console.error("Error fetching stats:", err)
    }
  }, [])

  useEffect(() => {
    fetchTickets()
    fetchStats()
  }, [fetchTickets, fetchStats])

  const handleStatClick = (estado: string) => {
    setFiltroEstado((prev) => (prev === estado ? "" : estado))
    setPage(1)
  }

  return (
    <div className="space-y-4">
      {/* Stats - clickeables */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card
            className={`p-3 cursor-pointer transition-all hover:ring-2 hover:ring-blue-400 ${filtroEstado === "ABIERTO" ? "ring-2 ring-blue-500" : ""}`}
            onClick={() => handleStatClick("ABIERTO")}
          >
            <p className="text-2xl font-bold text-blue-600">{stats.abiertos}</p>
            <p className="text-xs text-muted-foreground">Abiertos</p>
          </Card>
          <Card
            className={`p-3 cursor-pointer transition-all hover:ring-2 hover:ring-amber-400 ${filtroEstado === "EN_PROCESO" ? "ring-2 ring-amber-500" : ""}`}
            onClick={() => handleStatClick("EN_PROCESO")}
          >
            <p className="text-2xl font-bold text-amber-600">{stats.enProceso}</p>
            <p className="text-xs text-muted-foreground">En proceso</p>
          </Card>
          <Card
            className={`p-3 cursor-pointer transition-all hover:ring-2 hover:ring-green-400 ${filtroEstado === "RESUELTO" ? "ring-2 ring-green-500" : ""}`}
            onClick={() => handleStatClick("RESUELTO")}
          >
            <p className="text-2xl font-bold text-green-600">{stats.resueltos}</p>
            <p className="text-xs text-muted-foreground">Resueltos</p>
          </Card>
          <Card
            className={`p-3 cursor-pointer transition-all hover:ring-2 hover:ring-gray-400 ${filtroEstado === "" ? "ring-2 ring-gray-500" : ""}`}
            onClick={() => { setFiltroEstado(""); setPage(1) }}
          >
            <p className="text-2xl font-bold">{stats.total}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2">
            <Headset className="h-5 w-5" />
            Todos los Tickets
          </CardTitle>
          <div className="flex flex-col sm:flex-row gap-3 mt-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por asunto..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={filtroEstado || "all"} onValueChange={(v) => { setFiltroEstado(v === "all" ? "" : v); setPage(1) }}>
              <SelectTrigger className="w-full sm:w-[160px]">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="ABIERTO">Abierto</SelectItem>
                <SelectItem value="EN_PROCESO">En proceso</SelectItem>
                <SelectItem value="RESUELTO">Resuelto</SelectItem>
                <SelectItem value="CERRADO">Cerrado</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filtroPrioridad || "all"} onValueChange={(v) => { setFiltroPrioridad(v === "all" ? "" : v); setPage(1) }}>
              <SelectTrigger className="w-full sm:w-[140px]">
                <SelectValue placeholder="Prioridad" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="ALTA">Alta</SelectItem>
                <SelectItem value="MEDIA">Media</SelectItem>
                <SelectItem value="BAJA">Baja</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filtroTipo || "all"} onValueChange={(v) => { setFiltroTipo(v === "all" ? "" : v); setPage(1) }}>
              <SelectTrigger className="w-full sm:w-[150px]">
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="BUG">Bug</SelectItem>
                <SelectItem value="SUGERENCIA">Sugerencia</SelectItem>
                <SelectItem value="PREGUNTA">Pregunta</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : tickets.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Headset className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No hay tickets de soporte</p>
            </div>
          ) : (
            <div className="space-y-2">
              {tickets.map((ticket) => {
                const tipo = tipoConfig[ticket.tipo]
                const estado = estadoConfig[ticket.estado]
                const prioridad = prioridadConfig[ticket.prioridad]
                const TipoIcon = tipo?.icon || HelpCircle

                return (
                  <div
                    key={ticket.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push(`/superadmin/soporte/${ticket.id}`)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); router.push(`/superadmin/soporte/${ticket.id}`); } }}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-accent/50 transition-colors ${ticket.noLeidos > 0 ? "border-blue-300 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20" : ""}`}
                  >
                    <div className="relative">
                      <div className={`p-2 rounded-lg shrink-0 ${tipo?.color || ""}`}>
                        <TipoIcon className="h-4 w-4" />
                      </div>
                      {ticket.noLeidos > 0 && (
                        <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-blue-500 text-white text-[10px] font-bold flex items-center justify-center">
                          {ticket.noLeidos}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`font-medium truncate ${ticket.noLeidos > 0 ? "font-semibold" : ""}`}>{ticket.asunto}</p>
                      </div>
                      {/* Preview del ultimo mensaje */}
                      {ticket.ultimoMensaje && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {ticket.ultimoMensaje.autorTipo === "SUPERADMIN" ? "Soporte: " : ""}
                          {ticket.ultimoMensaje.contenido}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Building2 className="h-3 w-3" />
                          {ticket.organizacion?.nombre || "Sin org"}
                        </span>
                        <span>·</span>
                        <span>{ticket.usuario?.nombre || "Usuario"}</span>
                        <span>·</span>
                        <span>{timeAgo(ticket.updatedAt)}</span>
                        {ticket.totalMensajes > 1 && (
                          <>
                            <span>·</span>
                            <span className="flex items-center gap-0.5">
                              <MessageSquare className="h-3 w-3" />
                              {ticket.totalMensajes}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${prioridad?.color || ""}`}>
                        {prioridad?.label}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${estado?.color || ""}`}>
                        {estado?.label}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Pagination */}
          {total > pageSize && (
            <div className="flex items-center justify-between pt-4 border-t mt-4">
              <p className="text-sm text-muted-foreground">
                {Math.min((page - 1) * pageSize + 1, total)}-{Math.min(page * pageSize, total)} de {total} tickets
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => p - 1)}
                  disabled={page <= 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground">
                  Pagina {page} de {Math.ceil(total / pageSize)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => p + 1)}
                  disabled={page >= Math.ceil(total / pageSize)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
