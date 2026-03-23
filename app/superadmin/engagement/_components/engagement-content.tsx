"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Activity,
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  Users,
  Heart,
  Mail,
  RefreshCw,
  Loader2,
  Search,
  ArrowUpDown,
  Megaphone,
  Clock,
  MessageSquare,
  ThumbsUp,
  ThumbsDown,
  Minus,
} from "lucide-react"
import { useSuperadminFetch, useSuperadminMutation } from "@/hooks/use-superadmin-fetch"
import { toast } from "sonner"

interface OrgEngagement {
  id: string
  nombre: string
  slug: string
  plan: string
  subscriptionStatus: string
  avgEngagement7d: number
  ordenes7d: number
  ventas7d: number
  usuariosActivos: number
  createdAt: string
  riesgo: "alto" | "medio" | "bajo"
}

interface TrendPoint {
  fecha: string
  avgScore: number
  totalOrdenes: number
  orgsActivas: number
}

interface EngagementData {
  summary: {
    totalActive: number
    highRisk: number
    mediumRisk: number
    avgEngagement: number
    churnRate: number
    churnedThisMonth: number
  }
  organizations: OrgEngagement[]
  trend: TrendPoint[]
  emailStats: Record<string, { sent: number; failed: number }>
  churned: Array<{ organizationId: string; nombre: string; canceledAt: string }>
}

interface NpsData {
  allTime: { nps: number; promotores: number; pasivos: number; detractores: number; total: number }
  last30Days: { nps: number; promotores: number; pasivos: number; detractores: number; total: number }
  last90Days: { nps: number; promotores: number; pasivos: number; detractores: number; total: number }
  recentResponses: Array<{
    id: string; score: number; categoria: string; comentario: string | null
    createdAt: string; usuario: string; email: string; organizacion: string
  }>
}

const riesgoBadge = (riesgo: string) => {
  switch (riesgo) {
    case "alto":
      return <Badge variant="destructive">Alto riesgo</Badge>
    case "medio":
      return <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200">Medio</Badge>
    default:
      return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200">Saludable</Badge>
  }
}

const engagementBar = (score: number) => {
  const color = score >= 50 ? "bg-green-500" : score >= 20 ? "bg-amber-500" : "bg-red-500"
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-sm font-medium w-8">{score}</span>
    </div>
  )
}

const EMAIL_TYPE_LABELS: Record<string, string> = {
  WELCOME: "Bienvenida",
  TIP_DAY_3: "Tip dia 3",
  TIP_DAY_7: "Tip dia 7",
  TRIAL_EXPIRING_5: "Trial -5 dias",
  TRIAL_EXPIRING_1: "Trial -1 dia",
  TRIAL_EXPIRED: "Trial expirado",
  WIN_BACK_7: "Win-back 7d",
  WIN_BACK_30: "Win-back 30d",
}

const npsColor = (nps: number) => {
  if (nps >= 50) return "text-green-600"
  if (nps >= 0) return "text-amber-600"
  return "text-red-600"
}

