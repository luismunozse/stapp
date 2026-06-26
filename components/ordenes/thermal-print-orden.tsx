"use client"

import { useState, useMemo, useEffect } from "react"
import QRCode from "qrcode"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Receipt, Loader2, Usb, Printer, Eye } from "lucide-react"
import { useThermalPrinter } from "@/components/pos/use-thermal-printer"
import { generateOrdenTicketCommands, type OrdenTicketData } from "@/lib/escpos"
import { imageUrlToRaster, imageUrlToBinarizedDataUrl } from "@/lib/escpos-image"
import { ESTADO_LABELS } from "@/lib/orden-state-machine"
import { toast } from "sonner"
import type { OrdenServicio } from "@/types"
import { useCurrency } from "@/contexts/currency-context"

interface ThermalPrintOrdenProps {
  orden: OrdenServicio & {
    organizationName?: string | null
    organizationLogoUrl?: string | null
    organizationTelefono?: string | null
    organizationDireccion?: string | null
    organizationComprobanteTerminos?: string | null
  }
}

interface PreviewData {
  nombreEmpresa: string
  telefonoEmpresa: string | null
  direccionEmpresa: string | null
  logoUrl: string | null
  ordenCode: string
  fechaIngreso: string
  estado: string
  clienteNombre: string
  clienteTelefono: string | null
  dispositivo: string
  marca: string | null
  color: string | null
  imei: string | null
  accesorios: string | null
  problemaReportado: string
  observaciones: string | null
  presupuesto: number | null
  costoFinal: number | null
  fechaPrometida: string | null
  seguimientoUrl: string | null
  terminosCondiciones: string | null
}

