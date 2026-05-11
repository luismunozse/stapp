"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  Mail,
  Phone,
  Building2,
  Bot,
  User,
  Clock,
  Globe,
  MessageCircle,
  Loader2,
  Save,
  ExternalLink,
  Flame,
  Sparkles,
  MapPin,
  Users as UsersIcon,
  Wrench,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useSuperadminFetch, useSuperadminMutation } from "@/hooks/use-superadmin-fetch"
import { cn } from "@/lib/utils"

interface Mensaje {
  id: string
  tipo: "USER" | "ASSISTANT"
  contenido: string
  intencion_detectada: string | null
  confianza: number | null
  tiempo_respuesta_ms: number | null
  created_at: string
}

interface Conversacion {
  id: string
  session_id: string
  ip_address: string | null
  user_agent: string | null
  referrer: string | null
  created_at: string
  mensajes: Mensaje[]
}

interface Lead {
  id: string
  nombre: string | null
  email: string | null
  telefono: string | null
  empresa: string | null
  estado: string
  origen: string
  interes: string | null
  notas: string | null
  created_at: string
  ultima_interaccion: string | null
  score: number
  urgencia: "alta" | "media" | "baja" | null
  ciudad: string | null
  sistema_actual: string | null
  cantidad_tecnicos: number | null
  resumen_conversacion: string | null
}

const urgenciaColors: Record<string, string> = {
  alta: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-200",
  media: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200",
  baja: "bg-slate-500/10 text-slate-700 dark:text-slate-400 border-slate-200",
}

function scoreBadgeClass(score: number): string {
  if (score >= 80) return "bg-red-500/10 text-red-700 dark:text-red-400 border-red-200"
  if (score >= 60) return "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-200"
  if (score >= 40) return "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-200"
  return "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-200"
}

interface LeadDetailResponse {
  lead: Lead
  conversaciones: Conversacion[]
}

const estadoColors: Record<string, string> = {
  NUEVO: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200",
  CONTACTADO: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-200",
  CALIFICADO: "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-200",
  CONVERTIDO: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-200",
  DESCARTADO: "bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-200",
}

