"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Copy, Check } from "lucide-react"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"
import {
  getWhatsAppTemplates,
  generateWhatsAppUrl,
} from "@/lib/notifications/whatsapp-templates"
import type { NotificationContext } from "@/lib/notifications/types"
import type { Cliente } from "@/types"
import { useCurrency } from "@/contexts/currency-context"
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

interface DeudaSucursal {
  deudaTotal: number
  deudaFiado: number
  deudaOrdenes: number
}

export function ClienteWhatsAppDialog({
  cliente,
  organizationName,
  open,
  onOpenChange,
}: ClienteWhatsAppDialogProps) {
  const { pais, currency } = useCurrency()
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [customMessage, setCustomMessage] = useState("")
  const [copied, setCopied] = useState(false)
  const [plantillasOverride, setPlantillasOverride] = useState<Record<string, string> | null>(null)
  const [loadingPlantillas, setLoadingPlantillas] = useState(true)
  const [customMessageEdited, setCustomMessageEdited] = useState(false)
  const [deuda, setDeuda] = useState<DeudaSucursal | null>(null)

  // Contexto sin orden para mostrar plantillas genéricas
  const context: NotificationContext = {
    organizationId: "",
    organizationName,
    moneda: currency,
    cliente: {
      id: cliente.id,
      nombre: cliente.nombre,
      email: cliente.email,
      telefono: cliente.telefono,
    },
    ...(deuda && deuda.deudaTotal > 0
      ? {
          pago: {
            monto: deuda.deudaTotal,
            saldoPendiente: deuda.deudaTotal,
            desglose: { fiado: deuda.deudaFiado, ordenes: deuda.deudaOrdenes },
          },
        }
      : {}),
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoadingPlantillas(true)
    fetch("/api/notificaciones/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return
        if (data?.plantillasWhatsapp) setPlantillasOverride(data.plantillasWhatsapp)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingPlantillas(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  // Deuda combinada (cuenta corriente + ordenes) de la sucursal activa, para
  // habilitar el recordatorio de pago. Si el fetch falla, el dialog sigue
  // funcionando sin esa plantilla (degrada, no rompe).
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setDeuda(null)
    fetch(`/api/clientes/${cliente.id}/deuda-sucursal`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setDeuda({
          deudaTotal: data.deudaTotal ?? 0,
          deudaFiado: data.deudaFiado ?? 0,
          deudaOrdenes: data.deudaOrdenes ?? 0,
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open, cliente.id])

  const templates = getWhatsAppTemplates(context, plantillasOverride)

  const handleSelectTemplate = (id: string) => {
    const template = templates.find((t) => t.id === id)
    if (template) {
      setSelectedTemplate(id)
      setCustomMessage(template.mensaje)
      setCustomMessageEdited(false)
    }
  }

  // Auto-seleccionar primera plantilla cuando el dialog está abierto
  // y las plantillas (con override aplicado) ya están listas.
  useEffect(() => {
    if (open && !loadingPlantillas && !selectedTemplate && templates.length > 0) {
      const first = templates[0]
      setSelectedTemplate(first.id)
      setCustomMessage(first.mensaje)
      setCustomMessageEdited(false)
    }
  }, [open, loadingPlantillas, plantillasOverride, selectedTemplate, templates])

  // Si el override llega después de seleccionar, reaplicar si el usuario
  // no editó el textarea manualmente.
  useEffect(() => {
    if (!selectedTemplate || customMessageEdited) return
    const tpl = templates.find((t) => t.id === selectedTemplate)
    if (tpl && tpl.mensaje !== customMessage) {
      setCustomMessage(tpl.mensaje)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plantillasOverride])

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
    const url = generateWhatsAppUrl(context.cliente.telefono, customMessage, pais)
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

  // La auto-selección de la primera plantilla se hace en el useEffect
  // de arriba (espera a que las plantillas custom estén cargadas).
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <WhatsAppIcon className="h-5 w-5 text-success-600" />
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
              onChange={(e) => {
                setCustomMessage(e.target.value)
                setCustomMessageEdited(true)
              }}
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
              className="flex-1 bg-success hover:bg-success/90"
              disabled={!customMessage.trim()}
            >
              <WhatsAppIcon className="mr-2 h-4 w-4" />
              Abrir WhatsApp
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