function formatMoney(amount: number): string {
  return "$" + amount.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

export function ThermalPrintOrden({ orden }: ThermalPrintOrdenProps) {
  const { connected, connecting, isSupported, connect, print } = useThermalPrinter()
  const { timezone } = useCurrency()
  const [open, setOpen] = useState(false)
  const [printingThermal, setPrintingThermal] = useState(false)

  const preview: PreviewData = useMemo(() => {
    const seguimientoUrl = orden.publicToken && typeof window !== "undefined"
      ? `${window.location.origin}/seguimiento/${orden.publicToken}`
      : null
    return {
      nombreEmpresa: orden.organizationName || "Servicio Tecnico",
      telefonoEmpresa: orden.organizationTelefono ?? null,
      direccionEmpresa: orden.organizationDireccion ?? null,
      logoUrl: orden.organizationLogoUrl ?? null,
      seguimientoUrl,
      ordenCode: orden.codigoOrden || `#${String(orden.numeroOrden).padStart(4, "0")}`,
      fechaIngreso: orden.fechaIngreso
        ? new Date(orden.fechaIngreso).toLocaleString("es-AR", {
            day: "2-digit", month: "2-digit", year: "numeric",
            hour: "2-digit", minute: "2-digit",
            timeZone: timezone,
          })
        : "",
      estado: ESTADO_LABELS[orden.estado] || orden.estado,
      clienteNombre: orden.cliente?.nombre || "",
      clienteTelefono: orden.telefonoContacto || orden.cliente?.telefono || null,
      dispositivo: orden.dispositivo,
      marca: orden.marca ?? null,
      color: orden.color ?? null,
      imei: orden.imei ?? null,
      accesorios: orden.accesorios ?? null,
      problemaReportado: orden.problemaReportado,
      observaciones: orden.observaciones ?? null,
      presupuesto: orden.presupuesto ?? null,
      costoFinal: orden.costoFinal ?? null,
      fechaPrometida: orden.fechaPrometida
        ? new Date(orden.fechaPrometida).toLocaleDateString("es-AR", { timeZone: timezone })
        : null,
      terminosCondiciones: orden.organizationComprobanteTerminos ?? null,
    }
  }, [orden, timezone])

  const buildTicketData = async (): Promise<OrdenTicketData> => {
    let logoRaster: Uint8Array | null = null
    if (preview.logoUrl) {
      logoRaster = await imageUrlToRaster(preview.logoUrl, { maxWidth: 384 })
    }
    return {
      numeroOrden: orden.numeroOrden,
      codigoOrden: orden.codigoOrden,
      fechaIngreso: preview.fechaIngreso,
      estado: preview.estado,
      cliente: { nombre: preview.clienteNombre, telefono: preview.clienteTelefono },
      dispositivo: preview.dispositivo,
      marca: preview.marca,
      color: preview.color,
      imei: preview.imei,
      accesorios: preview.accesorios,
      problemaReportado: preview.problemaReportado,
      presupuesto: preview.presupuesto,
      costoFinal: preview.costoFinal,
      fechaPrometida: preview.fechaPrometida,
      observaciones: preview.observaciones,
      nombreEmpresa: preview.nombreEmpresa,
      telefonoEmpresa: preview.telefonoEmpresa,
      direccionEmpresa: preview.direccionEmpresa,
      logoRaster,
      qrUrl: preview.seguimientoUrl,
      terminosCondiciones: preview.terminosCondiciones,
    }
  }

  const handleThermalPrint = async () => {
    if (!connected) {
      await connect()
      return
    }
    setPrintingThermal(true)
    try {
      const ticketData = await buildTicketData()
      const commands = generateOrdenTicketCommands(ticketData, 80)
      const ok = await print(commands)
      if (ok) toast.success("Comprobante impreso")
      else toast.error("Error al imprimir")
    } catch {
      toast.error("Error al imprimir comprobante")
    } finally {
      setPrintingThermal(false)
    }
  }

  const handleBrowserPrint = async () => {
    const source = document.getElementById("thermal-receipt-print-area")
    if (!source) {
      window.print()
      return
    }

    // Pre-binarize logo so driver receives pure B/W (no grays to crush)
    let logoDataUrl: string | null = null
    if (preview.logoUrl) {
      logoDataUrl = await imageUrlToBinarizedDataUrl(preview.logoUrl, { maxWidth: 384 })
    }

    const clone = source.cloneNode(true) as HTMLElement
    if (logoDataUrl) {
      const logoImg = clone.querySelector("img") as HTMLImageElement | null
      if (logoImg) logoImg.src = logoDataUrl
    }

    const iframe = document.createElement("iframe")
    iframe.style.position = "fixed"
    iframe.style.right = "0"
    iframe.style.bottom = "0"
    iframe.style.width = "0"
    iframe.style.height = "0"
    iframe.style.border = "0"
    document.body.appendChild(iframe)

    const doc = iframe.contentDocument || iframe.contentWindow?.document
    if (!doc) {
      document.body.removeChild(iframe)
      window.print()
      return
    }

    const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
      .map((el) => el.outerHTML)
      .join("\n")

    doc.open()
    doc.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
${styles}
<style>
  @page { size: 80mm auto; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { width: 80mm; }
  #thermal-receipt-print-area { width: 80mm !important; padding: 2mm; box-sizing: border-box; }
  img { max-width: 100%; image-rendering: pixelated; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
</style>
</head>
<body>${clone.outerHTML}</body>
</html>`)
    doc.close()

    const cleanup = () => {
      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
      }, 500)
    }

    const waitForImages = async () => {
      const imgs = Array.from(doc.images)
      await Promise.all(
        imgs.map((img) =>
          img.complete && img.naturalWidth > 0
            ? Promise.resolve()
            : new Promise<void>((res) => {
                img.onload = () => res()
                img.onerror = () => res()
              })
        )
      )
    }

    const triggerPrint = async () => {
      try {
        await waitForImages()
        iframe.contentWindow?.focus()
        iframe.contentWindow?.print()
      } finally {
        cleanup()
      }
    }

    if (doc.readyState === "complete") {
      triggerPrint()
    } else {
      iframe.onload = () => triggerPrint()
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        title="Comprobante térmico 80mm"
      >
        <Receipt className="h-4 w-4 mr-2" />
        Térmica
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Comprobante térmico</DialogTitle>
            <DialogDescription>
              Vista previa del comprobante 80mm. Imprimí en impresora térmica USB o por navegador.
            </DialogDescription>
          </DialogHeader>

          <div className="flex justify-center bg-muted/40 rounded-md p-4 max-h-[60vh] overflow-y-auto">
            <ReceiptPreview data={preview} />
          </div>

          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleBrowserPrint}
            >
              <Printer className="h-4 w-4 mr-2" />
              Imprimir (navegador)
            </Button>

            {isSupported && (
              <Button
                className="flex-1"
                onClick={handleThermalPrint}
                disabled={connecting || printingThermal}
              >
                {connecting || printingThermal ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : connected ? (
                  <Receipt className="h-4 w-4 mr-2" />
                ) : (
                  <Usb className="h-4 w-4 mr-2" />
                )}
                {connecting
                  ? "Conectando..."
                  : printingThermal
                  ? "Imprimiendo..."
                  : connected
                  ? "Imprimir térmica"
                  : "Conectar térmica"}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Sep({ char = "-" }: { char?: string }) {
  return <div className="overflow-hidden whitespace-nowrap">{char.repeat(48)}</div>
}

function Row({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span>{left}</span>
      <span>{right}</span>
    </div>
  )
}

function ReceiptPreview({ data }: { data: PreviewData }) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!data.seguimientoUrl) {
      setQrDataUrl(null)
      return
    }
    QRCode.toDataURL(data.seguimientoUrl, { margin: 1, width: 200 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null))
  }, [data.seguimientoUrl])

  return (
    <div
      id="thermal-receipt-print-area"
      className="bg-white text-black font-mono text-[11px] leading-tight p-3 text-center"
      style={{ width: "302px" }}
    >
      {data.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={data.logoUrl}
          alt=""
          className="mx-auto mb-2"
          style={{ maxWidth: "200px", maxHeight: "100px", objectFit: "contain" }}
        />
      )}

      <div className="text-center font-bold text-base">{data.nombreEmpresa}</div>
      {data.telefonoEmpresa && <div className="text-center">Tel: {data.telefonoEmpresa}</div>}
      {data.direccionEmpresa && <div className="text-center">{data.direccionEmpresa}</div>}

      <Sep char="=" />

      <div className="text-center font-bold text-base">ORDEN DE SERVICIO</div>
      <div className="font-bold">{data.ordenCode}</div>
      <div>{data.fechaIngreso}</div>
      <Row left="Estado:" right={data.estado} />

      <Sep />

      <div className="font-bold">CLIENTE</div>
      <div>{data.clienteNombre}</div>
      {data.clienteTelefono && <Row left="Tel:" right={data.clienteTelefono} />}

      <Sep />

      <div className="font-bold">DISPOSITIVO</div>
      <div>{data.dispositivo}</div>
      {data.marca && <Row left="Marca:" right={data.marca} />}
      {data.color && <Row left="Color:" right={data.color} />}
      {data.imei && <Row left="IMEI:" right={data.imei} />}
      {data.accesorios && (
        <>
          <div>Accesorios:</div>
          <div className="whitespace-pre-wrap break-words"> {data.accesorios}</div>
        </>
      )}

      <Sep />

      <div className="font-bold">PROBLEMA REPORTADO</div>
      <div className="whitespace-pre-wrap break-words">{data.problemaReportado}</div>

      {data.observaciones && (
        <>
          <Sep />
          <div className="font-bold">Observaciones:</div>
          <div className="whitespace-pre-wrap break-words">{data.observaciones}</div>
        </>
      )}

      <Sep />

      {(data.presupuesto != null || data.costoFinal != null || data.fechaPrometida) && (
        <>
          {data.presupuesto != null && (
            <Row left="Presupuesto:" right={formatMoney(data.presupuesto)} />
          )}
          {data.costoFinal != null && (
            <Row left="Costo final:" right={formatMoney(data.costoFinal)} />
          )}
          {data.fechaPrometida && (
            <Row left="Entrega est.:" right={data.fechaPrometida} />
          )}
          <Sep />
        </>
      )}

      {qrDataUrl && (
        <>
          <div className="text-center font-bold mt-2">SEGUIMIENTO ONLINE</div>
          <div className="text-center text-[10px]">Escanea para ver el estado</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrDataUrl} alt="QR seguimiento" className="mx-auto my-1" style={{ width: "150px", height: "150px" }} />
          <Sep />
        </>
      )}

      {data.terminosCondiciones && (
        <>
          <div className="font-bold">TERMINOS Y CONDICIONES</div>
          <div className="whitespace-pre-wrap break-words text-[10px]">{data.terminosCondiciones}</div>
          <Sep />
        </>
      )}

      <div className="text-center font-bold mt-1">Conserve este comprobante</div>
      {data.telefonoEmpresa && (
        <div className="text-center">Consultas: {data.telefonoEmpresa}</div>
      )}

    </div>
  )
}
