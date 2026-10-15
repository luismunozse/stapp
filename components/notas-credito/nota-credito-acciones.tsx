"use client"

import { useState } from "react"
import { FileDown, Receipt } from "lucide-react"
import { Button } from "@/components/ui/button"
import { NotaCreditoTicketDialog } from "./nota-credito-ticket-dialog"

export interface NotaCreditoAccionesProps {
  /** id de la NC: el mismo en v_notas_credito y en la tabla de su motor. */
  id: string
  /** Solo íconos, para la fila de una tabla. */
  compacto?: boolean
}

/**
 * Lo que se puede hacer con una NC ya emitida, igual en el listado y en los
 * bloques del detalle. El servidor decide quién ve qué: cada botón pega a una
 * ruta con el alcance de la operación de origen.
 */
export function NotaCreditoAcciones({ id, compacto = false }: NotaCreditoAccionesProps) {
  const [ticketAbierto, setTicketAbierto] = useState(false)
  const abrirPdf = () => window.open(`/api/notas-credito/${encodeURIComponent(id)}/pdf`, "_blank")

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
      {ticketAbierto ? (
        <NotaCreditoTicketDialog notaCreditoId={id} open={ticketAbierto} onOpenChange={setTicketAbierto} />
      ) : null}
    </div>
  )
}
