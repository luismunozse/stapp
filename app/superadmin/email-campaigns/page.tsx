"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Mail,
  Send,
  Loader2,
  Users,
  Eye,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertTriangle,
  Clock,
  History,
  Sparkles,
  X,
} from "lucide-react"
import { useSuperadminFetch, useSuperadminMutation } from "@/hooks/use-superadmin-fetch"
import { toast } from "sonner"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

interface SegmentOrg {
  id: string
  nombre: string
  slug: string
  trialEnd: string | null
}

interface Segment {
  id: string
  nombre: string
  descripcion: string
  count: number
  orgs: SegmentOrg[]
  color: string
}

interface Campaign {
  emailType: string
  sentAt: string
  totalSent: number
  totalFailed: number
  subject: string
}

interface CampaignData {
  segments: Segment[]
  campaigns: Campaign[]
}

const ROOT_DOMAIN = "stapp.com.ar"

const TEMPLATES: Record<string, { subject: string; body: string }> = {
  trial_expired: {
    subject: "Te damos 7 dias mas para que pruebes STApp",
    body: `Hola {{nombre}},

Vimos que tu periodo de prueba en {{organizacion}} termino y no queremos que te quedes sin conocer todo lo que STApp puede hacer por tu negocio.

Por eso, te reactivamos la cuenta por 7 dias mas para que puedas probar todas las funcionalidades sin compromiso.

Esto es lo que podes hacer ahora mismo:

- Cargar ordenes de servicio reales y hacer el seguimiento completo
- Enviar notificaciones automaticas por WhatsApp a tus clientes
- Generar presupuestos con firma digital desde el celular
- Cobrar ordenes con multiples metodos de pago y cuotas
- Controlar tu inventario de repuestos y accesorios
- Registrar ventas por mostrador
- Ver reportes y metricas de tu negocio en tiempo real
- Compartir el seguimiento publico de cada orden con tus clientes
- Gestionar garantias con certificado digital

Tu cuenta ya esta activa. Solo tenes que entrar:

https://{{slug}}.${ROOT_DOMAIN}

Todos tus datos anteriores siguen ahi, tal como los dejaste.

Si tenes alguna duda o necesitas ayuda para arrancar, responde a este correo y te ayudamos.

Saludos,
El equipo de STApp`,
  },
  trial_expiring: {
    subject: "Tu prueba gratuita esta por vencer",
    body: `Hola {{nombre}},

Tu periodo de prueba en {{organizacion}} esta por terminar.

No pierdas el acceso a tu cuenta y todos los datos que cargaste. Suscribite al plan Premium para seguir usando STApp sin interrupciones.

Entra a https://{{slug}}.${ROOT_DOMAIN}/suscripcion para ver los planes.

Saludos,
El equipo de STApp`,
  },
  win_back: {
    subject: "Te extrañamos en STApp",
    body: `Hola {{nombre}},

Hace un tiempo que no te vemos por {{organizacion}}. Queremos que sepas que tu cuenta y todos tus datos siguen activos.

Mientras no estabas, seguimos mejorando STApp con nuevas funcionalidades. Entra y mira las novedades.

https://{{slug}}.${ROOT_DOMAIN}

Necesitas ayuda? Responde a este correo.

Saludos,
El equipo de STApp`,
  },
  upgrade: {
    subject: "Oferta especial para tu negocio",
    body: `Hola {{nombre}},

Tenemos una oferta especial para {{organizacion}}. Suscribite al plan Premium y obtene acceso a todas las funcionalidades:

- Ordenes de servicio ilimitadas
- Tecnicos y vendedores ilimitados
- Notificaciones automaticas por WhatsApp
- Soporte prioritario

Entra a https://{{slug}}.${ROOT_DOMAIN}/suscripcion para ver los planes.

Saludos,
El equipo de STApp`,
  },
  custom: {
    subject: "",
    body: `Hola {{nombre}},

[Tu mensaje aqui]

Saludos,
El equipo de STApp`,
  },
}

const TEMPLATE_LABELS: Record<string, string> = {
  trial_expired: "Trial vencido - 7 dias mas",
  trial_expiring: "Trial por vencer - Suscribirse",
  win_back: "Win-back - Te extrañamos",
  upgrade: "Oferta de upgrade",
  custom: "Mensaje personalizado",
}