export function EngagementContent() {
  const { data, loading, fetchData } = useSuperadminFetch<EngagementData>({ showErrorToast: true })
  const { data: npsData, fetchData: fetchNps } = useSuperadminFetch<NpsData>({ showErrorToast: true })
  const { mutate, loading: mutating } = useSuperadminMutation()
  const [search, setSearch] = useState("")
  const [sortBy, setSortBy] = useState<"engagement" | "ordenes" | "riesgo">("riesgo")

  // Modales
  const [showBroadcast, setShowBroadcast] = useState(false)
  const [broadcastMsg, setBroadcastMsg] = useState({ title: "", message: "" })
  const [showTrialExt, setShowTrialExt] = useState<OrgEngagement | null>(null)
  const [trialForm, setTrialForm] = useState({ dias: 15, motivo: "" })

  const loadData = useCallback(async () => {
    await fetchData("/api/superadmin/stats/engagement")
    await fetchNps("/api/superadmin/stats/nps")
  }, [fetchData, fetchNps])

  useEffect(() => {
    loadData()
  }, [loadData])

  const filteredOrgs = (data?.organizations || [])
    .filter(o => !search || o.nombre.toLowerCase().includes(search.toLowerCase()) || o.slug.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === "riesgo") {
        const order = { alto: 0, medio: 1, bajo: 2 }
        return order[a.riesgo] - order[b.riesgo]
      }
      if (sortBy === "ordenes") return b.ordenes7d - a.ordenes7d
      return a.avgEngagement7d - b.avgEngagement7d
    })

  // Acciones rápidas
  const handleBroadcastToRisk = async () => {
    if (!broadcastMsg.title || !broadcastMsg.message) return
    const highRiskIds = (data?.organizations || []).filter(o => o.riesgo === "alto").map(o => o.id)
    if (highRiskIds.length === 0) {
      toast.info("No hay organizaciones en riesgo alto")
      return
    }
    await mutate("/api/superadmin/broadcast", {
      method: "POST",
      body: {
        title: broadcastMsg.title,
        message: broadcastMsg.message,
        target: "specific",
        organizationIds: highRiskIds,
        roles: ["ADMIN"],
      },
      successMessage: `Broadcast enviado a ${highRiskIds.length} orgs en riesgo`,
      onSuccess: () => {
        setShowBroadcast(false)
        setBroadcastMsg({ title: "", message: "" })
      },
    })
  }

  const handleExtendTrial = async () => {
    if (!showTrialExt) return
    await mutate("/api/superadmin/trial-extension", {
      method: "POST",
      body: {
        organizationId: showTrialExt.id,
        dias: trialForm.dias,
        motivo: trialForm.motivo || null,
      },
      successMessage: `Trial extendido ${trialForm.dias} dias para ${showTrialExt.nombre}`,
      onSuccess: () => {
        setShowTrialExt(null)
        setTrialForm({ dias: 15, motivo: "" })
        loadData()
      },
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Engagement y Retencion</h1>
          <p className="text-muted-foreground">Monitoreo de salud, NPS y acciones de retencion</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          {loading ? "Cargando..." : "Actualizar"}
        </Button>
      </div>

      {/* Quick Actions */}
      {data && (data.summary.highRisk > 0 || data.summary.mediumRisk > 0) && (
        <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="p-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                <span className="font-medium">
                  {data.summary.highRisk} orgs en riesgo alto, {data.summary.mediumRisk} en riesgo medio
                </span>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => {
                  setBroadcastMsg({
                    title: "Te extrañamos en STApp",
                    message: "Hola! Notamos que hace un tiempo no entras a tu cuenta. Estamos para ayudarte si tenes alguna duda. Responde a esta notificacion o escribinos por soporte.",
                  })
                  setShowBroadcast(true)
                }}>
                  <Megaphone className="h-4 w-4 mr-1" />
                  Contactar orgs en riesgo
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Cards */}
      {loading && !data ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="pb-2"><div className="h-4 w-20 bg-muted rounded" /></CardHeader>
              <CardContent><div className="h-7 w-12 bg-muted rounded" /></CardContent>
            </Card>
          ))}
        </div>
      ) : data ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Orgs Activas</CardTitle>
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-950"><Users className="h-4 w-4 text-blue-600" /></div>
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{data.summary.totalActive}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Engagement</CardTitle>
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-950"><Activity className="h-4 w-4 text-green-600" /></div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data.summary.avgEngagement}/100</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Riesgo Alto</CardTitle>
              <div className="p-2 rounded-lg bg-red-100 dark:bg-red-950"><AlertTriangle className="h-4 w-4 text-red-600" /></div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{data.summary.highRisk}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Churn Rate</CardTitle>
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-950"><TrendingUp className="h-4 w-4 text-purple-600" /></div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data.summary.churnRate}%</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">NPS Score</CardTitle>
              <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-950"><MessageSquare className="h-4 w-4 text-indigo-600" /></div>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${npsColor(npsData?.last30Days?.nps || 0)}`}>
                {npsData?.last30Days?.nps ?? "—"}
              </div>
              <p className="text-xs text-muted-foreground">{npsData?.last30Days?.total || 0} resp.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Saludables</CardTitle>
              <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-950"><Heart className="h-4 w-4 text-emerald-600" /></div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-600">
                {data.summary.totalActive - data.summary.highRisk - data.summary.mediumRisk}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Engagement Trend */}
      {data && data.trend.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Tendencia de Engagement (30 dias)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-1 h-32">
              {data.trend.slice(-30).map((point, i) => {
                const height = Math.max(4, (point.avgScore / 100) * 128)
                const color = point.avgScore >= 50 ? "bg-green-500" : point.avgScore >= 20 ? "bg-amber-500" : "bg-red-500"
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${point.fecha}: Score ${point.avgScore}, ${point.totalOrdenes} ordenes, ${point.orgsActivas} orgs`}>
                    <div className={`w-full rounded-t ${color}`} style={{ height: `${height}px` }} />
                  </div>
                )
              })}
            </div>
            <div className="flex justify-between mt-2 text-xs text-muted-foreground">
              <span>{data.trend[0]?.fecha}</span>
              <span>{data.trend[data.trend.length - 1]?.fecha}</span>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Organizations Table */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Salud por Organizacion
              </CardTitle>
              <div className="flex gap-2 mt-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Buscar organizacion..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
                </div>
                <Button variant="outline" size="sm" onClick={() => setSortBy(s => s === "riesgo" ? "engagement" : s === "engagement" ? "ordenes" : "riesgo")}>
                  <ArrowUpDown className="h-4 w-4 mr-1" />
                  {sortBy === "riesgo" ? "Riesgo" : sortBy === "engagement" ? "Score" : "Ordenes"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {filteredOrgs.map(org => (
                  <div key={org.id} className="flex items-center justify-between py-3 px-3 border rounded-lg hover:bg-muted/50 transition-colors">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium truncate">{org.nombre}</p>
                        <Badge variant="outline" className="text-xs shrink-0">{org.plan}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{org.slug}.stapp.com.ar</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right hidden sm:block">
                        <p className="text-sm font-medium">{org.ordenes7d} ord</p>
                        <p className="text-xs text-muted-foreground">{org.ventas7d} ventas</p>
                      </div>
                      <div className="hidden md:block">
                        {engagementBar(org.avgEngagement7d)}
                      </div>
                      {riesgoBadge(org.riesgo)}
                      {/* Acción rápida: extender trial */}
                      {(org.subscriptionStatus === "TRIALING" || org.riesgo === "alto") && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="Extender trial"
                          onClick={() => {
                            setShowTrialExt(org)
                            setTrialForm({ dias: 15, motivo: "" })
                          }}
                        >
                          <Clock className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
                {filteredOrgs.length === 0 && (
                  <p className="text-center text-muted-foreground py-8">No hay organizaciones</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* NPS Overview */}
          {npsData && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5" />
                  NPS Score
                </CardTitle>
                <CardDescription>Net Promoter Score</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-center mb-4">
                  <div className={`text-5xl font-bold ${npsColor(npsData.allTime.nps)}`}>
                    {npsData.allTime.total > 0 ? npsData.allTime.nps : "—"}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {npsData.allTime.total} respuestas totales
                  </p>
                </div>
                {npsData.allTime.total > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-1.5">
                        <ThumbsUp className="h-3.5 w-3.5 text-green-600" />
                        <span>Promotores (9-10)</span>
                      </div>
                      <span className="font-medium text-green-600">{npsData.allTime.promotores}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-1.5">
                        <Minus className="h-3.5 w-3.5 text-amber-600" />
                        <span>Pasivos (7-8)</span>
                      </div>
                      <span className="font-medium text-amber-600">{npsData.allTime.pasivos}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-1.5">
                        <ThumbsDown className="h-3.5 w-3.5 text-red-600" />
                        <span>Detractores (0-6)</span>
                      </div>
                      <span className="font-medium text-red-600">{npsData.allTime.detractores}</span>
                    </div>
                  </div>
                )}

                {/* Recent comments */}
                {npsData.recentResponses.filter(r => r.comentario).length > 0 && (
                  <div className="mt-4 pt-4 border-t space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase">Comentarios recientes</p>
                    {npsData.recentResponses.filter(r => r.comentario).slice(0, 3).map(r => (
                      <div key={r.id} className="p-2 bg-muted/50 rounded text-sm">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant={r.categoria === "PROMOTOR" ? "default" : r.categoria === "DETRACTOR" ? "destructive" : "secondary"} className="text-xs">
                            {r.score}
                          </Badge>
                          <span className="text-xs text-muted-foreground">{r.organizacion}</span>
                        </div>
                        <p className="text-muted-foreground">{r.comentario}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Lifecycle Email Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Lifecycle Emails (30d)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {data && Object.entries(data.emailStats).length > 0 ? (
                  Object.entries(data.emailStats).map(([type, stats]) => (
                    <div key={type} className="flex items-center justify-between">
                      <span className="text-sm">{EMAIL_TYPE_LABELS[type] || type}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200">
                          {stats.sent}
                        </Badge>
                        {stats.failed > 0 && (
                          <Badge variant="destructive">{stats.failed}</Badge>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Sin datos aun. Los emails se envian automaticamente.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Churned orgs */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingDown className="h-5 w-5" />
                Cancelaciones (30d)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {data && data.churned.length > 0 ? (
                  data.churned.map(c => (
                    <div key={c.organizationId} className="flex items-center justify-between py-2 border-b last:border-0">
                      <span className="text-sm font-medium">{c.nombre}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(c.canceledAt).toLocaleDateString("es-AR")}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Sin cancelaciones este mes
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Modal: Broadcast a orgs en riesgo */}
      <Dialog open={showBroadcast} onOpenChange={setShowBroadcast}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Megaphone className="h-5 w-5" />
              Contactar organizaciones en riesgo alto
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Se enviara una notificacion in-app a los admins de {data?.summary.highRisk || 0} organizaciones con riesgo alto.
          </p>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Titulo</Label>
              <Input
                value={broadcastMsg.title}
                onChange={e => setBroadcastMsg(m => ({ ...m, title: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Mensaje</Label>
              <Textarea
                value={broadcastMsg.message}
                onChange={e => setBroadcastMsg(m => ({ ...m, message: e.target.value }))}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBroadcast(false)}>Cancelar</Button>
            <Button onClick={handleBroadcastToRisk} disabled={mutating || !broadcastMsg.title || !broadcastMsg.message}>
              {mutating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Megaphone className="h-4 w-4 mr-2" />}
              Enviar a {data?.summary.highRisk || 0} orgs
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Extender trial */}
      <Dialog open={!!showTrialExt} onOpenChange={(open) => !open && setShowTrialExt(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Extender trial: {showTrialExt?.nombre}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Dias a extender</Label>
              <Input
                type="number"
                min={1}
                max={90}
                value={trialForm.dias}
                onChange={e => setTrialForm(f => ({ ...f, dias: parseInt(e.target.value) || 15 }))}
              />
              <p className="text-xs text-muted-foreground">Maximo 90 dias</p>
            </div>
            <div className="space-y-2">
              <Label>Motivo (opcional)</Label>
              <Textarea
                placeholder="Ej: cliente prometedor, pidio mas tiempo para evaluar..."
                value={trialForm.motivo}
                onChange={e => setTrialForm(f => ({ ...f, motivo: e.target.value }))}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTrialExt(null)}>Cancelar</Button>
            <Button onClick={handleExtendTrial} disabled={mutating || trialForm.dias < 1}>
              {mutating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Extender {trialForm.dias} dias
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
