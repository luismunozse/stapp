"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
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
  Receipt,
} from "lucide-react"
import type { VentaCreadaData } from "./venta-form"
import { useCurrency } from "@/contexts/currency-context"
import { useModal } from "@/contexts/modal-context"
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
  // Gate comercial (plan Profesional + país AR). Si el llamador ya conoce el
  // valor (por ejemplo porque ya consultó /api/configuracion) puede pasarlo
  // acá para evitar un fetch duplicado. Si se omite, el modal lo resuelve
  // por su cuenta al abrirse.
  facturacionDisponible?: boolean
}

interface ComprobanteFiscal {
  tipo: string | null
  numero: number | string | null
  cae: string | null
  pdf_url: string | null
  estado: string
  error_msg?: string | null
}

function generateVentaMessage(
  venta: VentaCreadaData,
  formatPrice: (amount: number) => string,
  plantilla?: string | null,
): string {
  const ctx = buildVentaContext(venta as VentaForTemplate, formatPrice)
  return renderVentaMessage(plantilla, ctx)
}

export function VentaCreadaModal({ open, onClose, venta, facturacionDisponible = false }: VentaCreadaModalProps) {
  const { formatPrice, pais } = useCurrency()
  const { showError } = useModal()
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [mensaje, setMensaje] = useState("")
  const [plantilla, setPlantilla] = useState<{ venta_comprobante?: string; venta_comprobante_corto?: string }>({})

  // Disponibilidad de facturación electrónica: si el llamador no la pasó por
  // prop, se resuelve acá mismo consultando /api/configuracion al abrirse.
  const [facturacionDisponibleFetched, setFacturacionDisponibleFetched] = useState(false)
  const puedeEmitirFactura = facturacionDisponible || facturacionDisponibleFetched

  const [emitiendo, setEmitiendo] = useState(false)
  const [comprobante, setComprobante] = useState<ComprobanteFiscal | null>(null)
  const [rechazadoFE, setRechazadoFE] = useState(false)
  const [noDisponibleFE, setNoDisponibleFE] = useState(false)
  const [errorFE, setErrorFE] = useState<string | null>(null)
  const facturaEmitida = comprobante !== null && !rechazadoFE

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
    if (!open || facturacionDisponible) return
    let cancelled = false
    fetch("/api/configuracion")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.facturacionElectronicaDisponible) {
          setFacturacionDisponibleFetched(true)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open, facturacionDisponible])

  useEffect(() => {
    if (venta) {
      setMensaje(generateVentaMessage(venta, formatPrice, plantilla.venta_comprobante))
    }
  }, [venta, plantilla.venta_comprobante, formatPrice])

  useEffect(() => {
    // Nueva venta: limpiar el estado de emisión de la venta anterior. Se
    // separa del efecto de arriba porque ese también corre cuando llega la
    // plantilla de WhatsApp, y acá solo nos interesa el cambio de venta.
    setEmitiendo(false)
    setComprobante(null)
    setRechazadoFE(false)
    setNoDisponibleFE(false)
    setErrorFE(null)
  }, [venta?.id])

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
      await showError("Error al abrir el PDF")
    } finally {
      setDownloading(false)
    }
  }

  const handleEmitirFactura = async () => {
    if (!venta || emitiendo || facturaEmitida) return

    setEmitiendo(true)
    setErrorFE(null)
    setRechazadoFE(false)
    setNoDisponibleFE(false)
    try {
      const response = await fetch("/api/facturacion-electronica/emitir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ventaId: venta.id }),
      })
      const data = await response.json().catch(() => ({}))

      if (response.status === 200 || response.status === 409) {
        setComprobante(data.comprobante ?? null)
        return
      }
      if (response.status === 422) {
        setComprobante(data.comprobante ?? null)
        setRechazadoFE(true)
        setErrorFE(data.comprobante?.error_msg || data.error || "El comprobante fue rechazado por el proveedor.")
        return
      }
      if (response.status === 403) {
        setNoDisponibleFE(true)
        setErrorFE(data.error || "La facturación electrónica no está disponible para tu organización.")
        return
      }
      setErrorFE(data.error || "No se pudo emitir la factura electrónica.")
    } catch (error) {
      console.error("Error emitiendo factura electrónica:", error)
      setErrorFE("No se pudo emitir la factura. Verificá tu conexión e intentá de nuevo.")
    } finally {
      setEmitiendo(false)
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

          {/* Emitir factura electrónica (AFIP/ARCA) */}
          {puedeEmitirFactura && (
            <div className="space-y-2">
              <Button
                variant="outline"
                className="w-full"
                onClick={handleEmitirFactura}
                disabled={emitiendo || facturaEmitida}
              >
                {emitiendo ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Receipt className="mr-2 h-4 w-4" />
                )}
                {facturaEmitida ? "Factura emitida" : "Emitir factura"}
              </Button>

              {facturaEmitida && comprobante && (
                <StatusBanner tone="success" icon={Check}>
                  Factura {comprobante.tipo ? `tipo ${comprobante.tipo} ` : ""}N° {comprobante.numero ?? "-"} emitida.{" "}
                  {comprobante.pdf_url && (
                    <a
                      href={comprobante.pdf_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline font-medium"
                    >
                      Ver factura PDF
                    </a>
                  )}
                </StatusBanner>
              )}

              {rechazadoFE && errorFE && (
                <StatusBanner tone="danger" icon={AlertTriangle}>
                  No se pudo emitir la factura: {errorFE}
                </StatusBanner>
              )}

              {noDisponibleFE && (
                <StatusBanner tone="warning" icon={AlertTriangle}>
                  La facturación electrónica no está disponible. Configurala en{" "}
                  <Link href="/configuracion" className="underline font-medium">
                    Ajustes
                  </Link>
                  .
                </StatusBanner>
              )}

              {errorFE && !rechazadoFE && !noDisponibleFE && (
                <StatusBanner tone="danger" icon={AlertTriangle}>
                  {errorFE}
                </StatusBanner>
              )}
            </div>
          )}

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
