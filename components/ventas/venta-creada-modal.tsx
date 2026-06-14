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
