"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Megaphone,
  Send,
  Loader2,
  Users,
  Building2,
  History,
  CheckCircle2,
  Bell,
  ExternalLink,
} from "lucide-react"
import { useSuperadminFetch, useSuperadminMutation } from "@/hooks/use-superadmin-fetch"
import { formatDateTime } from "@/lib/utils"
import { toast } from "sonner"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

interface Organization {
  id: string
  nombre: string
  slug: string
  activo: boolean
}

interface BroadcastHistory {
  title: string
  body: string
  created_at: string
  count: number
}

const ROLES = [
  { value: "ADMIN", label: "Administradores" },
  { value: "TECNICO", label: "Tecnicos" },
  { value: "VENDEDOR", label: "Vendedores" },
]

export default function BroadcastPage() {
  const [title, setTitle] = useState("")
  const [message, setMessage] = useState("")
  const [target, setTarget] = useState<"all" | "specific">("all")
  const [selectedOrgs, setSelectedOrgs] = useState<string[]>([])
  const [selectedRoles, setSelectedRoles] = useState<string[]>([])
  const [actionUrl, setActionUrl] = useState("")
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [history, setHistory] = useState<BroadcastHistory[]>([])
  const [sent, setSent] = useState(false)
  const [lastResult, setLastResult] = useState<string>("")
  const [confirmOpen, setConfirmOpen] = useState(false)

  const { fetchData: fetchOrgs } = useSuperadminFetch<{ organizations: Organization[] }>()
  const { fetchData: fetchHistory } = useSuperadminFetch<{ broadcasts: BroadcastHistory[] }>()
  const { mutate, loading: sending } = useSuperadminMutation<{ message: string; totalUsers: number }>()

  const loadData = useCallback(async () => {
    const [orgsResult, historyResult] = await Promise.all([
      fetchOrgs("/api/superadmin/organizations?limit=500"),
      fetchHistory("/api/superadmin/broadcast"),
    ])
    if (orgsResult?.organizations) {
      setOrgs(orgsResult.organizations.filter((o) => o.activo))
    }
    if (historyResult?.broadcasts) {
      setHistory(historyResult.broadcasts)
    }
  }, [fetchOrgs, fetchHistory])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleSendClick = () => {
    if (!title.trim() || !message.trim()) {
      toast.error("Titulo y mensaje son requeridos")
      return
    }

    if (target === "specific" && selectedOrgs.length === 0) {
      toast.error("Selecciona al menos una organizacion")
      return
    }

    setConfirmOpen(true)
  }

  const handleConfirmSend = async () => {
    setConfirmOpen(false)

    await mutate("/api/superadmin/broadcast", {
      method: "POST",
      body: {
        title: title.trim(),
        message: message.trim(),
        target,
        organizationIds: target === "specific" ? selectedOrgs : undefined,
        roles: selectedRoles.length > 0 ? selectedRoles : undefined,
        actionUrl: actionUrl.trim() || undefined,
      },
      successMessage: "Notificacion enviada",
      errorMessage: "Error al enviar notificacion",
      onSuccess: (data) => {
        setLastResult(`Enviada a ${data.totalUsers} usuarios`)
        setSent(true)
        setTitle("")
        setMessage("")
        setActionUrl("")
        setSelectedOrgs([])
        setSelectedRoles([])
        loadData()
      },
    })
  }

  const toggleOrg = (orgId: string) => {
    setSelectedOrgs((prev) =>
      prev.includes(orgId) ? prev.filter((id) => id !== orgId) : [...prev, orgId]
    )
  }

  const toggleRole = (role: string) => {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Megaphone className="h-6 w-6" />
          Notificaciones Broadcast
        </h1>
        <p className="text-muted-foreground mt-1">
          Envia notificaciones masivas a los usuarios de la plataforma
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Formulario */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Componer notificacion</CardTitle>
              <CardDescription>
                La notificacion aparecera en la campana de notificaciones de cada usuario
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Titulo</Label>
                <Input
                  id="title"
                  placeholder="ej: Nueva funcionalidad disponible"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value)
                    setSent(false)
                  }}
                  maxLength={100}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="message">Mensaje</Label>
                <Textarea
                  id="message"
                  placeholder="ej: Ya podes generar cotizaciones en PDF desde la seccion de cotizaciones..."
                  value={message}
                  onChange={(e) => {
                    setMessage(e.target.value)
                    setSent(false)
                  }}
                  rows={3}
                  maxLength={500}
                />
                <p className="text-xs text-muted-foreground text-right">
                  {message.length}/500
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="actionUrl">URL de accion (opcional)</Label>
                <Input
                  id="actionUrl"
                  placeholder="ej: /cotizaciones"
                  value={actionUrl}
                  onChange={(e) => setActionUrl(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Ruta a la que navega el usuario al hacer click en la notificacion
                </p>
              </div>

              {/* Preview en vivo */}
              <div className="space-y-2 pt-2 border-t">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Preview
                </Label>
                <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                  <div className="flex items-start gap-3">
                    <div className="h-9 w-9 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                      <Bell className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {title.trim() || (
                          <span className="text-muted-foreground italic">Título de la notificación</span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words mt-0.5">
                        {message.trim() || (
                          <span className="italic">Mensaje que verá el usuario en la campana de notificaciones</span>
                        )}
                      </p>
                      {actionUrl.trim() && (
                        <p className="text-[11px] text-primary mt-1.5 inline-flex items-center gap-1">
                          <ExternalLink className="h-3 w-3" />
                          {actionUrl.trim()}
                        </p>
                      )}
                      <p className="text-[10px] text-muted-foreground mt-1">ahora</p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5" />
                Destinatarios
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Alcance</Label>
                <Select
                  value={target}
                  onValueChange={(v) => setTarget(v as "all" | "specific")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas las organizaciones activas</SelectItem>
                    <SelectItem value="specific">Organizaciones especificas</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {target === "specific" && (
                <div className="space-y-2">
                  <Label>Organizaciones</Label>
                  <div className="max-h-48 overflow-y-auto border rounded-md p-2 space-y-1">
                    {orgs.map((org) => (
                      <label
                        key={org.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={selectedOrgs.includes(org.id)}
                          onChange={() => toggleOrg(org.id)}
                          className="h-4 w-4 rounded border-input accent-primary"
                        />
                        <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="truncate">{org.nombre}</span>
                        <span className="text-xs text-muted-foreground ml-auto">{org.slug}</span>
                      </label>
                    ))}
                    {orgs.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        Cargando organizaciones...
                      </p>
                    )}
                  </div>
                  {selectedOrgs.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {selectedOrgs.length} organizacion(es) seleccionada(s)
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label>Filtrar por rol (opcional)</Label>
                <div className="flex flex-wrap gap-3">
                  {ROLES.map((role) => (
                    <label
                      key={role.value}
                      className="flex items-center gap-2 text-sm cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedRoles.includes(role.value)}
                        onChange={() => toggleRole(role.value)}
                        className="h-4 w-4 rounded border-input accent-primary"
                      />
                      {role.label}
                    </label>
                  ))}
                </div>
                {selectedRoles.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Sin filtro de rol = todos los roles
                  </p>
                )}
              </div>

              <div className="pt-2">
                <Button
                  onClick={handleSendClick}
                  disabled={sending || !title.trim() || !message.trim()}
                  className="w-full"
                  size="lg"
                >
                  {sending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Enviando...
                    </>
                  ) : sent ? (
                    <>
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      {lastResult}
                    </>
                  ) : (
                    <>
                      <Send className="mr-2 h-4 w-4" />
                      Enviar notificacion
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Historial */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <History className="h-5 w-5" />
                Historial
              </CardTitle>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No hay broadcasts enviados
                </p>
              ) : (
                <div className="space-y-3">
                  {history.map((item, i) => (
                    <div
                      key={i}
                      className="border rounded-lg p-3 space-y-1"
                    >
                      <p className="text-sm font-medium">{item.title}</p>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {item.body}
                      </p>
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
                        <span>{item.count} usuarios</span>
                        <span>{formatDateTime(item.created_at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Enviar notificacion masiva"
        description={`Se enviara "${title}" a ${target === "all" ? "todas las organizaciones activas" : `${selectedOrgs.length} organizacion(es)`}${selectedRoles.length > 0 ? ` (roles: ${selectedRoles.join(", ")})` : ""}. Esta accion no se puede deshacer.`}
        confirmText="Enviar"
        variant="warning"
        loading={sending}
        onConfirm={handleConfirmSend}
      />
    </div>
  )
}
