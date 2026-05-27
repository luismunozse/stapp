"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Send,
  Trash2,
  ExternalLink,
  Copy,
  Info,
  QrCode,
  RefreshCw,
  LogOut,
} from "lucide-react"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"
import { useModal } from "@/contexts/modal-context"

type Provider = "meta" | "evolution"
type EvoState = "open" | "connecting" | "close" | "qr" | "unknown" | null

interface WaConfig {
  provider: Provider
  isConfigured: boolean
  isVerified: boolean
  phoneNumberId: string | null
  businessAccountId: string | null
  webhookVerifyToken: string | null
  hasAccessToken: boolean
  evolution: {
    baseUrl: string | null
    instanceName: string | null
    connectionState: EvoState
    hasApiKey: boolean
    lastQrAt?: string | null
  }
}

export function WhatsAppSetup() {
  const [config, setConfig] = useState<WaConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [activeTab, setActiveTab] = useState<Provider>("meta")

  // Meta fields
  const [phoneNumberId, setPhoneNumberId] = useState("")
  const [businessAccountId, setBusinessAccountId] = useState("")
  const [accessToken, setAccessToken] = useState("")

  // Evolution fields
  const [evoBaseUrl, setEvoBaseUrl] = useState("")
  const [evoInstance, setEvoInstance] = useState("")
  const [evoApiKey, setEvoApiKey] = useState("")
  const [qrBase64, setQrBase64] = useState<string | null>(null)
  const [pairingCode, setPairingCode] = useState<string | null>(null)
  const [evoState, setEvoState] = useState<EvoState>(null)
  const [requestingQr, setRequestingQr] = useState(false)

  const [testPhone, setTestPhone] = useState("")
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  const { confirm, showError, showSuccess } = useModal()

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/config")
      if (res.ok) {
        const data = (await res.json()) as WaConfig
        setConfig(data)
        if (data.phoneNumberId) setPhoneNumberId(data.phoneNumberId)
        if (data.businessAccountId) setBusinessAccountId(data.businessAccountId)
        if (data.evolution?.baseUrl) setEvoBaseUrl(data.evolution.baseUrl)
        if (data.evolution?.instanceName) setEvoInstance(data.evolution.instanceName)
        setEvoState(data.evolution?.connectionState ?? null)
        if (data.provider) setActiveTab(data.provider)
      }
    } catch (err) {
      console.error("Error fetching WA config:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  // Poll de estado Evolution mientras connecting/qr
  useEffect(() => {
    if (activeTab !== "evolution") return
    if (!config?.isConfigured || config.provider !== "evolution") return
    if (evoState === "open" || evoState === "close" || evoState === null) return

    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/whatsapp/evolution/qr", { method: "GET" })
        const data = await res.json()
        if (data.state) {
          setEvoState(data.state)
          if (data.state === "open") {
            setQrBase64(null)
            setPairingCode(null)
            fetchConfig()
          }
        }
      } catch {
        // ignore
      }
    }, 4000)

    return () => clearInterval(interval)
  }, [activeTab, config, evoState, fetchConfig])

  const handleSaveMeta = async () => {
    if (!phoneNumberId || !accessToken) {
      await showError("Phone Number ID y Access Token son requeridos.")
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/whatsapp/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "meta", phoneNumberId, businessAccountId, accessToken }),
      })
      const data = await res.json()
      if (!res.ok) {
        await showError(data.error || "Error al guardar configuracion")
        return
      }
      setAccessToken("")
      await fetchConfig()
      if (data.isVerified) {
        await showSuccess("Conexion verificada." + (data.phoneName ? ` Telefono: ${data.phoneName}` : ""))
      } else {
        await showError("Guardado pero sin verificar: " + (data.error || "desconocido"))
      }
    } finally {
      setSaving(false)
    }
  }

  const handleSaveEvolution = async () => {
    if (!evoBaseUrl || !evoInstance || !evoApiKey) {
      await showError("URL, instancia y API key son requeridos.")
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/whatsapp/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "evolution",
          baseUrl: evoBaseUrl,
          instanceName: evoInstance,
          apiKey: evoApiKey,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        await showError(data.error || "Error al guardar configuracion")
        return
      }
      setEvoApiKey("")
      setEvoState(data.connectionState || null)
      await fetchConfig()
      if (data.connectionState !== "open") {
        await showSuccess("Configuracion guardada. Pedi el QR para vincular el numero.")
      } else {
        await showSuccess("Numero ya vinculado y listo.")
      }
    } finally {
      setSaving(false)
    }
  }

  const handleRequestQr = async () => {
    setRequestingQr(true)
    setQrBase64(null)
    setPairingCode(null)
    try {
      const res = await fetch("/api/whatsapp/evolution/qr", { method: "POST" })
      const data = await res.json()
      if (!res.ok) {
        await showError(data.error || "Error al solicitar QR")
        return
      }
      setEvoState(data.state)
      setQrBase64(data.qrBase64 || null)
      setPairingCode(data.pairingCode || null)
      if (data.state === "open") {
        await showSuccess("Numero vinculado.")
        await fetchConfig()
      }
    } finally {
      setRequestingQr(false)
    }
  }

  const handleEvoLogout = async () => {
    const ok = await confirm({
      title: "Desvincular numero",
      description: "Se cerrara la sesion del numero en Evolution. Vas a tener que escanear el QR de nuevo.",
      confirmText: "Desvincular",
      cancelText: "Cancelar",
      variant: "danger",
    })
    if (!ok) return
    await fetch("/api/whatsapp/evolution/logout", { method: "POST" })
    setEvoState("close")
    await fetchConfig()
  }

  const handleTest = async () => {
    if (!testPhone) {
      await showError("Ingresa un numero de telefono.")
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
        setTestResult({ success: true, message: `Mensaje enviado (${data.provider}).` })
      } else {
        setTestResult({ success: false, message: data.error || "Error al enviar mensaje" })
      }
    } catch {
      setTestResult({ success: false, message: "Error de conexion" })
    } finally {
      setTesting(false)
    }
  }

  const handleDelete = async () => {
    const ok = await confirm({
      title: "Eliminar configuracion",
      description: "Se eliminara la configuracion de WhatsApp. Las notificaciones se enviaran via links.",
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      variant: "danger",
    })
    if (!ok) return
    setDeleting(true)
    try {
      await fetch("/api/whatsapp/config", { method: "DELETE" })
      setPhoneNumberId("")
      setBusinessAccountId("")
      setAccessToken("")
      setEvoBaseUrl("")
      setEvoInstance("")
      setEvoApiKey("")
      setQrBase64(null)
      setEvoState(null)
      await fetchConfig()
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

  const isEvoConnected = config?.provider === "evolution" && evoState === "open"
  const isMetaVerified = config?.provider === "meta" && config?.isVerified
  const canTest = (isEvoConnected || isMetaVerified) && config?.isConfigured

  return (
    <div className="space-y-6">
      {/* Estado actual */}
      {config?.isConfigured && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <WhatsAppIcon className="h-5 w-5 text-green-600" />
                Estado — {config.provider === "evolution" ? "Evolution API" : "Meta Cloud API"}
              </CardTitle>
              {canTest ? (
                <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Conectado
                </Badge>
              ) : (
                <Badge variant="destructive">
                  <XCircle className="h-3 w-3 mr-1" />
                  {config.provider === "evolution" ? `Estado: ${evoState || "desconocido"}` : "No verificado"}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {config.provider === "meta" && (
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
            )}
            {config.provider === "evolution" && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-muted-foreground">Servidor</p>
                  <p className="font-mono text-xs break-all">{config.evolution.baseUrl}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Instancia</p>
                  <p className="font-mono">{config.evolution.instanceName}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tabs provider */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Provider)}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="meta">Meta Cloud API</TabsTrigger>
          <TabsTrigger value="evolution">Evolution API</TabsTrigger>
        </TabsList>

        {/* META */}
        <TabsContent value="meta" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Configurar WhatsApp Business (Meta)</CardTitle>
              <CardDescription>
                Necesitas cuenta WhatsApp Business y app en Meta for Developers. Aprobacion de templates obligatoria.
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
              </div>
              <div className="space-y-2">
                <Label htmlFor="businessAccountId">Business Account ID (opcional)</Label>
                <Input
                  id="businessAccountId"
                  value={businessAccountId}
                  onChange={(e) => setBusinessAccountId(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="accessToken">Access Token *</Label>
                <Input
                  id="accessToken"
                  type="password"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  placeholder={config?.hasAccessToken ? "••••••••••• (ya configurado)" : "Ej: EAAx..."}
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleSaveMeta} disabled={saving || (!accessToken && !config?.hasAccessToken)}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Guardar y verificar
                </Button>
                {config?.isConfigured && config.provider === "meta" && (
                  <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
                    {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                    Eliminar
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {config?.isConfigured && config.provider === "meta" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Webhook</CardTitle>
                <CardDescription>Configura estos datos en Meta para recibir estados.</CardDescription>
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
                  <Input value={config.webhookVerifyToken || ""} readOnly className="font-mono text-sm" />
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
        </TabsContent>

        {/* EVOLUTION */}
        <TabsContent value="evolution" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Configurar Evolution API</CardTitle>
              <CardDescription>
                Servidor self-hosted (Baileys). Mas barato y rapido pero no oficial — usar numero dedicado.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-2 text-sm text-muted-foreground bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3">
                <Info className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
                <div className="space-y-1">
                  <p className="font-medium text-amber-700 dark:text-amber-400">No oficial</p>
                  <p>
                    Evolution conecta como WhatsApp Web. Meta puede banear el numero si detecta automatizacion masiva.
                    Usa numero dedicado, respeta limites diarios y no envies spam.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="evoBaseUrl">URL del servidor Evolution *</Label>
                <Input
                  id="evoBaseUrl"
                  value={evoBaseUrl}
                  onChange={(e) => setEvoBaseUrl(e.target.value)}
                  placeholder="https://evo.midominio.com"
                />
                <p className="text-xs text-muted-foreground">Tu instalacion de Evolution API (Docker self-hosted).</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="evoInstance">Nombre de instancia *</Label>
                <Input
                  id="evoInstance"
                  value={evoInstance}
                  onChange={(e) => setEvoInstance(e.target.value)}
                  placeholder="stapp-org-123"
                />
                <p className="text-xs text-muted-foreground">Identificador unico para esta organizacion.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="evoApiKey">API key *</Label>
                <Input
                  id="evoApiKey"
                  type="password"
                  value={evoApiKey}
                  onChange={(e) => setEvoApiKey(e.target.value)}
                  placeholder={config?.evolution?.hasApiKey ? "••••••••••• (ya configurado)" : "AUTHENTICATION_API_KEY"}
                />
                <p className="text-xs text-muted-foreground">Header apikey del servidor Evolution.</p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button
                  onClick={handleSaveEvolution}
                  disabled={saving || (!evoApiKey && !config?.evolution?.hasApiKey)}
                >
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Guardar y crear instancia
                </Button>
                {config?.isConfigured && config.provider === "evolution" && (
                  <>
                    <Button variant="outline" onClick={handleRequestQr} disabled={requestingQr}>
                      {requestingQr ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <QrCode className="mr-2 h-4 w-4" />
                      )}
                      Pedir QR
                    </Button>
                    {evoState === "open" && (
                      <Button variant="outline" onClick={handleEvoLogout}>
                        <LogOut className="mr-2 h-4 w-4" />
                        Desvincular
                      </Button>
                    )}
                    <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
                      {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                      Eliminar
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {/* QR pairing */}
          {config?.isConfigured && config.provider === "evolution" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <QrCode className="h-5 w-5" />
                  Vincular numero
                </CardTitle>
                <CardDescription>
                  Abri WhatsApp en el telefono &gt; Dispositivos vinculados &gt; Vincular dispositivo. Escanea el QR.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm">
                    Estado:{" "}
                    <span
                      className={
                        evoState === "open"
                          ? "text-green-600 font-medium"
                          : evoState === "connecting" || evoState === "qr"
                          ? "text-amber-600 font-medium"
                          : "text-muted-foreground"
                      }
                    >
                      {evoState || "sin datos"}
                    </span>
                  </div>
                  <Button variant="ghost" size="sm" onClick={handleRequestQr} disabled={requestingQr}>
                    <RefreshCw className={`h-4 w-4 mr-2 ${requestingQr ? "animate-spin" : ""}`} />
                    Refrescar
                  </Button>
                </div>

                {qrBase64 && (
                  <div className="flex flex-col items-center gap-3 py-4">
                    <img
                      src={qrBase64.startsWith("data:") ? qrBase64 : `data:image/png;base64,${qrBase64}`}
                      alt="QR WhatsApp"
                      className="w-64 h-64 border rounded-lg"
                    />
                    {pairingCode && (
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">O usa el codigo:</p>
                        <p className="font-mono text-lg tracking-widest">{pairingCode}</p>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground text-center max-w-sm">
                      El QR expira en ~40 segundos. Si no llegas a escanearlo, presiona &quot;Pedir QR&quot; otra vez.
                    </p>
                  </div>
                )}

                {!qrBase64 && evoState !== "open" && (
                  <div className="text-center py-6">
                    <Button onClick={handleRequestQr} disabled={requestingQr}>
                      {requestingQr ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <QrCode className="mr-2 h-4 w-4" />
                      )}
                      Generar QR
                    </Button>
                  </div>
                )}

                {evoState === "open" && (
                  <div className="text-center py-4 text-green-600 dark:text-green-400">
                    <CheckCircle2 className="h-8 w-8 mx-auto mb-2" />
                    <p className="font-medium">Numero vinculado y listo para enviar.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Test envio */}
      {canTest && (
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
                {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
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
                  {testResult.success ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
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
