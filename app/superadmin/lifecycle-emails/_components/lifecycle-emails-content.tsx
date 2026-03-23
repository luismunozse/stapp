"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Mail,
  Eye,
  RefreshCw,
  Loader2,
  Monitor,
  Smartphone,
  X,
} from "lucide-react"
import { useSuperadminFetch, useSuperadminMutation } from "@/hooks/use-superadmin-fetch"
import { cn } from "@/lib/utils"

interface EmailType {
  type: string
  label: string
  description: string
}

interface PreviewData {
  subject: string
  html: string
  type: string
}

const CATEGORY_COLORS: Record<string, string> = {
  WELCOME: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  TIP_DAY_3: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  TIP_DAY_7: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  TRIAL_EXPIRING_5: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  TRIAL_EXPIRING_1: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  TRIAL_EXPIRED: "bg-gray-100 text-gray-800 dark:bg-gray-950 dark:text-gray-200",
  WIN_BACK_7: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200",
  WIN_BACK_30: "bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-200",
  MILESTONE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
}

const CATEGORY_LABELS: Record<string, string> = {
  WELCOME: "Onboarding",
  TIP_DAY_3: "Onboarding",
  TIP_DAY_7: "Onboarding",
  TRIAL_EXPIRING_5: "Conversion",
  TRIAL_EXPIRING_1: "Conversion",
  TRIAL_EXPIRED: "Conversion",
  WIN_BACK_7: "Retencion",
  WIN_BACK_30: "Retencion",
  MILESTONE: "Engagement",
}

export function LifecycleEmailsContent() {
  const { data: typesData, loading, fetchData } = useSuperadminFetch<{ types: EmailType[] }>({ showErrorToast: true })
  const { mutate, loading: previewing } = useSuperadminMutation<PreviewData>()
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [viewMode, setViewMode] = useState<"desktop" | "mobile">("desktop")

  const loadTypes = useCallback(async () => {
    await fetchData("/api/superadmin/lifecycle-preview")
  }, [fetchData])

  useEffect(() => {
    loadTypes()
  }, [loadTypes])

  const handlePreview = async (type: string) => {
    const result = await mutate("/api/superadmin/lifecycle-preview", {
      method: "POST",
      body: { type },
    })
    if (result) {
      setPreview(result)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Lifecycle Emails</h1>
          <p className="text-muted-foreground">Preview y gestion de emails automaticos de retencion</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadTypes} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Actualizar
        </Button>
      </div>

      {/* Info card */}
      <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Mail className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-sm">Emails automáticos programados</p>
              <p className="text-sm text-muted-foreground mt-1">
                Estos emails se envían automáticamente todos los días a las 11:00 AM via Vercel Cron.
                Cada email se envía una sola vez por taller y se registra en el historial.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Email list */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Emails configurados
            </CardTitle>
            <CardDescription>Hace click en "Preview" para ver como se ve cada email</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {loading && !typesData ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />
                ))
              ) : (
                (typesData?.types || []).map(emailType => (
                  <div
                    key={emailType.type}
                    className={cn(
                      "flex items-center justify-between p-3 border rounded-lg transition-colors cursor-pointer hover:bg-muted/50",
                      preview?.type === emailType.type && "ring-2 ring-primary bg-muted/50"
                    )}
                    onClick={() => handlePreview(emailType.type)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm">{emailType.label}</p>
                        <Badge variant="secondary" className={cn("text-xs", CATEGORY_COLORS[emailType.type])}>
                          {CATEGORY_LABELS[emailType.type]}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{emailType.description}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 ml-2"
                      disabled={previewing}
                      onClick={(e) => {
                        e.stopPropagation()
                        handlePreview(emailType.type)
                      }}
                    >
                      {previewing && preview?.type === emailType.type ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Eye className="h-4 w-4 mr-1" />
                      )}
                      Preview
                    </Button>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Preview panel */}
        <div className="space-y-3">
          {preview ? (
            <>
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <CardTitle className="text-sm">Preview: {preview.subject}</CardTitle>
                      <CardDescription className="text-xs mt-1">
                        Datos de ejemplo. En produccion se usan datos reales de cada org.
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant={viewMode === "desktop" ? "default" : "ghost"}
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setViewMode("desktop")}
                        title="Vista desktop"
                      >
                        <Monitor className="h-4 w-4" />
                      </Button>
                      <Button
                        variant={viewMode === "mobile" ? "default" : "ghost"}
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setViewMode("mobile")}
                        title="Vista mobile"
                      >
                        <Smartphone className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setPreview(null)}
                        title="Cerrar preview"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className={cn(
                    "mx-auto border-t bg-gray-100 dark:bg-gray-900",
                    viewMode === "mobile" ? "max-w-[375px]" : "w-full"
                  )}>
                    <iframe
                      srcDoc={preview.html}
                      className={cn(
                        "w-full border-0",
                        viewMode === "mobile" ? "h-[600px]" : "h-[700px]"
                      )}
                      title="Email preview"
                      sandbox="allow-same-origin"
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Subject line preview */}
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Subject line</p>
                  <p className="font-medium">{preview.subject}</p>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card className="h-full min-h-[400px] flex items-center justify-center">
              <CardContent className="text-center py-16">
                <Mail className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
                <p className="text-muted-foreground">Selecciona un email para ver el preview</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
