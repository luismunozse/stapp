"use client"

import { useState } from "react"
import useSWR from "swr"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { DollarSign, CheckCircle2 } from "lucide-react"
import { CobrarMultipleDialog } from "@/components/ordenes/cobrar-multiple-dialog"
import { useCurrency } from "@/contexts/currency-context"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface OrdenPendiente {
  id: string
  numeroOrden: number
  codigoOrden?: string
  dispositivo: string
  pendiente: number
  estadoCobro: string
}

interface Props {
  clienteId: string
  clienteNombre: string
  onCobrado?: () => void
}

export function ClienteOrdenesPendientes({ clienteId, clienteNombre, onCobrado }: Props) {
  const { formatPrice } = useCurrency()
  const [showCobrar, setShowCobrar] = useState(false)
  const { data, mutate } = useSWR<OrdenPendiente[]>(
    `/api/clientes/${clienteId}/ordenes-pendientes`, fetcher, { revalidateOnFocus: false }
  )

  const ordenes = data || []
  const totalPendiente = ordenes.reduce((acc, o) => acc + (o.pendiente || 0), 0)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Órdenes pendientes de cobro</CardTitle>
        {ordenes.length > 0 && (
          <Button size="sm" onClick={() => setShowCobrar(true)} className="gap-1.5">
            <DollarSign className="h-4 w-4" /> Cobrar todo ({formatPrice(totalPendiente)})
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {ordenes.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="Sin deuda pendiente" variant="default" />
        ) : (
          <div className="space-y-2">
            {ordenes.map((o) => (
              <div key={o.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div className="min-w-0">
                  <div className="font-medium text-sm">#{o.numeroOrden} · {o.dispositivo}</div>
                  <Badge variant="outline" className="text-[10px] mt-0.5">{o.estadoCobro}</Badge>
                </div>
                <div className="font-semibold tabular-nums text-destructive">{formatPrice(o.pendiente)}</div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {showCobrar && (
        <CobrarMultipleDialog
          open={showCobrar}
          onOpenChange={(o) => !o && setShowCobrar(false)}
          clienteId={clienteId}
          clienteNombre={clienteNombre}
          onSuccess={() => { setShowCobrar(false); mutate(); onCobrado?.() }}
        />
      )}
    </Card>
  )
}
