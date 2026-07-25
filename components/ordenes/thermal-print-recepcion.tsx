"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Receipt, Printer } from "lucide-react"
import { useTerminologia } from "@/contexts/currency-context"
import { fitPrintPageToContent } from "@/lib/print-fit-page"

export interface RecepcionReceiptEquipo {
  codigoOrden: string
  tipoDispositivo?: string | null
  marca?: string | null
  dispositivo: string
  problemaReportado: string
  accesorios?: string | null
}

export interface RecepcionReceiptData {
  codigo: string
  fecha: string
  clienteNombre: string
  clienteTelefono?: string | null
  organizationName?: string | null
  organizationTelefono?: string | null
  organizationDireccion?: string | null
  organizationComprobanteTerminos?: string | null
  /** Data URL completa (data:image/png;base64,...); null si no hay firma capturada. */
  firmaDataUrl?: string | null
  equipos: RecepcionReceiptEquipo[]
}

interface ThermalPrintRecepcionProps {
  data: RecepcionReceiptData
}

/**
 * Comprobante termico del lote de recepcion multiple. Mismo mecanismo que
 * ThermalPrintOrden (iframe oculto, impresion por el driver del navegador):
 * a diferencia de esa, no ofrece el path ESC/POS crudo por Bluetooth
 * (useThermalPrinter + generateOrdenTicketCommands), porque ese generador
 * esta armado para UN solo OrdenTicketData y extenderlo a N equipos
 * significaria tocar lib/escpos.ts, que esta fuera de alcance de esta tarea.
 * El path por driver del SO (el mismo que ya usa print-label.ts) generaliza
 * sin problema porque el @page se ajusta al contenido.
 */
export function ThermalPrintRecepcion({ data }: ThermalPrintRecepcionProps) {
  const [open, setOpen] = useState(false)

  const handleBrowserPrint = async () => {
    const source = document.getElementById("recepcion-receipt-print-area")
    if (!source) {
      window.print()
      return
    }

    const clone = source.cloneNode(true) as HTMLElement

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
  #recepcion-receipt-print-area { width: 80mm !important; padding: 2mm; box-sizing: border-box; }
  img { max-width: 100%; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
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
        try {
          await doc.fonts.ready
        } catch {
          /* measurement falls back to current metrics */
        }
        fitPrintPageToContent(doc, doc.getElementById("recepcion-receipt-print-area"), 80)
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
        title="Comprobante de recepcion 80mm"
      >
        <Receipt className="h-4 w-4 mr-2" />
        Comprobante
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Comprobante de recepcion</DialogTitle>
            <DialogDescription>
              Vista previa del comprobante 80mm con los {data.equipos.length} equipos del lote.
              Imprimi por navegador en la impresora termica.
            </DialogDescription>
          </DialogHeader>

          <div className="flex justify-center bg-muted/40 rounded-md p-4 max-h-[60vh] overflow-y-auto">
            <RecepcionReceiptPreview data={data} />
          </div>

          <Button variant="outline" className="w-full" onClick={handleBrowserPrint}>
            <Printer className="h-4 w-4 mr-2" />
            Imprimir (navegador)
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Sep({ char = "-" }: { char?: string }) {
  return <div className="overflow-hidden whitespace-nowrap">{char.repeat(48)}</div>
}

function RecepcionReceiptPreview({ data }: { data: RecepcionReceiptData }) {
  const term = useTerminologia()

  return (
    <div
      id="recepcion-receipt-print-area"
      className="bg-white text-black font-mono text-[11px] leading-tight p-3 text-center"
      style={{ width: "302px" }}
    >
      {data.organizationName && (
        <div className="text-center font-bold text-base">{data.organizationName}</div>
      )}
      {data.organizationTelefono && <div className="text-center">Tel: {data.organizationTelefono}</div>}
      {data.organizationDireccion && <div className="text-center">{data.organizationDireccion}</div>}

      <Sep char="=" />

      <div className="text-center font-bold text-base">RECEPCION</div>
      <div className="font-bold text-lg">{data.codigo}</div>
      <div>{data.fecha}</div>

      <Sep />

      <div className="font-bold">CLIENTE</div>
      <div>{data.clienteNombre}</div>
      {data.clienteTelefono && <div>Tel: {data.clienteTelefono}</div>}

      <Sep />

      <div className="font-bold">
        {data.equipos.length} {term("equipo").toUpperCase()}(S)
      </div>

      {data.equipos.map((equipo, i) => (
        <div key={equipo.codigoOrden || i} className="text-left mt-1">
          {i > 0 && <Sep />}
          <div className="font-bold text-center">{equipo.codigoOrden}</div>
          <div className="text-center">
            {[equipo.tipoDispositivo, equipo.marca, equipo.dispositivo].filter(Boolean).join(" - ")}
          </div>
          <div className="whitespace-pre-wrap break-words">Problema: {equipo.problemaReportado}</div>
          {equipo.accesorios && (
            <div className="whitespace-pre-wrap break-words">Accesorios: {equipo.accesorios}</div>
          )}
        </div>
      ))}

      <Sep />

      {data.organizationComprobanteTerminos && (
        <>
          <div className="font-bold">TERMINOS Y CONDICIONES</div>
          <div className="whitespace-pre-wrap break-words text-[10px]">
            {data.organizationComprobanteTerminos}
          </div>
          <Sep />
        </>
      )}

      <div className="font-bold mt-2">FIRMA (conformidad de los {data.equipos.length} equipos)</div>
      {data.firmaDataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={data.firmaDataUrl}
          alt="Firma del cliente"
          className="mx-auto my-1"
          style={{ maxWidth: "180px", maxHeight: "80px" }}
        />
      ) : (
        <div className="mt-6 mb-1 border-t border-black w-4/5 mx-auto" />
      )}
      <div className="text-center">{data.clienteNombre}</div>

      <Sep />
      <div className="text-center font-bold mt-1">Conserve este comprobante</div>
      {data.organizationTelefono && (
        <div className="text-center">Consultas: {data.organizationTelefono}</div>
      )}
    </div>
  )
}