export function LeadDetailContent({ leadId }: { leadId: string }) {
  const router = useRouter()
  const { data, loading, fetchData } = useSuperadminFetch<LeadDetailResponse>({ showErrorToast: true })
  const { mutate, loading: saving } = useSuperadminMutation()
  const [estado, setEstado] = useState("")
  const [notas, setNotas] = useState("")

  const loadDetail = useCallback(async () => {
    const result = await fetchData(`/api/superadmin/leads/${leadId}`)
    if (result) {
      setEstado(result.lead.estado)
      setNotas(result.lead.notas || "")
    }
  }, [fetchData, leadId])

  useEffect(() => {
    loadDetail()
  }, [loadDetail])

  const handleSave = async () => {
    await mutate(`/api/superadmin/leads`, {
      method: "PATCH",
      body: { id: leadId, estado, notas },
      successMessage: "Lead actualizado",
      onSuccess: () => loadDetail(),
    })
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!data) return null

  const { lead, conversaciones } = data
  const totalMensajes = conversaciones.reduce((acc, c) => acc + c.mensajes.length, 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push("/superadmin/leads")}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{lead.nombre || "Lead sin nombre"}</h1>
          <p className="text-muted-foreground text-sm">
            Capturado el {new Date(lead.created_at).toLocaleDateString("es-AR", {
              day: "2-digit",
              month: "long",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })} via {lead.origen}
          </p>
        </div>
        <Badge variant="outline" className={cn("text-sm font-semibold gap-1", scoreBadgeClass(lead.score))}>
          <Sparkles className="w-3 h-3" />
          Score {lead.score}
        </Badge>
        {lead.urgencia && (
          <Badge variant="outline" className={cn("text-sm gap-1", urgenciaColors[lead.urgencia])}>
            <Flame className="w-3 h-3" />
            {lead.urgencia}
          </Badge>
        )}
        <Badge className={cn("text-sm", estadoColors[lead.estado])}>{lead.estado}</Badge>
      </div>

      {lead.resumen_conversacion && (
        <Card className={cn(lead.score >= 80 && "border-red-200 bg-red-50/50 dark:bg-red-950/20")}>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start gap-3">
              <Bot className="w-5 h-5 text-purple-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-xs font-medium text-muted-foreground mb-1">Resumen del chatbot</p>
                <p className="text-sm">{lead.resumen_conversacion}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: Info + Actions */}
        <div className="space-y-4">
          {/* Contact info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Datos de contacto</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {lead.email && (
                <a href={`mailto:${lead.email}`} className="flex items-center gap-2 text-sm hover:text-primary transition-colors">
                  <Mail className="w-4 h-4 text-muted-foreground" />
                  {lead.email}
                  <ExternalLink className="w-3 h-3 text-muted-foreground" />
                </a>
              )}
              {lead.telefono && (
                <a href={`https://wa.me/${lead.telefono.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm hover:text-green-600 transition-colors">
                  <Phone className="w-4 h-4 text-muted-foreground" />
                  {lead.telefono}
                  <ExternalLink className="w-3 h-3 text-muted-foreground" />
                </a>
              )}
              {lead.empresa && (
                <div className="flex items-center gap-2 text-sm">
                  <Building2 className="w-4 h-4 text-muted-foreground" />
                  {lead.empresa}
                </div>
              )}
              {lead.interes && (
                <div className="flex items-center gap-2 text-sm">
                  <MessageCircle className="w-4 h-4 text-muted-foreground" />
                  {lead.interes}
                </div>
              )}
              {!lead.email && !lead.telefono && (
                <p className="text-sm text-muted-foreground">Sin datos de contacto</p>
              )}
            </CardContent>
          </Card>

          {(lead.ciudad || lead.sistema_actual || lead.cantidad_tecnicos !== null) && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Calificación</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {lead.ciudad && (
                  <div className="flex items-center gap-2 text-sm">
                    <MapPin className="w-4 h-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Ciudad:</span>
                    <span>{lead.ciudad}</span>
                  </div>
                )}
                {lead.cantidad_tecnicos !== null && (
                  <div className="flex items-center gap-2 text-sm">
                    <UsersIcon className="w-4 h-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Técnicos:</span>
                    <span>{lead.cantidad_tecnicos}</span>
                  </div>
                )}
                {lead.sistema_actual && (
                  <div className="flex items-center gap-2 text-sm">
                    <Wrench className="w-4 h-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Sistema actual:</span>
                    <span>{lead.sistema_actual}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Actions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Gestionar</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Estado</label>
                <Select value={estado} onValueChange={setEstado}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NUEVO">Nuevo</SelectItem>
                    <SelectItem value="CONTACTADO">Contactado</SelectItem>
                    <SelectItem value="CALIFICADO">Calificado</SelectItem>
                    <SelectItem value="CONVERTIDO">Convertido</SelectItem>
                    <SelectItem value="DESCARTADO">Descartado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Notas internas</label>
                <Textarea
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                  placeholder="Agregar notas sobre este lead..."
                  rows={4}
                />
              </div>
              <Button onClick={handleSave} disabled={saving} className="w-full" size="sm">
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Guardar cambios
              </Button>
            </CardContent>
          </Card>

          {/* Metadata */}
          {conversaciones.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Metadata</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <MessageCircle className="w-3.5 h-3.5" />
                  {conversaciones.length} conversaci{conversaciones.length !== 1 ? "ones" : "ón"}, {totalMensajes} mensajes
                </div>
                {conversaciones[0]?.ip_address && (
                  <div className="flex items-center gap-2">
                    <Globe className="w-3.5 h-3.5" />
                    IP: {conversaciones[0].ip_address}
                  </div>
                )}
                {conversaciones[0]?.referrer && (
                  <div className="flex items-center gap-2 truncate">
                    <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
                    {conversaciones[0].referrer}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: Chat history */}
        <div className="lg:col-span-2">
          {conversaciones.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <MessageCircle className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p>Este lead no tiene conversaciones con el chatbot</p>
              </CardContent>
            </Card>
          ) : (
            conversaciones.map((conv, idx) => (
              <Card key={conv.id} className={idx > 0 ? "mt-4" : ""}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Bot className="w-4 h-4 text-purple-500" />
                      Conversación con Santi
                    </CardTitle>
                    <span className="text-xs text-muted-foreground">
                      {new Date(conv.created_at).toLocaleDateString("es-AR", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {" - "}
                      {conv.mensajes.length} mensajes
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
                    {conv.mensajes.map((msg) => (
                      <div
                        key={msg.id}
                        className={cn(
                          "flex gap-2.5",
                          msg.tipo === "USER" ? "flex-row-reverse" : "flex-row"
                        )}
                      >
                        <div className={cn(
                          "w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs",
                          msg.tipo === "USER"
                            ? "bg-primary/10 text-primary"
                            : "bg-purple-500/10 text-purple-500"
                        )}>
                          {msg.tipo === "USER" ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                        </div>
                        <div className={cn(
                          "max-w-[80%] rounded-xl px-3 py-2",
                          msg.tipo === "USER"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                        )}>
                          <p className="text-sm whitespace-pre-wrap">{msg.contenido}</p>
                          <div className={cn(
                            "flex items-center gap-2 mt-1 text-[10px]",
                            msg.tipo === "USER" ? "text-primary-foreground/60" : "text-muted-foreground"
                          )}>
                            <Clock className="w-2.5 h-2.5" />
                            {new Date(msg.created_at).toLocaleTimeString("es-AR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                            {msg.intencion_detectada && msg.tipo !== "USER" && (
                              <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5">
                                {msg.intencion_detectada}
                              </Badge>
                            )}
                            {msg.tiempo_respuesta_ms && msg.tipo !== "USER" && (
                              <span>{msg.tiempo_respuesta_ms}ms</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
