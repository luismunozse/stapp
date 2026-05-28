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
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Printer,
  Tag,
} from "lucide-react"
import { printDeviceLabel } from "./print-label"
import { ThermalPrintOrden } from "./thermal-print-orden"
import { generateWhatsAppUrl, formatPhoneForWhatsApp } from "@/lib/notifications/whatsapp-templates"
import { resolvePlantilla } from "@/lib/whatsapp/plantillas-catalog"
import { useCurrency } from "@/contexts/currency-context"
import type { OrdenServicio } from "@/types"

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

interface OrdenCreadaData {
  id: string
  numeroOrden: number
  codigoOrden?: string
  dispositivo: string
  problemaReportado: string
  presupuesto?: number | null
  fechaPrometida?: string | null
  publicToken?: string | null
  cliente: {
    nombre: string
    telefono: string
  }
  telefonoContacto?: string | null
  organizationName?: string
  // Campos extra para comprobante térmico
  tipoDispositivo?: string
  marca?: string | null
  color?: string | null
  imei?: string | null
  accesorios?: string | null
  observaciones?: string | null
  estado?: string
  costoFinal?: number | null
  fechaIngreso?: string | null
  clienteId?: string
  organizationLogoUrl?: string | null
  organizationTelefono?: string | null
  organizationDireccion?: string | null
  organizationComprobanteTerminos?: string | null
}

interface OrdenCreadaModalProps {
  open: boolean
  onClose: () => void
  orden: OrdenCreadaData | null
}

function buildThermalOrden(orden: OrdenCreadaData) {
  const fechaIngreso = orden.fechaIngreso ? new Date(orden.fechaIngreso) : new Date()
  const fechaPrometida = orden.fechaPrometida ? new Date(orden.fechaPrometida) : null
  return {
    id: orden.id,
    numeroOrden: orden.numeroOrden,
    codigoOrden: orden.codigoOrden,
    clienteId: orden.clienteId || "",
    dispositivo: orden.dispositivo,
    tipoDispositivo: (orden.tipoDispositivo || "OTRO") as OrdenServicio["tipoDispositivo"],
    marca: orden.marca ?? null,
    color: orden.color ?? null,
    imei: orden.imei ?? null,
    accesorios: orden.accesorios ?? null,
    telefonoContacto: orden.telefonoContacto ?? null,
    problemaReportado: orden.problemaReportado,
    estado: (orden.estado || "RECIBIDO") as OrdenServicio["estado"],
    presupuesto: orden.presupuesto ?? null,
    costoFinal: orden.costoFinal ?? null,
    fechaIngreso,
    fechaPrometida,
    observaciones: orden.observaciones ?? null,
    publicToken: orden.publicToken ?? null,
    cliente: {
      id: orden.clienteId || "",
      nombre: orden.cliente.nombre,
      telefono: orden.cliente.telefono,
    },
    organizationName: orden.organizationName ?? null,
    organizationLogoUrl: orden.organizationLogoUrl ?? null,
    organizationTelefono: orden.organizationTelefono ?? null,
    organizationDireccion: orden.organizationDireccion ?? null,
    organizationComprobanteTerminos: orden.organizationComprobanteTerminos ?? null,
  } as unknown as OrdenServicio & {
    organizationName?: string | null
    organizationLogoUrl?: string | null
    organizationTelefono?: string | null
    organizationDireccion?: string | null
    organizationComprobanteTerminos?: string | null
  }
}