const SEGMENT_COLORS: Record<string, string> = {
  red: "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30",
  orange: "border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/30",
  amber: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30",
  blue: "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30",
  yellow: "border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950/30",
  gray: "border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950/30",
}

const SEGMENT_ICONS: Record<string, typeof AlertTriangle> = {
  trial_expired: AlertTriangle,
  trial_expiring_3: Clock,
  trial_expiring_7: Clock,
  all_trialing: Users,
  inactive_7: Clock,
  inactive_30: AlertTriangle,
  canceled: X,
}

const CAMPAIGN_TYPE_MAP: Record<string, string> = {
  trial_expired: "CAMPAIGN_TRIAL_EXPIRED",
  trial_expiring: "CAMPAIGN_TRIAL_EXPIRING",
  win_back: "CAMPAIGN_WIN_BACK",
  upgrade: "CAMPAIGN_UPGRADE",
  custom: "CAMPAIGN_CUSTOM",
}

const CAMPAIGN_LABELS: Record<string, string> = {
  CAMPAIGN_CUSTOM: "Personalizado",
  CAMPAIGN_TRIAL_EXPIRED: "Trial vencido",
  CAMPAIGN_TRIAL_EXPIRING: "Trial por vencer",
  CAMPAIGN_WIN_BACK: "Win-back",
  CAMPAIGN_UPGRADE: "Upgrade",
}

