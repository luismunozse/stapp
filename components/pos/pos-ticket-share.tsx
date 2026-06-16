"use client"

import { useState, useRef, useCallback } from "react"
import html2canvas from "html2canvas"
import { Button } from "@/components/ui/button"
import { Loader2, Share2, Download, ImageIcon } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import {
  buildVentaContext,
  renderVentaMessageCorto,
  type VentaForTemplate,
} from "@/lib/whatsapp/plantillas-venta"
import { generateWhatsAppUrl } from "@/lib/notifications/whatsapp-templates"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"

const METODO_LABELS: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  TARJETA: "Tarjeta",
  TARJETA_DEBITO: "T. Débito",
  TARJETA_CREDITO: "T. Crédito",
  MERCADOPAGO: "MercadoPago",
  CUENTA_CORRIENTE: "Cta. Cte.",
  OTRO: "Otro",
}

interface TicketShareProps {
  ventaData: {
    id: string
    numeroVenta: number
    clienteNombre: string
    clienteTelefono?: string | null
    items: Array<{
      descripcion: string
      cantidad: number
      precioUnitario: number
      diasGarantia?: number
    }>
    subtotal?: number
    descuento?: number
    total: number
    metodoPago: string
    organizationName?: string
    garantias?: Array<{ numeroGarantia: string | number; diasValidez: number }>
    // IVA snapshot fields from server (migration 229)
    iva_neto?: number | null
    iva_monto?: number | null
    iva_tasa?: number | null
    redondeo_monto?: number | null
  }
  plantillaCorta?: string | null
  countryCode?: string | null
}