export function OrdenCreadaModal({ open, onClose, orden }: OrdenCreadaModalProps) {
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [mensaje, setMensaje] = useState("")
  const [plantillas, setPlantillas] = useState<Record<string, string> | null>(null)
  const { formatPrice, formatDate } = useCurrency()

  // Traer plantillas custom de la organización cuando se abre el modal
  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetch("/api/notificaciones/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.plantillasWhatsapp) {
          setPlantillas(data.plantillasWhatsapp)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open])

  // Actualizar mensaje cuando cambia la orden o las plantillas
  useEffect(() => {
    if (!orden) return
    const baseUrl = typeof window !== "undefined" ? window.location.origin : ""
    const codigoDisplay = orden.codigoOrden || `#${orden.numeroOrden}`
    // Variables auto-computadas para mostrar líneas condicionales sin dejar
    // líneas vacías cuando el dato no existe (presupuesto/fecha estimada).
    const lineaPresupuesto = orden.presupuesto
      ? `\nPresupuesto estimado: ${formatPrice(orden.presupuesto)}`
      : ""
    const lineaFechaPrometida = orden.fechaPrometida
      ? `\nFecha estimada de entrega: ${formatDate(orden.fechaPrometida)}`
      : ""
    const linkPdf = orden.publicToken
      ? `${baseUrl}/api/public/ordenes/${orden.publicToken}/pdf`
      : ""
    const linkSeguimiento = orden.publicToken
      ? `${baseUrl}/seguimiento/${orden.publicToken}`
      : ""

    const vars = {
      cliente: orden.cliente.nombre,
      codigo_orden: codigoDisplay,
      dispositivo: orden.dispositivo,
      problema: orden.problemaReportado,
      presupuesto: orden.presupuesto ? formatPrice(orden.presupuesto) : "",
      fecha_prometida: orden.fechaPrometida ? formatDate(orden.fechaPrometida) : "",
      linea_presupuesto: lineaPresupuesto,
      linea_fecha_prometida: lineaFechaPrometida,
      link_pdf: linkPdf,
      link_seguimiento: linkSeguimiento,
      empresa: orden.organizationName || "",
    }
    setMensaje(resolvePlantilla("orden_recepcion", vars, plantillas))
  }, [orden, formatPrice, formatDate, plantillas])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(mensaje)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownloadPDF = async () => {
    if (!orden) return

    setDownloading(true)
    try {
      const response = await fetch(`/api/ordenes/${orden.id}/pdf`)
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

  const handlePrint = async () => {
    if (!orden) return

    setPrinting(true)
    try {
      const response = await fetch(`/api/ordenes/${orden.id}/pdf`)
      if (!response.ok) throw new Error("Error al generar PDF")

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const printWindow = window.open(url, "_blank")
      if (printWindow) {
        printWindow.addEventListener("load", () => {
          printWindow.print()
        })
      }
    } catch (error) {
      console.error("Error printing PDF:", error)
      alert("Error al imprimir la orden")
    } finally {
      setPrinting(false)
    }
  }

  const handlePrintLabel = async () => {
    if (!orden) return
    const baseUrl = typeof window !== "undefined" ? window.location.origin : ""
    const fecha = new Date().toLocaleDateString("es-AR", {
      day: "2-digit", month: "2-digit", year: "numeric",
    })
    await printDeviceLabel({
      codigoOrden: orden.codigoOrden || `#${orden.numeroOrden}`,
      numeroOrden: orden.numeroOrden,
      clienteNombre: orden.cliente.nombre,
      dispositivo: orden.dispositivo,
      problemaReportado: orden.problemaReportado,
      fechaIngreso: fecha,
      publicToken: orden.publicToken,
      organizationName: orden.organizationName,
    }, baseUrl)
  }

  const handleOpenWhatsApp = () => {
    if (!orden) return
    const url = generateWhatsAppUrl(orden.telefonoContacto || orden.cliente.telefono, mensaje)
    window.open(url, "_blank")
  }

  const handleClose = () => {
    setMensaje("")
    setCopied(false)
    onClose()
  }

  if (!orden) return null

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-green-600">
            <Check className="h-5 w-5" />
            Orden {orden.codigoOrden || `#${orden.numeroOrden}`} creada
          </DialogTitle>
          <DialogDescription>
            La orden fue creada exitosamente. Puede enviar el comprobante al cliente por WhatsApp.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Resumen de la orden */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Cliente:</span>
              <span className="font-medium">{orden.cliente.nombre}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Dispositivo:</span>
              <span className="font-medium">{orden.dispositivo}</span>
            </div>
            {orden.presupuesto && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Presupuesto:</span>
                <span className="font-medium text-primary">{formatPrice(orden.presupuesto)}</span>
              </div>
            )}
          </div>

          {/* Ver PDF, Imprimir, Etiqueta, Térmica */}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="flex-1 min-w-[110px]"
              onClick={handleDownloadPDF}
              disabled={downloading}
            >
              {downloading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileText className="mr-2 h-4 w-4" />
              )}
              PDF
            </Button>
            <Button
              variant="outline"
              className="flex-1 min-w-[110px]"
              onClick={handlePrint}
              disabled={printing}
            >
              {printing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Printer className="mr-2 h-4 w-4" />
              )}
              Imprimir
            </Button>
            <Button
              variant="outline"
              className="flex-1 min-w-[110px]"
              onClick={handlePrintLabel}
            >
              <Tag className="mr-2 h-4 w-4" />
              Etiqueta
            </Button>
            <div className="flex-1 min-w-[110px] [&>button]:w-full [&>button]:h-10">
              <ThermalPrintOrden orden={buildThermalOrden(orden)} />
            </div>
          </div>

          {/* Mensaje para WhatsApp */}
          <div>
            <Label className="flex items-center gap-2 mb-2">
              <WhatsAppIcon className="h-4 w-4 text-green-600" />
              Mensaje para WhatsApp
            </Label>
            <Textarea
              value={mensaje}
              onChange={(e) => setMensaje(e.target.value)}
              rows={8}
              className="font-mono text-sm"
            />
          </div>

          {/* Botones de accion */}
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
              onClick={handleOpenWhatsApp}
              className="flex-1 bg-green-600 hover:bg-green-700"
            >
              <WhatsAppIcon className="mr-2 h-4 w-4" />
              Abrir WhatsApp
              <ExternalLink className="ml-1 h-3 w-3" />
            </Button>
          </div>

          {/* Botón cerrar */}
          <Button variant="ghost" onClick={handleClose} className="w-full">
            Cerrar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
