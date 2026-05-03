"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  Search,
  Filter,
  Eye,
  Mail,
  Phone,
  Building2,
  MessageCircle,
  MessageSquare,
  RefreshCw,
  Users,
  UserCheck,
  UserX,
  Loader2,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useSuperadminFetch } from "@/hooks/use-superadmin-fetch"
import { cn } from "@/lib/utils"

interface Lead {
  id: string
  nombre: string | null
  email: string | null
  telefono: string | null
  empresa: string | null
  estado: string
  origen: string
  interes: string | null
  plan_interes: string | null
  notas: string | null
  created_at: string
  ultima_interaccion: string | null
  chatbot_conversaciones?: { id: string }[]
}

interface LeadsResponse {
  leads: Lead[]
  total: number
}

const estadoColors: Record<string, string> = {
  NUEVO: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  CONTACTADO: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
  CALIFICADO: "bg-purple-500/10 text-purple-700 dark:text-purple-400",
  CONVERTIDO: "bg-green-500/10 text-green-700 dark:text-green-400",
  DESCARTADO: "bg-gray-500/10 text-gray-700 dark:text-gray-400",
}

export function LeadsContent() {
  const router = useRouter()
  const { data, loading, fetchData } = useSuperadminFetch<LeadsResponse>({ showErrorToast: true })
  const [search, setSearch] = useState("")
  const [estado, setEstado] = useState("TODOS")
  const [origen, setOrigen] = useState("TODOS")

  const loadLeads = useCallback(async () => {
    const params = new URLSearchParams()
    if (search) params.set("search", search)
    if (estado !== "TODOS") params.set("estado", estado)
    if (origen !== "TODOS") params.set("origen", origen)
    await fetchData(`/api/superadmin/leads?${params.toString()}`)
  }, [fetchData, search, estado, origen])

  useEffect(() => {
    loadLeads()
  }, [loadLeads])

  const leads = data?.leads || []
  const total = data?.total || 0

  const stats = {
    total,
    nuevos: leads.filter((l) => l.estado === "NUEVO").length,
    convertidos: leads.filter((l) => l.estado === "CONVERTIDO").length,
    descartados: leads.filter((l) => l.estado === "DESCARTADO").length,
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Leads</h1>
          <p className="text-muted-foreground text-sm">
            Potenciales clientes capturados desde el chatbot y formularios
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadLeads} disabled={loading}>
          <RefreshCw className={cn("w-4 h-4 mr-2", loading && "animate-spin")} />
          Actualizar
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <Users className="w-4 h-4 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.total}</p>
                <p className="text-xs text-muted-foreground">Total</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-yellow-500/10">
                <MessageCircle className="w-4 h-4 text-yellow-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.nuevos}</p>
                <p className="text-xs text-muted-foreground">Nuevos</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <UserCheck className="w-4 h-4 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.convertidos}</p>
                <p className="text-xs text-muted-foreground">Convertidos</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gray-500/10">
                <UserX className="w-4 h-4 text-gray-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.descartados}</p>
                <p className="text-xs text-muted-foreground">Descartados</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nombre, email, teléfono..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadLeads()}
                className="pl-9"
              />
            </div>
            <Select value={estado} onValueChange={setEstado}>
              <SelectTrigger className="w-full sm:w-[160px]">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TODOS">Todos</SelectItem>
                <SelectItem value="NUEVO">Nuevo</SelectItem>
                <SelectItem value="CONTACTADO">Contactado</SelectItem>
                <SelectItem value="CALIFICADO">Calificado</SelectItem>
                <SelectItem value="CONVERTIDO">Convertido</SelectItem>
                <SelectItem value="DESCARTADO">Descartado</SelectItem>
              </SelectContent>
            </Select>
            <Select value={origen} onValueChange={setOrigen}>
              <SelectTrigger className="w-full sm:w-[160px]">
                <SelectValue placeholder="Origen" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TODOS">Todos</SelectItem>
                <SelectItem value="CHATBOT">Chatbot</SelectItem>
                <SelectItem value="FORMULARIO">Formulario</SelectItem>
                <SelectItem value="OTRO">Otro</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Leads list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {total} lead{total !== 1 ? "s" : ""} encontrado{total !== 1 ? "s" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading && !data ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : leads.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>No se encontraron leads</p>
            </div>
          ) : (
            <div className="space-y-2">
              {leads.map((lead) => (
                <div
                  key={lead.id}
                  className="flex items-center gap-4 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() => router.push(`/superadmin/leads/${lead.id}`)}
                >
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm flex-shrink-0">
                    {lead.nombre?.[0]?.toUpperCase() || lead.email?.[0]?.toUpperCase() || "?"}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {lead.nombre ? (
                        <span className="font-medium truncate">{lead.nombre}</span>
                      ) : lead.email ? (
                        <span className="font-medium truncate">{lead.email.split("@")[0]}</span>
                      ) : (
                        <span className="font-medium italic text-muted-foreground">Sin nombre</span>
                      )}
                      <Badge variant="secondary" className={cn("text-[10px] px-1.5 py-0", estadoColors[lead.estado])}>
                        {lead.estado}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {lead.origen}
                      </Badge>
                      {lead.plan_interes && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          Interés: {lead.plan_interes}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
                      {lead.email && (
                        <span className="flex items-center gap-1 truncate">
                          <Mail className="w-3 h-3" />
                          {lead.email}
                        </span>
                      )}
                      {lead.telefono && (
                        <span className="flex items-center gap-1">
                          <Phone className="w-3 h-3" />
                          {lead.telefono}
                        </span>
                      )}
                      {lead.empresa && (
                        <span className="flex items-center gap-1 truncate">
                          <Building2 className="w-3 h-3" />
                          {lead.empresa}
                        </span>
                      )}
                    </div>
                    {lead.interes && (
                      <p className="text-xs text-muted-foreground/80 mt-0.5 truncate italic" title={lead.interes}>
                        “{lead.interes}”
                      </p>
                    )}
                  </div>

                  {/* Date + action */}
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-xs text-muted-foreground hidden sm:block">
                      {new Date(lead.created_at).toLocaleDateString("es-AR", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {lead.chatbot_conversaciones && lead.chatbot_conversaciones.length > 0 && (
                      <Badge variant="outline" className="text-[10px] gap-1 border-violet-300 text-violet-700 dark:text-violet-400">
                        <MessageSquare className="w-3 h-3" />
                        Chat
                      </Badge>
                    )}
                    <Eye className="w-4 h-4 text-muted-foreground" aria-label="Ver detalle" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
