"use client"

import { useState, useMemo } from "react"
import useSWR from "swr"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Plus,
  Bug,
  Lightbulb,
  HelpCircle,
  MessageSquare,
  Paperclip,
  Search,
  Loader2,
  Headset,
} from "lucide-react"
import { TicketCreateDialog } from "./ticket-create-dialog"
import { useCurrency } from "@/contexts/currency-context"

interface TicketListItem {
  id: string
  tipo: string
  prioridad: string
  asunto: string
  estado: string
  createdAt: string
  updatedAt: string
  usuario: { nombre: string; email: string } | null
  totalMensajes: number
  tieneAdjuntos: boolean
}

const tipoConfig: Record<string, { label: string; icon: any; color: string }> = {
  BUG: { label: "Bug / Error", icon: Bug, color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  SUGERENCIA: { label: "Sugerencia", icon: Lightbulb, color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  PREGUNTA: { label: "Pregunta", icon: HelpCircle, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
}

const estadoConfig: Record<string, { label: string; variant: string }> = {
  ABIERTO: { label: "Abierto", variant: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  EN_PROCESO: { label: "En proceso", variant: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  RESUELTO: { label: "Resuelto", variant: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  CERRADO: { label: "Cerrado", variant: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400" },
}

const prioridadConfig: Record<string, { label: string; color: string }> = {
  BAJA: { label: "Baja", color: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400" },
  MEDIA: { label: "Media", color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
  ALTA: { label: "Alta", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
}

export function TicketList() {
  const router = useRouter()
  const { timezone } = useCurrency()
  const [filtroEstado, setFiltroEstado] = useState("")
  const [search, setSearch] = useState("")
  const [showCreate, setShowCreate] = useState(false)

  const fetcher = (url: string) => fetch(url).then(res => res.ok ? res.json() : [])
  const apiUrl = useMemo(() => {
    const params = new URLSearchParams()
    if (filtroEstado) params.append("estado", filtroEstado)
    return `/api/soporte?${params}`
  }, [filtroEstado])

  const { data: tickets = [], isLoading: loading, mutate } = useSWR<TicketListItem[]>(
    apiUrl, fetcher,
    { revalidateOnFocus: false, dedupingInterval: 5000 }
  )

  const filteredTickets = search
    ? tickets.filter(t => t.asunto.toLowerCase().includes(search.toLowerCase()))
    : tickets

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: timezone,
    })
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <Headset className="h-5 w-5" />
              Mis Tickets
            </CardTitle>
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Nuevo Ticket
            </Button>
          </div>
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
            <Select value={filtroEstado} onValueChange={setFiltroEstado}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Todos los estados" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="ABIERTO">Abierto</SelectItem>
                <SelectItem value="EN_PROCESO">En proceso</SelectItem>
                <SelectItem value="RESUELTO">Resuelto</SelectItem>
                <SelectItem value="CERRADO">Cerrado</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredTickets.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Headset className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No hay tickets</p>
              <p className="text-sm mt-1">Creá un nuevo ticket para reportar un problema o enviar una sugerencia</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredTickets.map((ticket) => {
                const tipo = tipoConfig[ticket.tipo]
                const estado = estadoConfig[ticket.estado]
                const prioridad = prioridadConfig[ticket.prioridad]
                const TipoIcon = tipo?.icon || HelpCircle

                return (
                  <div
                    key={ticket.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push(`/soporte/${ticket.id}`)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); router.push(`/soporte/${ticket.id}`); } }}
                    className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-accent/50 transition-colors"
                  >
                    <div className={`p-2 rounded-lg ${tipo?.color || ""}`}>
                      <TipoIcon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium truncate">{ticket.asunto}</p>
                        {ticket.tieneAdjuntos && (
                          <Paperclip className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                        <span>{formatDate(ticket.createdAt)}</span>
                        {ticket.totalMensajes > 1 && (
                          <span className="flex items-center gap-0.5">
                            <MessageSquare className="h-3 w-3" />
                            {ticket.totalMensajes}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${prioridad?.color || ""}`}>
                        {prioridad?.label}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${estado?.variant || ""}`}>
                        {estado?.label}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {showCreate && (
        <TicketCreateDialog
          onClose={() => setShowCreate(false)}
          onSuccess={() => {
            setShowCreate(false)
            mutate()
          }}
        />
      )}
    </>
  )
}
