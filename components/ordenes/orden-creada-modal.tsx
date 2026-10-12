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
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"
import { useModal } from "@/contexts/modal-context"
import type { OrdenServicio } from "@/types"

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
  const { showError } = useModal()
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [mensaje, setMensaje] = useState("")
  const [plantillas, setPlantillas] = useState<Record<string, string> | null>(null)
  const { formatPrice, formatDate, timezone, pais } = useCurrency()

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
      await showError("Error al abrir el PDF")
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
      await showError("Error al imprimir la orden")
    } finally {
      setPrinting(false)
    }
  }

  const handlePrintLabel = async () => {
    if (!orden) return
    const baseUrl = typeof window !== "undefined" ? window.location.origin : ""
    const fecha = new Date().toLocaleDateString("es-AR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      timeZone: timezone,
    })
    // printDeviceLabel espera el diálogo real del driver y puede rechazar.
    // Sin este try/catch el reject queda sin manejar dentro de un onClick y
    // el operador no se entera de nada: la orden ya está creada, lo único
    // que falló es la impresión y eso es lo que hay que decirle.
    try {
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
    } catch (error) {
      console.error("Error imprimiendo la etiqueta:", error)
      await showError("No se pudo imprimir la etiqueta. La orden ya está creada: revisá la impresora e intentá de nuevo.")
    }
  }

  const handleOpenWhatsApp = () => {
    if (!orden) return
    const url = generateWhatsAppUrl(orden.telefonoContacto || orden.cliente.telefono, mensaje, pais)
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