export function PosTicketShare({ ventaData, plantillaCorta, countryCode }: TicketShareProps) {
  const { formatPrice } = useCurrency()
  const ticketRef = useRef<HTMLDivElement>(null)
  const [generating, setGenerating] = useState(false)

  const subtotal = ventaData.subtotal ?? ventaData.items.reduce((s, i) => s + i.cantidad * i.precioUnitario, 0)
  const descuento = ventaData.descuento ?? 0
  const metodo = METODO_LABELS[ventaData.metodoPago] || ventaData.metodoPago

  // IVA breakdown: prefer server snapshot (iva_neto/iva_monto), fall back to derived.
  // Using snapshot branch when iva_monto is present and > 0.
  const hasIvaSnapshot = typeof ventaData.iva_monto === "number" && ventaData.iva_monto > 0
  const ticketNeto = hasIvaSnapshot ? (ventaData.iva_neto ?? null) : null
  const ticketIva = hasIvaSnapshot ? (ventaData.iva_monto ?? null) : null
  const ticketIvaTasa = hasIvaSnapshot ? (ventaData.iva_tasa ?? null) : null
  const ticketRedondeo = (typeof ventaData.redondeo_monto === "number" && ventaData.redondeo_monto !== 0)
    ? ventaData.redondeo_monto
    : null
  // IVA source: "snapshot" if we read from server fields, "none" if no IVA applies
  // (derived path would require fiscal config which is not passed here)
  const fecha = new Date().toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

  const generateImage = useCallback(async (): Promise<Blob | null> => {
    if (!ticketRef.current) return null
    try {
      const canvas = await html2canvas(ticketRef.current, {
        scale: 2,
        backgroundColor: "#ffffff",
        logging: false,
        useCORS: true,
      })
      return new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), "image/png", 0.95)
      })
    } catch (err) {
      console.error("Error generating ticket image:", err)
      return null
    }
  }, [])

  const handleShareWhatsApp = useCallback(async () => {
    if (!ventaData.clienteTelefono) return
    setGenerating(true)
    try {
      const blob = await generateImage()
      if (!blob) throw new Error("No se pudo generar la imagen")

      const file = new File([blob], `ticket-venta-${ventaData.numeroVenta}.png`, { type: "image/png" })
      const ctx = buildVentaContext(ventaData as VentaForTemplate, formatPrice)
      const mensajeCorto = renderVentaMessageCorto(plantillaCorta, ctx)

      // Try Web Share API (works on mobile, shares directly to WhatsApp)
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          text: mensajeCorto,
          files: [file],
        })
      } else {
        // Fallback: download image + open WhatsApp with text
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = file.name
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)

        // Open WhatsApp with text message (multi-country via generateWhatsAppUrl)
        const waUrl = generateWhatsAppUrl(ventaData.clienteTelefono, mensajeCorto, countryCode)
        window.open(waUrl, "_blank")
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.error("Share error:", err)
      }
    } finally {
      setGenerating(false)
    }
  }, [ventaData, formatPrice, generateImage, plantillaCorta, countryCode])

  const handleDownloadImage = useCallback(async () => {
    setGenerating(true)
    try {
      const blob = await generateImage()
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `ticket-venta-${ventaData.numeroVenta}.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } finally {
      setGenerating(false)
    }
  }, [ventaData.numeroVenta, generateImage])

  return (
    <>
      {/* Hidden ticket for html2canvas rendering */}
      <div style={{ position: "fixed", left: "-9999px", top: 0 }}>
        <div
          ref={ticketRef}
          style={{
            width: "320px",
            padding: "20px 16px",
            fontFamily: "'Courier New', Courier, monospace",
            fontSize: "13px",
            lineHeight: "1.4",
            color: "#000",
            backgroundColor: "#fff",
          }}
        >
          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: "8px" }}>
            <div style={{ fontSize: "18px", fontWeight: "bold", marginBottom: "2px" }}>
              {ventaData.organizationName || "Servicio Técnico"}
            </div>
          </div>

          <div style={{ borderTop: "2px solid #000", margin: "6px 0" }} />

          {/* Venta number */}
          <div style={{ textAlign: "center", marginBottom: "8px" }}>
            <div style={{ fontSize: "20px", fontWeight: "bold" }}>
              VENTA #{String(ventaData.numeroVenta).padStart(4, "0")}
            </div>
            <div style={{ fontSize: "11px", color: "#555" }}>{fecha}</div>
          </div>

          <div style={{ borderTop: "1px dashed #999", margin: "6px 0" }} />

          {/* Cliente */}
          <div style={{ marginBottom: "6px" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#666", fontSize: "11px" }}>Cliente:</span>
              <span style={{ fontWeight: "bold", fontSize: "12px" }}>{ventaData.clienteNombre || "Consumidor Final"}</span>
            </div>
            {ventaData.clienteTelefono && (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#666", fontSize: "11px" }}>Tel:</span>
                <span style={{ fontSize: "12px" }}>{ventaData.clienteTelefono}</span>
              </div>
            )}
          </div>

          <div style={{ borderTop: "1px dashed #999", margin: "6px 0" }} />

          {/* Items */}
          {ventaData.items.map((item, i) => (
            <div key={i} style={{ marginBottom: "6px" }}>
              <div style={{ fontWeight: "bold", fontSize: "12px" }}>{item.descripcion}</div>
              <div style={{ display: "flex", justifyContent: "space-between", color: "#555", fontSize: "12px" }}>
                <span>&nbsp;&nbsp;{item.cantidad} x {formatPrice(item.precioUnitario)}</span>
                <span style={{ fontWeight: "bold", color: "#000" }}>{formatPrice(item.cantidad * item.precioUnitario)}</span>
              </div>
              {item.diasGarantia && item.diasGarantia > 0 && (
                <div style={{ fontSize: "10px", color: "#888" }}>&nbsp;&nbsp;Garantía: {item.diasGarantia} días</div>
              )}
            </div>
          ))}

          <div style={{ borderTop: "2px solid #000", margin: "8px 0" }} />

          {/* Totals */}
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
            <span style={{ color: "#666" }}>Subtotal:</span>
            <span>{formatPrice(subtotal)}</span>
          </div>
          {descuento > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px", color: "#c00" }}>
              <span>Descuento:</span>
              <span>-{formatPrice(descuento)}</span>
            </div>
          )}
          {/* IVA breakdown — reads from server snapshot when available */}
          {ticketNeto !== null && (
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px", color: "#555" }}>
              <span>Neto:</span>
              <span>{formatPrice(ticketNeto)}</span>
            </div>
          )}
          {ticketIva !== null && (
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px", color: "#555" }}>
              <span>IVA{ticketIvaTasa ? ` (${ticketIvaTasa}%)` : ""}:</span>
              <span>{formatPrice(ticketIva)}</span>
            </div>
          )}
          {ticketRedondeo !== null && (
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px", color: "#555" }}>
              <span>Redondeo:</span>
              <span>{ticketRedondeo >= 0 ? "+" : ""}{formatPrice(ticketRedondeo)}</span>
            </div>
          )}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "18px",
              fontWeight: "bold",
              padding: "6px 0",
              borderTop: "1px solid #ccc",
              marginTop: "4px",
            }}
          >
            <span>TOTAL:</span>
            <span>{formatPrice(ventaData.total)}</span>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px", fontSize: "12px" }}>
            <span style={{ color: "#666" }}>Pago:</span>
            <span style={{ fontWeight: "bold" }}>{metodo}</span>
          </div>

          {/* Garantías */}
          {ventaData.garantias && ventaData.garantias.length > 0 && (
            <>
              <div style={{ borderTop: "1px dashed #999", margin: "8px 0" }} />
              <div style={{ fontSize: "10px", color: "#666", textAlign: "center" }}>
                {ventaData.garantias.length} certificado(s) de garantía
              </div>
            </>
          )}

          <div style={{ borderTop: "2px solid #000", margin: "8px 0" }} />

          {/* Footer */}
          <div style={{ textAlign: "center", fontSize: "12px" }}>
            <div style={{ fontWeight: "bold", marginBottom: "2px" }}>¡Gracias por su compra!</div>
            <div style={{ color: "#888", fontSize: "10px" }}>Conserve este ticket como comprobante</div>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        {ventaData.clienteTelefono && (
          <Button
            variant="outline"
            className="flex-1 h-11 text-green-600 border-green-300"
            onClick={handleShareWhatsApp}
            disabled={generating}
          >
            {generating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <WhatsAppIcon className="mr-2 h-4 w-4" />
            )}
            WhatsApp
          </Button>
        )}
        <Button
          variant="outline"
          className="h-11"
          onClick={handleDownloadImage}
          disabled={generating}
          title="Descargar ticket como imagen"
        >
          {generating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ImageIcon className="h-4 w-4" />
          )}
        </Button>
      </div>
    </>
  )
}
