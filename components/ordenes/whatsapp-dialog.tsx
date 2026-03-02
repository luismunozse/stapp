"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Send, Copy, Check, X, Loader2, Zap } from "lucide-react"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"
import {
  getWhatsAppTemplates,
  generateWhatsAppUrl,
} from "@/lib/notifications/whatsapp-templates"
import type { NotificationContext } from "@/lib/notifications/types"

interface WhatsAppDialogProps {
  context: NotificationContext
  onClose?: () => void
}

export function WhatsAppDialog({ context, onClose }: WhatsAppDialogProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [customMessage, setCustomMessage] = useState("")
  const [copied, setCopied] = useState(false)
  const [hasWaApi, setHasWaApi] = useState(false)
  const [sendingApi, setSendingApi] = useState(false)
  const [apiResult, setApiResult] = useState<{ success: boolean; message: string } | null>(null)

  const templates = getWhatsAppTemplates(context)

  // Check if WA Business API is configured
  useEffect(() => {
    fetch("/api/whatsapp/config")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.isConfigured && data?.isVerified) {
          setHasWaApi(true)
        }
      })
      .catch(() => {})
  }, [])

  const handleOpen = () => {
    setIsOpen(true)
    setApiResult(null)
    // Seleccionar primera plantilla por defecto
    if (templates.length > 0 && !selectedTemplate) {
      handleSelectTemplate(templates[0].id)
    }
  }

  const handleClose = () => {
    setIsOpen(false)
    setApiResult(null)
    onClose?.()
  }

  const handleSelectTemplate = (id: string) => {
    const template = templates.find((t) => t.id === id)
    if (template) {
      setSelectedTemplate(id)
      setCustomMessage(template.mensaje)
    }
  }

  const handleCopy = async () => {
    try {
      const { Capacitor } = await import("@capacitor/core")
      if (Capacitor.isNativePlatform()) {
        const { Clipboard } = await import("@capacitor/clipboard")
        await Clipboard.write({ string: customMessage })
      } else {
        await navigator.clipboard.writeText(customMessage)
      }
    } catch {
      await navigator.clipboard.writeText(customMessage)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleSend = async () => {
    const url = generateWhatsAppUrl(context.cliente.telefono, customMessage)
    try {
      const { Capacitor } = await import("@capacitor/core")
      if (Capacitor.isNativePlatform()) {
        const { Browser } = await import("@capacitor/browser")
        await Browser.open({ url })
      } else {
        window.open(url, "_blank")
      }
    } catch {
      window.open(url, "_blank")
    }
  }

  const handleSendViaApi = async () => {
    if (!customMessage.trim()) return
    setSendingApi(true)
    setApiResult(null)

    try {
      const res = await fetch("/api/whatsapp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: context.cliente.telefono }),
      })

      const data = await res.json()

      if (data.success) {
        setApiResult({ success: true, message: "Mensaje enviado via WhatsApp Business API" })
      } else {
        setApiResult({ success: false, message: data.error || "Error al enviar" })
      }
    } catch {
      setApiResult({ success: false, message: "Error de conexion" })
    } finally {
      setSendingApi(false)
    }
  }

  if (!isOpen) {
    return (
      <Button
        onClick={handleOpen}
        className="bg-green-600 hover:bg-green-700 text-white"
      >
        <WhatsAppIcon className="mr-2 h-4 w-4" />
        WhatsApp
      </Button>
    )
  }

  return (
    <Card className="mt-4">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <WhatsAppIcon className="h-5 w-5 text-green-600" />
            Enviar WhatsApp a {context.cliente.nombre}
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={handleClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="text-sm font-medium">Seleccionar plantilla:</label>
          <div className="flex flex-wrap gap-2 mt-2">
            {templates.map((template) => (
              <Button
                key={template.id}
                variant={selectedTemplate === template.id ? "default" : "outline"}
                size="sm"
                onClick={() => handleSelectTemplate(template.id)}
              >
                {template.nombre}
              </Button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-sm font-medium">Mensaje:</label>
          <Textarea
            value={customMessage}
            onChange={(e) => setCustomMessage(e.target.value)}
            rows={6}
            className="mt-2 font-mono text-sm"
            placeholder="Selecciona una plantilla o escribe tu mensaje..."
          />
        </div>

        {apiResult && (
          <div
            className={`p-3 rounded-lg text-sm ${
              apiResult.success
                ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400"
                : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400"
            }`}
          >
            {apiResult.message}
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="outline" onClick={handleCopy} className="flex-1">
            {copied ? (
              <>
                <Check className="mr-2 h-4 w-4" />
                Copiado
              </>
            ) : (
              <>
                <Copy className="mr-2 h-4 w-4" />
                Copiar
              </>
            )}
          </Button>

          {hasWaApi ? (
            <Button
              onClick={handleSendViaApi}
              className="flex-1 bg-green-600 hover:bg-green-700"
              disabled={!customMessage.trim() || sendingApi}
            >
              {sendingApi ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Zap className="mr-2 h-4 w-4" />
              )}
              Enviar directo
            </Button>
          ) : (
            <Button
              onClick={handleSend}
              className="flex-1 bg-green-600 hover:bg-green-700"
              disabled={!customMessage.trim()}
            >
              <Send className="mr-2 h-4 w-4" />
              Abrir WhatsApp
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
