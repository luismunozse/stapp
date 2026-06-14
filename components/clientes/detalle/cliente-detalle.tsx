"use client"

import { useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ClienteDetalleHeader } from "./cliente-detalle-header"
import { ClienteForm } from "@/components/clientes/cliente-form"
import { ClienteWhatsAppDialog } from "@/components/clientes/cliente-whatsapp-dialog"
import { ClienteDetalleDatos } from "./cliente-detalle-datos"
import type { Cliente } from "@/types"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface OrdenPendiente { id: string; pendiente: number }

export function ClienteDetalle({ clienteId }: { clienteId: string }) {
  const [showEdit, setShowEdit] = useState(false)
  const [showWhatsApp, setShowWhatsApp] = useState(false)

  const { data: cliente, error, isLoading, mutate } = useSWR<Cliente>(
    `/api/clientes/${clienteId}`, fetcher, { revalidateOnFocus: false }
  )
  const { data: ccData, mutate: mutateCC } = useSWR(
    `/api/clientes/${clienteId}/cuenta-corriente?limit=1`, fetcher, { revalidateOnFocus: false }
  )
  const { data: pendientes } = useSWR<OrdenPendiente[]>(
    `/api/clientes/${clienteId}/ordenes-pendientes`, fetcher, { revalidateOnFocus: false }
  )
  const { data: ordenesData } = useSWR(
    `/api/ordenes?clienteId=${clienteId}&limit=1`, fetcher, { revalidateOnFocus: false }
  )
  const { data: configData } = useSWR("/api/configuracion", fetcher, {
    revalidateOnFocus: false, dedupingInterval: 60000,
  })
  const organizationName: string = configData?.nombreEmpresa || ""

  if (isLoading) {
    return (
      <div className="px-4 py-6 sm:px-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  if (error || !cliente || (cliente as any).error) {
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
  const deudaPendiente = (pendientes || []).reduce((acc, o) => acc + (o.pendiente || 0), 0)
  const totalOrdenes = ordenesData?.total || 0

  return (
    <div className="px-4 py-6 sm:px-6 max-w-5xl mx-auto">
      <ClienteDetalleHeader
        cliente={cliente}
        saldo={saldo}
        deudaPendiente={deudaPendiente}
        totalOrdenes={totalOrdenes}
        onEdit={() => setShowEdit(true)}
        onWhatsApp={() => setShowWhatsApp(true)}
      />

      <div className="space-y-6 pt-6">
        <ClienteDetalleDatos cliente={cliente} />
        {/* Task 3 panel: Cuenta corriente */}
        {/* Task 6: Órdenes pendientes + cobrar */}
        {/* Task 7: Historial de órdenes */}
        {/* Task 8: Cotizaciones */}
        {/* Task 9: Sectores (solo EMPRESA) */}
      </div>

      <ClienteForm
        open={showEdit}
        cliente={cliente}
        onClose={() => setShowEdit(false)}
        onSuccess={() => { setShowEdit(false); mutate() }}
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
