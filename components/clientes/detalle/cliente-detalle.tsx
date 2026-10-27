"use client"

import { useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import { Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ClienteDetalleSkeleton } from "./cliente-detalle-skeleton"
import { ClienteDetalleHeader } from "./cliente-detalle-header"
import { ClienteForm } from "@/components/clientes/cliente-form"
import { ClienteWhatsAppDialog } from "@/components/clientes/cliente-whatsapp-dialog"
import { ClienteDetalleDatos } from "./cliente-detalle-datos"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { CuentaCorrientePanel } from "./cuenta-corriente-panel"
import { ReparacionesExpressDialog } from "./reparaciones-express-dialog"
import { ClienteOrdenesPendientes } from "./cliente-ordenes-pendientes"
import { ClienteOrdenesHistorial } from "./cliente-ordenes-historial"
import { ClienteCotizaciones } from "./cliente-cotizaciones"
import { ClienteSectores } from "./cliente-sectores"
import { ClienteNotasCreditoLink } from "./cliente-notas-credito-link"
import { resumenDeudaCliente } from "@/lib/cliente-deuda-resumen"
import type { Cliente } from "@/types"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

// Throws with the HTTP status so the detail can tell "not found" from a failed load.
class HttpError extends Error {
  constructor(public status: number) { super(`HTTP ${status}`) }
}
const clienteFetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new HttpError(res.status)
  return res.json()
}


interface ClienteDetalleProps {
  clienteId: string
  // Server-resolved plan gate (hasPlanFeature, "reparaciones_express") — see
  // app/(dashboard)/clientes/[id]/page.tsx. Mirrors how canRecepcionMultiple
  // is threaded into OrdenesList: hide the entry point client-side, the API
  // route is the real enforcement (app/api/reparaciones-express/route.ts).
  canReparacionesExpress?: boolean
}

export function ClienteDetalle({ clienteId, canReparacionesExpress = false }: ClienteDetalleProps) {
  const [showEdit, setShowEdit] = useState(false)
  const [showWhatsApp, setShowWhatsApp] = useState(false)
  const [showExpress, setShowExpress] = useState(false)

  const { data: cliente, error, isLoading, mutate } = useSWR<Cliente>(
    `/api/clientes/${clienteId}`, clienteFetcher, {
      revalidateOnFocus: false,
      // A 404 won't fix itself on retry
      shouldRetryOnError: (e) => !(e instanceof HttpError && e.status === 404),
    }
  )
  const { data: ccData, mutate: mutateCC } = useSWR(
    `/api/clientes/${clienteId}/cuenta-corriente?limit=50`, fetcher, { revalidateOnFocus: false }
  )
  // Fiado + unpaid orders for the active sucursal (same source as the WhatsApp reminder).
  const { data: deudaData, mutate: mutateDeuda } = useSWR<{ deudaTotal?: number; error?: string }>(
    `/api/clientes/${clienteId}/deuda-sucursal`, fetcher, { revalidateOnFocus: false }
  )
  const { data: ordenesData } = useSWR(
    `/api/ordenes?clienteId=${clienteId}&limit=1`, fetcher, { revalidateOnFocus: false }
  )
  const { data: configData } = useSWR("/api/configuracion", fetcher, {
    revalidateOnFocus: false, dedupingInterval: 60000,
  })
  const organizationName: string = configData?.nombreEmpresa || ""

  if (isLoading) return <ClienteDetalleSkeleton />

  const notFound = (error instanceof HttpError && error.status === 404) || (!error && !cliente)
  if (error && !notFound) {
    return (
      <div className="px-4 py-6 sm:px-6 max-w-5xl mx-auto">
        <div className="text-center py-20 space-y-4">
          <p className="text-muted-foreground">No se pudo cargar el cliente.</p>
          <div className="flex justify-center gap-2">
            <Button onClick={() => mutate()}>Reintentar</Button>
            <Button asChild variant="outline"><Link href="/clientes">Volver a clientes</Link></Button>
          </div>
        </div>
      </div>
    )
  }

  if (notFound || !cliente) {
    return (
      <div className="px-4 py-6 sm:px-6 max-w-5xl mx-auto">
        <div className="text-center py-20 space-y-4">
          <p className="text-muted-foreground">No se encontró el cliente.</p>
          <Button asChild><Link href="/clientes">Volver a clientes</Link></Button>
        </div>
      </div>
    )
  }

  const saldo = ccData?.saldo || 0
  const resumen = resumenDeudaCliente({
    saldo: ccData?.saldo,
    deudaTotal: typeof deudaData?.deudaTotal === "number" ? deudaData.deudaTotal : undefined,
  })
  const refreshMoney = () => { mutateCC(); mutateDeuda() }
  const totalOrdenes = ordenesData?.total || 0

  return (
    <div className="px-4 py-6 sm:px-6 max-w-5xl mx-auto">
      <ClienteDetalleHeader
        cliente={cliente}
        resumen={resumen}
        totalOrdenes={totalOrdenes}
        onEdit={() => setShowEdit(true)}
        onWhatsApp={() => setShowWhatsApp(true)}
      />

      <div className="space-y-6 pt-6">
        <ClienteDetalleDatos cliente={cliente} />
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Cuenta corriente</CardTitle>
            <div className="flex flex-wrap gap-2">
              <ClienteNotasCreditoLink clienteId={clienteId} />
              {canReparacionesExpress && (
                <Button variant="outline" size="sm" onClick={() => setShowExpress(true)} className="gap-1.5">
                  <Wrench className="h-4 w-4" /> Cargar reparaciones
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <CuentaCorrientePanel cliente={cliente} onDeposito={refreshMoney} />
          </CardContent>
        </Card>
        <ClienteOrdenesPendientes
          clienteId={clienteId}
          clienteNombre={cliente.nombre}
          onCobrado={refreshMoney}
        />
        <ClienteOrdenesHistorial clienteId={clienteId} />
        <ClienteCotizaciones clienteId={clienteId} />
        {cliente.tipoCliente === "EMPRESA" && (
          <ClienteSectores sectores={cliente.sectores || []} />
        )}
      </div>

      <ClienteForm
        open={showEdit}
        cliente={cliente}
        onClose={() => setShowEdit(false)}
        onSuccess={() => { setShowEdit(false); mutate() }}
      />
      <ReparacionesExpressDialog
        cliente={cliente}
        saldoActual={saldo}
        open={showExpress}
        onOpenChange={setShowExpress}
        onDone={() => { mutate(); refreshMoney() }}
      />
      {showWhatsApp && (
        <ClienteWhatsAppDialog
          open={showWhatsApp}
          onOpenChange={(o) => !o && setShowWhatsApp(false)}
          cliente={cliente}
          organizationName={organizationName}
        />
      )}
    </div>
  )
}
