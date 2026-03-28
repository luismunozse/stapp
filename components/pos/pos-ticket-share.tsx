"use client"

import { useState, useRef, useCallback } from "react"
import html2canvas from "html2canvas"
import { Button } from "@/components/ui/button"
import { Loader2, Share2, Download, ImageIcon } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}

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
    garantias?: Array<{ numeroGarantia: string; diasValidez: number }>
  }
}

export function PosTicketShare({ ventaData }: TicketShareProps) {
  const { formatPrice } = useCurrency()
  const ticketRef = useRef<HTMLDivElement>(null)
  const [generating, setGenerating] = useState(false)

  const subtotal = ventaData.subtotal ?? ventaData.items.reduce((s, i) => s + i.cantidad * i.precioUnitario, 0)
  const descuento = ventaData.descuento ?? 0
  const metodo = METODO_LABELS[ventaData.metodoPago] || ventaData.metodoPago
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

      // Try Web Share API (works on mobile, shares directly to WhatsApp)
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          text: `Comprobante de venta #${ventaData.numeroVenta} - ${formatPrice(ventaData.total)}`,
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

        // Open WhatsApp with text message
        const phone = ventaData.clienteTelefono.replace(/\D/g, "")
        const msg = encodeURIComponent(
          `Hola ${ventaData.clienteNombre}, gracias por tu compra!\nVenta #${ventaData.numeroVenta} por ${formatPrice(ventaData.total)}.\nTe enviamos el comprobante como imagen.`
        )
        window.open(`https://wa.me/54${phone}?text=${msg}`, "_blank")
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.error("Share error:", err)
      }
    } finally {
      setGenerating(false)
    }
  }, [ventaData, formatPrice, generateImage])

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
