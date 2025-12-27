"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Send, Copy, Check, X } from "lucide-react"

// WhatsApp icon SVG component
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}
import {
  getWhatsAppTemplates,
  generateWhatsAppUrl,
  type WhatsAppTemplate,
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

  const templates = getWhatsAppTemplates(context)

  const handleOpen = () => {
    setIsOpen(true)
    // Seleccionar primera plantilla por defecto
    if (templates.length > 0 && !selectedTemplate) {
      handleSelectTemplate(templates[0].id)
    }
  }

  const handleClose = () => {
    setIsOpen(false)
    onClose?.()
  }

  const handleSelectTemplate = (id: string) => {
    const template = templates.find((t) => t.id === id)
    if (template) {
      setSelectedTemplate(id)
      setCustomMessage(template.mensaje)
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(customMessage)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleSend = () => {
    const url = generateWhatsAppUrl(context.cliente.telefono, customMessage)
    window.open(url, "_blank")
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
      </CardContent>
    </Card>
  )
}
