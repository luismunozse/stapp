"use client"

import { useState } from "react"
import { FileDown, Loader2, MessageCircle, Receipt } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { mensajeNotaCredito, compartirNotaCredito, descargarPdfNotaCredito } from "@/lib/notas-credito/whatsapp"
import type { NotaCreditoDocumento } from "@/lib/notas-credito/documento"
import { NotaCreditoTicketDialog } from "./nota-credito-ticket-dialog"

export interface NotaCreditoAccionesProps {
  /** id de la NC: el mismo en v_notas_credito y en la tabla de su motor. */
  id: string
  /** Solo íconos, para la fila de una tabla. */
  compacto?: boolean
  /** Una NC anulada ya no se manda al cliente: sin WhatsApp (PDF y ticket siguen). */
  anulada?: boolean
}

/**
 * Lo que se puede hacer con una NC ya emitida, igual en el listado y en los
 * bloques del detalle. El servidor decide quién ve qué: cada botón pega a una
 * ruta con el alcance de la operación de origen.
 */
export function NotaCreditoAcciones({ id, compacto = false, anulada = false }: NotaCreditoAccionesProps) {
  const [ticketAbierto, setTicketAbierto] = useState(false)
  const abrirPdf = () => window.open(`/api/notas-credito/${encodeURIComponent(id)}/pdf`, "_blank")

  const [compartiendo, setCompartiendo] = useState(false)

  const compartir = async () => {
    setCompartiendo(true)
    try {
      // Todo junto: la hoja de compartir del navegador exige un click reciente.
      const [docRes, configRes, pdf] = await Promise.all([
        fetch(`/api/notas-credito/${encodeURIComponent(id)}`),
        // La plantilla del taller es opcional: sin ella va la de STApp. Esta
        // lectura la puede hacer cualquier miembro de la org; si falla, sale la
        // de STApp.
        fetch("/api/notificaciones/config").catch(() => null),
        descargarPdfNotaCredito(id),
      ])
      if (!docRes.ok) throw new Error("documento")
      const doc = (await docRes.json()) as NotaCreditoDocumento
      const config = configRes && configRes.ok ? await configRes.json() : null
      const resultado = await compartirNotaCredito({
        numero: doc.numero,
        telefono: doc.cliente.telefono,
        pais: doc.emisor.pais,
        mensaje: mensajeNotaCredito(doc, config?.plantillasWhatsapp ?? null),
        pdf,
      })
      if (resultado === "descargado") {
        toast.info("Se descargó el PDF. El cliente no tiene teléfono cargado: adjuntalo en WhatsApp.")
      } else if (resultado === "bloqueado") {
        toast.info("Se descargó el PDF, pero el navegador bloqueó WhatsApp: abrí WhatsApp y adjuntalo.")
      }
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") toast.error("No se pudo preparar la nota de crédito para WhatsApp")
    } finally {
      setCompartiendo(false)
    }
  }

  return (
    <div className="flex flex-wrap gap-2" data-no-row-click>
      <Button variant="outline" size="sm" onClick={abrirPdf} aria-label="PDF" title="Ver PDF">
        <FileDown className="h-4 w-4" />
        {compacto ? null : <span className="ml-1">PDF</span>}
      </Button>
      <Button variant="outline" size="sm" onClick={() => setTicketAbierto(true)} aria-label="Ticket" title="Imprimir ticket">
        <Receipt className="h-4 w-4" />
        {compacto ? null : <span className="ml-1">Ticket</span>}
      </Button>
      {anulada ? null : (
        <Button variant="outline" size="sm" onClick={compartir} disabled={compartiendo} aria-label="WhatsApp" title="Enviar por WhatsApp">
          {compartiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
          {compacto ? null : <span className="ml-1">WhatsApp</span>}
        </Button>
      )}
      {ticketAbierto ? (
        <NotaCreditoTicketDialog notaCreditoId={id} open={ticketAbierto} onOpenChange={setTicketAbierto} />
      ) : null}
    </div>
  )
}
