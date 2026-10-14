"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, Printer, Receipt, Usb } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useThermalPrinter } from "@/components/pos/use-thermal-printer"
import { generateNotaCreditoTicketCommands } from "@/lib/escpos"
import { fitPrintPageToContent } from "@/lib/print-fit-page"
import { ANCHOS_TERMICOS, anchoToPx, readAncho, saveAncho, type AnchoTermico } from "@/lib/thermal-paper"
import { ticketDesdeDocumento } from "@/lib/notas-credito/ticket"
import type { NotaCreditoDocumento } from "@/lib/notas-credito/documento"
import { buildNotaCreditoTicketHTML } from "./nota-credito-ticket-html"

export interface NotaCreditoTicketDialogProps {
  notaCreditoId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Ancho fijo del contexto (el POS pasa pos_printer_width); sin él, el recordado en el dispositivo. */
  anchoInicial?: AnchoTermico
}

/**
 * Ticket térmico de una NC: USB (ESC/POS) o diálogo del navegador. El
 * documento lo trae GET /api/notas-credito/[id], que aplica el alcance de la
 * operación de origen.
 */
export function NotaCreditoTicketDialog({ notaCreditoId, open, onOpenChange, anchoInicial }: NotaCreditoTicketDialogProps) {
  const { connected, connecting, isSupported, connect, print } = useThermalPrinter()
  const [ancho, setAncho] = useState<AnchoTermico>(anchoInicial ?? 80)
  const [doc, setDoc] = useState<NotaCreditoDocumento | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [imprimiendo, setImprimiendo] = useState(false)

  useEffect(() => {
    if (!anchoInicial) setAncho(readAncho())
  }, [anchoInicial])

  useEffect(() => {
    if (!open) return
    let cancelado = false
    setDoc(null)
    setError(null)
    fetch(`/api/notas-credito/${encodeURIComponent(notaCreditoId)}`)
      .then(async (res) => {
        const body = await res.json()
        if (cancelado) return
        if (!res.ok) setError(body?.error || "No se pudo leer la nota de crédito")
        else setDoc(body as NotaCreditoDocumento)
      })
      .catch(() => {
        if (!cancelado) setError("No se pudo leer la nota de crédito")
      })
    return () => {
      cancelado = true
    }
  }, [open, notaCreditoId])

  const datos = useMemo(() => (doc ? ticketDesdeDocumento(doc) : null), [doc])
  const html = useMemo(() => (datos ? buildNotaCreditoTicketHTML(datos, { ancho }) : ""), [datos, ancho])

  const elegirAncho = (a: AnchoTermico) => {
    setAncho(a)
    saveAncho(a)
  }

  const imprimirUsb = async () => {
    if (!datos) return
    if (!connected) {
      await connect()
      return
    }
    setImprimiendo(true)
    try {
      const ok = await print(generateNotaCreditoTicketCommands(datos, ancho))
      if (ok) toast.success("Ticket impreso")
      else toast.error("No se pudo imprimir el ticket")
    } catch {
      toast.error("No se pudo imprimir el ticket")
    } finally {
      setImprimiendo(false)
    }
  }

  // Mismo camino que el ticket del POS (pos-terminal.tsx, printTicketHTML).
  const imprimirNavegador = () => {
    if (!html) return
    const ventana = window.open("", "_blank", "width=320,height=600")
    if (!ventana) return
    ventana.document.write(html)
    ventana.document.close()
    const d = ventana.document
    const disparar = async () => {
      try {
        await d.fonts.ready
      } catch {
        /* sin fonts.ready se mide con lo que haya */
      }
      fitPrintPageToContent(d, d.body, ancho)
      ventana.focus()
      ventana.print()
    }
    if (d.readyState === "complete") void disparar()
    else ventana.onload = () => void disparar()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ticket de la nota de crédito</DialogTitle>
          <DialogDescription>Imprimí en la térmica USB o con el diálogo del navegador.</DialogDescription>
        </DialogHeader>

        {error ? (
          <p role="alert" className="text-sm text-destructive">{error}</p>
        ) : !datos ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-center gap-2 text-sm">
              <span className="text-muted-foreground">Ancho del rollo:</span>
              {ANCHOS_TERMICOS.map((a) => (
                <Button key={a} type="button" size="sm" variant={ancho === a ? "default" : "outline"} onClick={() => elegirAncho(a)}>
                  {a}mm
                </Button>
              ))}
            </div>

            <div className="flex max-h-[60vh] justify-center overflow-y-auto rounded-md bg-muted/40 p-4">
              <iframe
                title="Vista previa del ticket"
                srcDoc={html}
                className="h-[480px] bg-white"
                style={{ width: anchoToPx(ancho) + 24 }}
              />
            </div>

            <div className="flex flex-col gap-2 pt-2 sm:flex-row">
              <Button variant="outline" className="flex-1" onClick={imprimirNavegador}>
                <Printer className="mr-2 h-4 w-4" />
                Imprimir (navegador)
              </Button>
              {isSupported ? (
                <Button className="flex-1" onClick={imprimirUsb} disabled={connecting || imprimiendo}>
                  {connecting || imprimiendo ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : connected ? (
                    <Receipt className="mr-2 h-4 w-4" />
                  ) : (
                    <Usb className="mr-2 h-4 w-4" />
                  )}
                  {connecting ? "Conectando..." : imprimiendo ? "Imprimiendo..." : connected ? "Imprimir térmica" : "Conectar térmica"}
                </Button>
              ) : null}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
