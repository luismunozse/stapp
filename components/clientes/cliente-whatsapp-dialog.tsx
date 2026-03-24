"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Copy, Check, Send } from "lucide-react"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"
import {
  getWhatsAppTemplates,
  generateWhatsAppUrl,
} from "@/lib/notifications/whatsapp-templates"
import type { NotificationContext } from "@/lib/notifications/types"
import type { Cliente } from "@/types"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface ClienteWhatsAppDialogProps {
  cliente: Cliente
  organizationName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ClienteWhatsAppDialog({
  cliente,
  organizationName,
  open,
  onOpenChange,
}: ClienteWhatsAppDialogProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [customMessage, setCustomMessage] = useState("")
  const [copied, setCopied] = useState(false)

  // Contexto sin orden para mostrar plantillas genéricas
  const context: NotificationContext = {
    organizationId: "",
    organizationName,
    cliente: {
      id: cliente.id,
      nombre: cliente.nombre,
      email: cliente.email,
      telefono: cliente.telefono,
    },
  }

  const templates = getWhatsAppTemplates(context)

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

  // Seleccionar primera plantilla al abrir
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen && templates.length > 0 && !selectedTemplate) {
      handleSelectTemplate(templates[0].id)
    }
    onOpenChange(isOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <WhatsAppIcon className="h-5 w-5 text-green-600" />
            WhatsApp a {cliente.nombre}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Plantilla:</label>
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

            <Button
              onClick={handleSend}
              className="flex-1 bg-green-600 hover:bg-green-700"
              disabled={!customMessage.trim()}
            >
              <Send className="mr-2 h-4 w-4" />
              Abrir WhatsApp
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
