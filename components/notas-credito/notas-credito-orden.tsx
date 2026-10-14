"use client"

import useSWR from "swr"
import { FileMinus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useCurrency } from "@/contexts/currency-context"
import type { NotaCreditoFila } from "@/lib/notas-credito/listado"
import { NotaCreditoAcciones } from "./nota-credito-acciones"

// Un error (orden que el usuario no ve, red) deja el bloque vacío: el detalle
// de la orden no puede romperse por un bloque secundario.
const fetcher = async (url: string): Promise<NotaCreditoFila[]> => {
  const res = await fetch(url)
  if (!res.ok) return []
  const body = await res.json()
  return Array.isArray(body) ? body : []
}

/**
 * Las notas de crédito de una orden, para quien ve la orden. Solo lectura e
 * impresión: emitir desde acá es del PR5 y anular, del PR6.
 */
export function NotasCreditoOrden({ ordenId }: { ordenId: string }) {
  const { formatPrice, formatDate } = useCurrency()
  const { data } = useSWR<NotaCreditoFila[]>(`/api/ordenes/${ordenId}/notas-credito`, fetcher, {
    revalidateOnFocus: false,
  })
  const notas = data ?? []
  if (notas.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileMinus className="h-5 w-5" />
          Notas de crédito ({notas.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {notas.map((nc) => (
          <div key={nc.id} className="space-y-2 rounded-lg border p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-medium">{nc.numero}</span>
                {nc.anulada ? <Badge variant="destructive">Anulada</Badge> : null}
              </div>
              <span className={nc.anulada ? "text-muted-foreground line-through" : "font-bold text-destructive"}>
                -{formatPrice(nc.monto)}
              </span>
            </div>
            <div className="text-sm text-muted-foreground">{nc.motivo}</div>
            {nc.montoAplicadoDeuda > 0 || nc.montoReembolso > 0 ? (
              <div className="text-sm text-muted-foreground">
                {[
                  nc.montoAplicadoDeuda > 0 ? `Bajó la deuda ${formatPrice(nc.montoAplicadoDeuda)}` : null,
                  nc.montoReembolso > 0
                    ? `Reintegro ${formatPrice(nc.montoReembolso)}${nc.metodoLabel ? ` (${nc.metodoLabel})` : ""}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            ) : null}
            <div className="text-xs text-muted-foreground">
              {formatDate(nc.fecha)}
              {nc.usuarioNombre ? ` — ${nc.usuarioNombre}` : ""}
            </div>
            <NotaCreditoAcciones id={nc.id} />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
