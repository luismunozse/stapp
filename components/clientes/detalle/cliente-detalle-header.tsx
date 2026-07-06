"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, User, Building2, Edit, Plus, Wrench, Receipt } from "lucide-react"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useCurrency } from "@/contexts/currency-context"
import { useHasFeature } from "@/hooks/use-subscription"
import type { Cliente } from "@/types"

interface ClienteDetalleHeaderProps {
  cliente: Cliente
  saldo: number
  deudaPendiente: number
  totalOrdenes: number
  onEdit: () => void
  onWhatsApp: () => void
}

export function ClienteDetalleHeader({
  cliente, saldo, deudaPendiente, totalOrdenes, onEdit, onWhatsApp,
}: ClienteDetalleHeaderProps) {
  const { formatPrice } = useCurrency()
  const router = useRouter()
  const esEmpresa = cliente.tipoCliente === "EMPRESA"
  const { hasFeature: hasCotizaciones, loading: cotizacionesLoading } = useHasFeature("cotizaciones_online")
  const puedeCotizar = cotizacionesLoading || hasCotizaciones

  return (
    <div className="sticky top-0 z-10 bg-background border-b -mx-4 px-4 pb-4 sm:-mx-6 sm:px-6">
      <div className="flex items-start gap-3 pt-4">
        <Link href="/clientes" className="shrink-0 p-2 -ml-2 rounded-lg hover:bg-accent transition-colors" aria-label="Volver a clientes">
          <ArrowLeft className="h-5 w-5 text-muted-foreground" />
        </Link>
        <div className={`h-11 w-11 rounded-full flex items-center justify-center shrink-0 ${esEmpresa ? "bg-warning/10" : "bg-primary/10"}`}>
          {esEmpresa ? <Building2 className="h-5 w-5 text-warning-600" /> : <User className="h-5 w-5 text-primary" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg sm:text-2xl font-bold leading-tight">{cliente.nombre}</h1>
            {esEmpresa && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-warning/10 text-warning-700">Empresa</span>
            )}
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2">
            {cliente.telefono && <span>{cliente.telefono}</span>}
            {cliente.email && <span className="truncate">· {cliente.email}</span>}
            {(cliente.cuit || cliente.dni) && <span>· {cliente.cuit ? `CUIT ${cliente.cuit}` : `DNI ${cliente.dni}`}</span>}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="default" size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Nuevo</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-44 p-1">
              <button
                type="button"
                className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors"
                onClick={() => router.push(`/ordenes?clienteId=${cliente.id}`)}
              >
                <Wrench className="h-4 w-4" /> Nueva orden
              </button>
              {puedeCotizar && (
                <button
                  type="button"
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors"
                  onClick={() => router.push(`/cotizaciones?clienteId=${cliente.id}`)}
                >
                  <Receipt className="h-4 w-4" /> Nueva cotización
                </button>
              )}
            </PopoverContent>
          </Popover>
          <Button variant="outline" size="sm" onClick={onEdit} className="gap-1.5">
            <Edit className="h-4 w-4" /> <span className="hidden sm:inline">Editar</span>
          </Button>
          <Button variant="outline" size="sm" onClick={onWhatsApp} className="gap-1.5">
            <WhatsAppIcon className="h-4 w-4 text-success-600" /> <span className="hidden sm:inline">WhatsApp</span>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3 mt-4">
        <Card><CardContent className="p-3 text-center">
          <div className="text-xs text-muted-foreground">Saldo a favor</div>
          <div className="text-base sm:text-lg font-bold tabular-nums text-info-600">{formatPrice(saldo)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <div className="text-xs text-muted-foreground">Deuda pendiente</div>
          <div className={`text-base sm:text-lg font-bold tabular-nums ${deudaPendiente > 0 ? "text-destructive" : "text-muted-foreground"}`}>
            {formatPrice(deudaPendiente)}
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <div className="text-xs text-muted-foreground"># Órdenes</div>
          <div className="text-base sm:text-lg font-bold tabular-nums">{totalOrdenes}</div>
        </CardContent></Card>
      </div>
    </div>
  )
}