export default function EmailCampaignsPage() {
  const { data, loading, fetchData } = useSuperadminFetch<CampaignData>({ showErrorToast: true })
  const { mutate, loading: sending } = useSuperadminMutation<{ sent: number; failed: number; total: number }>()

  // State
  const [selectedSegment, setSelectedSegment] = useState<Segment | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState<string>("")
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [selectedOrgIds, setSelectedOrgIds] = useState<string[]>([])
  const [expandedSegment, setExpandedSegment] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [lastResult, setLastResult] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    await fetchData("/api/superadmin/email-campaigns")
  }, [fetchData])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Seleccionar segmento
  const handleSelectSegment = (segment: Segment) => {
    setSelectedSegment(segment)
    setSelectedOrgIds(segment.orgs.map(o => o.id))
    setLastResult(null)

    // Auto-seleccionar template según segmento
    if (segment.id === "trial_expired") {
      applyTemplate("trial_expired")
    } else if (segment.id.startsWith("trial_expiring")) {
      applyTemplate("trial_expiring")
    } else if (segment.id.startsWith("inactive")) {
      applyTemplate("win_back")
    } else if (segment.id === "canceled") {
      applyTemplate("win_back")
    } else {
      applyTemplate("custom")
    }
  }

  const applyTemplate = (templateId: string) => {
    const template = TEMPLATES[templateId]
    if (template) {
      setSelectedTemplate(templateId)
      setSubject(template.subject)
      setBody(template.body)
    }
  }

  const toggleOrg = (orgId: string) => {
    setSelectedOrgIds(prev =>
      prev.includes(orgId) ? prev.filter(id => id !== orgId) : [...prev, orgId]
    )
  }

  const handleSend = () => {
    if (!subject.trim()) {
      toast.error("El asunto es requerido")
      return
    }
    if (!body.trim()) {
      toast.error("El contenido es requerido")
      return
    }
    if (selectedOrgIds.length === 0) {
      toast.error("Selecciona al menos una organizacion")
      return
    }
    setConfirmOpen(true)
  }

  const handleConfirmSend = async () => {
    setConfirmOpen(false)

    // Convertir body texto plano a HTML básico
    const htmlBody = textToHtml(body, subject)

    await mutate("/api/superadmin/email-campaigns", {
      method: "POST",
      body: {
        segmentId: selectedSegment?.id || null,
        organizationIds: selectedOrgIds,
        subject: subject.trim(),
        htmlContent: htmlBody,
        emailType: CAMPAIGN_TYPE_MAP[selectedTemplate] || "CAMPAIGN_CUSTOM",
      },
      successMessage: "Campaña enviada",
      errorMessage: "Error al enviar campaña",
      onSuccess: (result) => {
        setLastResult(`${result.sent} enviados, ${result.failed} fallidos de ${result.total} total`)
        loadData() // Refresh historial
      },
    })
  }

  // Preview con datos de ejemplo
  const getPreviewHtml = () => {
    const sampleOrg = selectedSegment?.orgs[0]
    return body
      .replace(/\{\{nombre\}\}/g, "[Nombre del admin]")
      .replace(/\{\{organizacion\}\}/g, sampleOrg?.nombre || "[Nombre de la org]")
      .replace(/\{\{slug\}\}/g, sampleOrg?.slug || "[slug]")
  }

  const segments = data?.segments || []
  const campaigns = data?.campaigns || []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Mail className="h-6 w-6" />
          Campañas de Email
        </h1>
        <p className="text-muted-foreground mt-1">
          Envia emails masivos a segmentos de organizaciones
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {/* Paso 1: Segmentos */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5" />
                1. Elegir segmento
              </CardTitle>
              <CardDescription>
                Selecciona el grupo de organizaciones al que queres enviar
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading && !data ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {segments.map((segment) => {
                    const isSelected = selectedSegment?.id === segment.id
                    const isExpanded = expandedSegment === segment.id
                    const Icon = SEGMENT_ICONS[segment.id] || Users

                    return (
                      <div key={segment.id} className="space-y-0">
                        <button
                          onClick={() => {
                            if (segment.count === 0) return
                            handleSelectSegment(segment)
                          }}
                          disabled={segment.count === 0}
                          className={`
                            w-full text-left p-4 rounded-lg border-2 transition-all
                            ${isSelected
                              ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                              : segment.count === 0
                                ? "border-muted opacity-50 cursor-not-allowed"
                                : `${SEGMENT_COLORS[segment.color] || ""} hover:border-primary/50 cursor-pointer`
                            }
                          `}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Icon className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium text-sm">{segment.nombre}</span>
                            </div>
                            <Badge variant={segment.count > 0 ? "default" : "secondary"} className="text-xs">
                              {segment.count}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{segment.descripcion}</p>
                        </button>

                        {/* Expand to see orgs */}
                        {isSelected && segment.orgs.length > 0 && (
                          <div className="px-1">
                            <button
                              onClick={() => setExpandedSegment(isExpanded ? null : segment.id)}
                              className="text-xs text-primary flex items-center gap-1 py-1 hover:underline"
                            >
                              {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                              {isExpanded ? "Ocultar" : "Ver"} organizaciones ({segment.orgs.length})
                            </button>
                            {isExpanded && (
                              <div className="max-h-40 overflow-y-auto border rounded p-2 space-y-1 mt-1 bg-background">
                                {segment.orgs.map((org) => (
                                  <label
                                    key={org.id}
                                    className="flex items-center gap-2 px-2 py-1 rounded hover:bg-accent cursor-pointer text-xs"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={selectedOrgIds.includes(org.id)}
                                      onChange={() => toggleOrg(org.id)}
                                      className="h-3.5 w-3.5 rounded border-input accent-primary"
                                    />
                                    <span className="truncate flex-1">{org.nombre}</span>
                                    <span className="text-muted-foreground">{org.slug}</span>
                                  </label>
                                ))}
                                <div className="flex gap-2 pt-1 border-t mt-1">
                                  <button
                                    onClick={() => setSelectedOrgIds(segment.orgs.map(o => o.id))}
                                    className="text-[11px] text-primary hover:underline"
                                  >
                                    Seleccionar todas
                                  </button>
                                  <button
                                    onClick={() => setSelectedOrgIds([])}
                                    className="text-[11px] text-muted-foreground hover:underline"
                                  >
                                    Deseleccionar
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Paso 2: Template + Contenido */}
          {selectedSegment && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Sparkles className="h-5 w-5" />
                  2. Componer email
                </CardTitle>
                <CardDescription>
                  Elegí un template o escribí un mensaje personalizado. Usa {"{{nombre}}"}, {"{{organizacion}}"}, {"{{slug}}"} para personalizar.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Template selector */}
                <div className="space-y-2">
                  <Label>Template</Label>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(TEMPLATE_LABELS).map(([id, label]) => (
                      <Button
                        key={id}
                        variant={selectedTemplate === id ? "default" : "outline"}
                        size="sm"
                        onClick={() => applyTemplate(id)}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="subject">Asunto</Label>
                  <Input
                    id="subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Asunto del email"
                    maxLength={150}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="body">Contenido</Label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowPreview(!showPreview)}
                    >
                      <Eye className="h-3.5 w-3.5 mr-1" />
                      {showPreview ? "Editar" : "Preview"}
                    </Button>
                  </div>

                  {showPreview ? (
                    <div className="border rounded-lg p-4 bg-muted/30 min-h-[200px] whitespace-pre-wrap text-sm">
                      {getPreviewHtml()}
                    </div>
                  ) : (
                    <Textarea
                      id="body"
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      rows={10}
                      className="font-mono text-sm"
                      placeholder="Contenido del email..."
                    />
                  )}
                  <p className="text-xs text-muted-foreground">
                    Variables: {"{{nombre}}"} = nombre del admin, {"{{organizacion}}"} = nombre de la org, {"{{slug}}"} = subdominio
                  </p>
                </div>

                {/* Resumen y envío */}
                <div className="flex items-center justify-between pt-4 border-t">
                  <div className="text-sm text-muted-foreground">
                    Se enviara a <strong>{selectedOrgIds.length}</strong> organizacion(es)
                  </div>
                  <Button
                    onClick={handleSend}
                    disabled={sending || !subject.trim() || !body.trim() || selectedOrgIds.length === 0}
                    size="lg"
                  >
                    {sending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Enviando...
                      </>
                    ) : lastResult ? (
                      <>
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        {lastResult}
                      </>
                    ) : (
                      <>
                        <Send className="mr-2 h-4 w-4" />
                        Enviar campaña
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar: Historial */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <History className="h-5 w-5" />
                Campañas enviadas
              </CardTitle>
            </CardHeader>
            <CardContent>
              {campaigns.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No hay campañas enviadas
                </p>
              ) : (
                <div className="space-y-3">
                  {campaigns.map((campaign, i) => (
                    <div key={i} className="border rounded-lg p-3 space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-[10px]">
                          {CAMPAIGN_LABELS[campaign.emailType] || campaign.emailType}
                        </Badge>
                      </div>
                      <p className="text-sm font-medium truncate">{campaign.subject}</p>
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <span className="text-green-600">{campaign.totalSent} enviados</span>
                          {campaign.totalFailed > 0 && (
                            <span className="text-red-500">{campaign.totalFailed} fallidos</span>
                          )}
                        </div>
                        <span>{new Date(campaign.sentAt).toLocaleDateString("es-AR")}</span>
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
        title="Enviar campaña de email"
        description={`Se enviara "${subject}" a los administradores de ${selectedOrgIds.length} organizacion(es). Los emails se envian inmediatamente.`}
        confirmText="Enviar emails"
        variant="warning"
        loading={sending}
        onConfirm={handleConfirmSend}
      />
    </div>
  )
}

// Convertir texto plano a HTML con estilos
function textToHtml(text: string, subject: string): string {
  const lines = text.split("\n").map(line => {
    if (!line.trim()) return "<br>"
    // Detectar URLs y hacer links
    const withLinks = line.replace(
      /(https?:\/\/[^\s]+)/g,
      '<a href="$1" style="color: #3b82f6; text-decoration: underline;">$1</a>'
    )
    return `<p style="color: #4b5563; font-size: 15px; margin: 0 0 8px 0;">${withLinks}</p>`
  })

  return `
    <!DOCTYPE html>
    <html lang="es">
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background-color: #f3f4f6;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6;">
          <tr>
            <td align="center" style="padding: 40px 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px;">
                <tr>
                  <td style="background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); padding: 32px 40px; text-align: center; border-radius: 16px 16px 0 0;">
                    <span style="color: #ffffff; font-size: 24px; font-weight: 700;">STApp</span>
                  </td>
                </tr>
                <tr>
                  <td style="background-color: #ffffff; padding: 40px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 16px 16px;">
                    ${lines.join("\n")}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 24px 40px; text-align: center;">
                    <p style="color: #9ca3af; font-size: 13px; margin: 0;">
                      Este correo fue enviado por STApp.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `
}
