"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Send,
  Trash2,
  ExternalLink,
  Copy,
  Info,
} from "lucide-react"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"
import { useModal } from "@/contexts/modal-context"

interface WaConfig {
  isConfigured: boolean
  isVerified: boolean
  phoneNumberId: string | null
  businessAccountId: string | null
  webhookVerifyToken: string | null
  hasAccessToken: boolean
}

export function WhatsAppSetup() {
  const [config, setConfig] = useState<WaConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [copied, setCopied] = useState(false)

  const [phoneNumberId, setPhoneNumberId] = useState("")
  const [businessAccountId, setBusinessAccountId] = useState("")
  const [accessToken, setAccessToken] = useState("")
  const [testPhone, setTestPhone] = useState("")
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  const { confirm, showError, showSuccess } = useModal()

  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/whatsapp/config")
      if (res.ok) {
        const data = await res.json()
        setConfig(data)
        if (data.phoneNumberId) setPhoneNumberId(data.phoneNumberId)
        if (data.businessAccountId) setBusinessAccountId(data.businessAccountId)
      } else {
        const data = await res.json()
        if (data.code === "PREMIUM_REQUIRED") {
          setConfig(null)
        }
      }
    } catch (err) {
      console.error("Error fetching WA config:", err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchConfig()
  }, [])

  const handleSave = async () => {
    if (!phoneNumberId || !accessToken) {
      await showError("Phone Number ID y Access Token son requeridos.")
      return
    }

    setSaving(true)
    try {
      const res = await fetch("/api/whatsapp/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumberId, businessAccountId, accessToken }),
      })

      const data = await res.json()

      if (!res.ok) {
        if (data.code === "PREMIUM_REQUIRED") {
          await showError("Esta funcion requiere el plan Premium.")
        } else {
          await showError(data.error || "Error al guardar configuracion")
        }
        return
      }

      setAccessToken("")
      await fetchConfig()

      if (data.isVerified) {
        await showSuccess("Conexion verificada correctamente." + (data.phoneName ? ` Telefono: ${data.phoneName}` : ""))
      } else {
        await showError("Configuracion guardada pero no se pudo verificar la conexion: " + (data.error || "Error desconocido"))
      }
    } catch (err) {
      console.error("Error saving WA config:", err)
      await showError("Error al guardar configuracion")
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    if (!testPhone) {
      await showError("Ingresa un numero de telefono para la prueba.")
      return
    }

    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch("/api/whatsapp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: testPhone }),
      })

      const data = await res.json()

      if (data.success) {
        setTestResult({ success: true, message: "Mensaje de prueba enviado exitosamente." })
      } else {
        setTestResult({ success: false, message: data.error || "Error al enviar mensaje" })
      }
    } catch (err) {
      setTestResult({ success: false, message: "Error de conexion" })
    } finally {
      setTesting(false)
    }
  }

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: "Eliminar configuracion",
      description: "Se eliminara la configuracion de WhatsApp Business. Las notificaciones se enviaran via links de WhatsApp Web.",
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      variant: "danger",
    })

    if (!confirmed) return

    setDeleting(true)
    try {
      await fetch("/api/whatsapp/config", { method: "DELETE" })
      setPhoneNumberId("")
      setBusinessAccountId("")
      setAccessToken("")
      await fetchConfig()
    } catch (err) {
      console.error("Error deleting WA config:", err)
    } finally {
      setDeleting(false)
    }
  }

  const copyWebhookUrl = () => {
    const url = `${window.location.origin}/api/whatsapp/webhook`
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
        <p className="text-muted-foreground">Cargando configuracion...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Estado actual */}
      {config?.isConfigured && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <WhatsAppIcon className="h-5 w-5 text-green-600" />
                Estado de la conexion
              </CardTitle>
              {config.isVerified ? (
                <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Verificado
                </Badge>
              ) : (
                <Badge variant="destructive">
                  <XCircle className="h-3 w-3 mr-1" />
                  No verificado
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-muted-foreground">Phone Number ID</p>
                <p className="font-mono">{config.phoneNumberId}</p>
              </div>
              {config.businessAccountId && (
                <div>
                  <p className="text-muted-foreground">Business Account ID</p>
                  <p className="font-mono">{config.businessAccountId}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Configuracion */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {config?.isConfigured ? "Actualizar credenciales" : "Configurar WhatsApp Business"}
          </CardTitle>
          <CardDescription>
            Necesitas una cuenta de WhatsApp Business y una app configurada en Meta for Developers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="phoneNumberId">Phone Number ID *</Label>
            <Input
              id="phoneNumberId"
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
              placeholder="Ej: 123456789012345"
            />
            <p className="text-xs text-muted-foreground">
              Lo encontras en Meta Business Suite &gt; WhatsApp &gt; Configuracion de API.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="businessAccountId">Business Account ID (opcional)</Label>
            <Input
              id="businessAccountId"
              value={businessAccountId}
              onChange={(e) => setBusinessAccountId(e.target.value)}
              placeholder="Ej: 123456789012345"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="accessToken">Access Token *</Label>
            <Input
              id="accessToken"
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder={config?.hasAccessToken ? "••••••••••• (ya configurado, ingresa uno nuevo para actualizar)" : "Ej: EAAx..."}
            />
            <p className="text-xs text-muted-foreground">
              Token permanente de la app de Meta. Se almacena encriptado.
            </p>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={saving || (!accessToken && !config?.isConfigured)}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {config?.isConfigured ? "Actualizar" : "Guardar y verificar"}
            </Button>

            {config?.isConfigured && (
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                Eliminar
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Webhook */}
      {config?.isConfigured && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Webhook</CardTitle>
            <CardDescription>
              Configura estos datos en tu app de Meta para recibir actualizaciones de estado.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>URL del Webhook</Label>
              <div className="flex gap-2">
                <Input
                  value={`${typeof window !== "undefined" ? window.location.origin : ""}/api/whatsapp/webhook`}
                  readOnly
                  className="font-mono text-sm"
                />
                <Button variant="outline" size="icon" onClick={copyWebhookUrl}>
                  {copied ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Verify Token</Label>
              <Input
                value={config.webhookVerifyToken || ""}
                readOnly
                className="font-mono text-sm"
              />
            </div>

            <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <p>
                En Meta for Developers, anda a tu app &gt; WhatsApp &gt; Configuracion y pega
                la URL del webhook y el verify token. Suscribite a los eventos: messages, message_deliveries, message_reads.
              </p>
            </div>

            <a
              href="https://developers.facebook.com/apps/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Abrir Meta for Developers
            </a>
          </CardContent>
        </Card>
      )}

      {/* Test */}
      {config?.isConfigured && config.isVerified && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Send className="h-5 w-5" />
              Enviar mensaje de prueba
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="Ej: 1155667788"
                className="flex-1"
              />
              <Button onClick={handleTest} disabled={testing || !testPhone}>
                {testing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                Enviar
              </Button>
            </div>

            {testResult && (
              <div
                className={`p-3 rounded-lg text-sm ${
                  testResult.success
                    ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400"
                    : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400"
                }`}
              >
                <div className="flex items-center gap-2">
                  {testResult.success ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <XCircle className="h-4 w-4" />
                  )}
                  {testResult.message}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
