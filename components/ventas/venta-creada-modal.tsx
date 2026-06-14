"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Copy,
  Check,
  FileText,
  Loader2,
  AlertTriangle,
} from "lucide-react"
import type { VentaCreadaData } from "./venta-form"
import { useCurrency } from "@/contexts/currency-context"
import { StatusBanner } from "@/components/ui/status-banner"
import { PosTicketShare } from "@/components/pos/pos-ticket-share"
import {
  buildVentaContext,
  renderVentaMessage,
  type VentaForTemplate,
} from "@/lib/whatsapp/plantillas-venta"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"

interface VentaCreadaModalProps {
  open: boolean
  onClose: () => void
  venta: VentaCreadaData | null
}

function generateVentaMessage(
  venta: VentaCreadaData,
  formatPrice: (amount: number) => string,
  plantilla?: string | null,
): string {
  const ctx = buildVentaContext(venta as VentaForTemplate, formatPrice)
  return renderVentaMessage(plantilla, ctx)
}

export function VentaCreadaModal({ open, onClose, venta }: VentaCreadaModalProps) {
  const { formatPrice, pais } = useCurrency()
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [mensaje, setMensaje] = useState("")
  const [plantilla, setPlantilla] = useState<{ venta_comprobante?: string; venta_comprobante_corto?: string }>({})

  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetch("/api/notificaciones/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.plantillasWhatsapp) {
          setPlantilla(data.plantillasWhatsapp)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (venta) {
      setMensaje(generateVentaMessage(venta, formatPrice, plantilla.venta_comprobante))
    }
  }, [venta, plantilla.venta_comprobante, formatPrice])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(mensaje)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownloadPDF = async () => {
    if (!venta) return

    setDownloading(true)
    try {
      const response = await fetch(`/api/ventas/${venta.id}/pdf`)
      if (!response.ok) throw new Error("Error al generar PDF")

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      window.open(url, "_blank")
    } catch (error) {
      console.error("Error opening PDF:", error)
      alert("Error al abrir el PDF")
    } finally {
      setDownloading(false)
    }
  }

  const handleClose = () => {
    setMensaje("")
    setCopied(false)
    onClose()
  }

  if (!venta) return null

  const hasPhone = venta.clienteTelefono && venta.clienteTelefono.trim() !== ""

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-success">
            <Check className="h-5 w-5" />
            Venta #{venta.numeroVenta} registrada
          </DialogTitle>
          <DialogDescription>
            La venta fue registrada exitosamente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Resumen de la venta */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Cliente:</span>
              <span className="font-medium">{venta.clienteNombre}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Items:</span>
              <span className="font-medium">{venta.items.length} producto(s)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total:</span>
              <span className="font-medium text-primary">{formatPrice(venta.total)}</span>
            </div>
            {venta.garantias.length > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Garantías:</span>
                <span className="font-medium">{venta.garantias.length} certificado(s)</span>
              </div>
            )}
          </div>

          {/* Ver PDF */}
          <Button
            variant="outline"
            className="w-full"
            onClick={handleDownloadPDF}
            disabled={downloading}
          >
            {downloading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FileText className="mr-2 h-4 w-4" />
            )}
            Ver Comprobante PDF
          </Button>

          {/* Enviar ticket como imagen por WhatsApp */}
          <PosTicketShare ventaData={venta} plantillaCorta={plantilla.venta_comprobante_corto} countryCode={pais} />

          {/* Mensaje de texto para WhatsApp (alternativa) */}
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground flex items-center gap-1.5">
              <WhatsAppIcon className="h-3.5 w-3.5 text-green-600" />
              Enviar como texto (alternativa)
            </summary>
            <div className="mt-2 space-y-2">
              <Textarea
                value={mensaje}
                onChange={(e) => setMensaje(e.target.value)}
                rows={6}
                className="font-mono text-xs"
              />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleCopy} className="flex-1">
                  {copied ? (
                    <>
                      <Check className="mr-1.5 h-3.5 w-3.5" />
                      Copiado
                    </>
                  ) : (
                    <>
                      <Copy className="mr-1.5 h-3.5 w-3.5" />
                      Copiar texto
                    </>
                  )}
                </Button>
              </div>
            </div>
          </details>

          {/* Aviso si no hay teléfono */}
          {!hasPhone && (
            <StatusBanner tone="warning" icon={AlertTriangle}>
              No se registró teléfono del cliente. Puede descargar la imagen y enviarla manualmente.
            </StatusBanner>
          )}

          {/* Boton cerrar */}
          <Button variant="ghost" onClick={handleClose} className="w-full">
            Cerrar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
