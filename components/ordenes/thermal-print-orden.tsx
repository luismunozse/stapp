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
import { imageUrlToRaster } from "@/lib/escpos-image"
import { ESTADO_LABELS } from "@/lib/orden-state-machine"
import { toast } from "sonner"
import type { OrdenServicio } from "@/types"

interface ThermalPrintOrdenProps {
  orden: OrdenServicio & {
    organizationName?: string | null
    organizationLogoUrl?: string | null
    organizationTelefono?: string | null
    organizationDireccion?: string | null
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
}

function formatMoney(amount: number): string {
  return "$" + amount.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

export function ThermalPrintOrden({ orden }: ThermalPrintOrdenProps) {
  const { connected, connecting, isSupported, connect, print } = useThermalPrinter()
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
        ? new Date(orden.fechaPrometida).toLocaleDateString("es-AR")
        : null,
    }
  }, [orden])

  const buildTicketData = async (): Promise<OrdenTicketData> => {
    let logoRaster: Uint8Array | null = null
    if (preview.logoUrl) {
      logoRaster = await imageUrlToRaster(preview.logoUrl, { maxWidth: 280 })
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

  const handleBrowserPrint = () => {
    window.print()
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
      className="bg-white text-black font-mono text-[11px] leading-tight p-3"
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

      <div className="text-center font-bold mt-1">Conserve este comprobante</div>
      {data.telefonoEmpresa && (
        <div className="text-center">Consultas: {data.telefonoEmpresa}</div>
      )}

      <style jsx global>{`
        @media print {
          @page {
            size: 80mm auto;
            margin: 0;
          }
          body * {
            visibility: hidden;
          }
          #thermal-receipt-print-area,
          #thermal-receipt-print-area * {
            visibility: visible;
          }
          #thermal-receipt-print-area {
            position: fixed;
            left: 0;
            top: 0;
            width: 80mm;
            padding: 2mm;
          }
        }
      `}</style>
    </div>
  )
}
