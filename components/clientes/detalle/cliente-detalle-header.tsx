"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, User, Building2, Edit, Plus, Wrench, Receipt } from "lucide-react"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useCurrency } from "@/contexts/currency-context"
import { getTaxIdLabel, getPersonalIdLabel } from "@/lib/countries"
import { useHasFeature } from "@/hooks/use-subscription"
import { TipoPrecioBadge } from "@/components/clientes/tipo-precio-badge"
import type { ResumenDeudaCliente } from "@/lib/cliente-deuda-resumen"
import type { Cliente } from "@/types"

const TONE_CLASS = {
  destructive: "text-destructive",
  info: "text-info-600",
  muted: "text-muted-foreground",
} as const

interface ClienteDetalleHeaderProps {
  cliente: Cliente
  resumen: ResumenDeudaCliente
  // The debt request failed (not just loading)
  deudaError?: boolean
  // Debt is scoped to the active sucursal while the balance below is org-wide
  porSucursal?: boolean
  totalOrdenes: number
  onEdit: () => void
  onWhatsApp: () => void
}

export function ClienteDetalleHeader({
  cliente, resumen, deudaError = false, porSucursal = false, totalOrdenes, onEdit, onWhatsApp,
}: ClienteDetalleHeaderProps) {
  const { formatPrice, pais } = useCurrency()
  const router = useRouter()
  const esEmpresa = cliente.tipoCliente === "EMPRESA"
  const { hasFeature: hasCotizaciones, loading: cotizacionesLoading } = useHasFeature("cotizaciones_online")
  const puedeCotizar = cotizacionesLoading || hasCotizaciones

  return (
    <div>
      {/* Only the identity row sticks, and only where there is no fixed mobile topbar (lg+). */}
      <div className="bg-background lg:border-b -mx-4 px-4 pb-4 sm:-mx-6 sm:px-6 lg:sticky lg:top-0 lg:z-10">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-3 pt-4">
          <Link href="/clientes" className="shrink-0 flex h-10 w-10 items-center justify-center -ml-2 rounded-lg hover:bg-accent transition-colors" aria-label="Volver a clientes">
            <ArrowLeft className="h-5 w-5 text-muted-foreground" />
          </Link>
          <div className={`h-11 w-11 rounded-full flex items-center justify-center shrink-0 ${esEmpresa ? "bg-warning/10" : "bg-primary/10"}`}>
            {esEmpresa ? <Building2 className="h-5 w-5 text-warning-600" /> : <User className="h-5 w-5 text-primary" />}
          </div>
          <div className="flex-1 min-w-0 basis-40">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg sm:text-2xl font-bold leading-tight break-words min-w-0">{cliente.nombre}</h1>
              {esEmpresa && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-warning/10 text-warning-700">Empresa</span>
              )}
              <TipoPrecioBadge tipoPrecio={cliente.tipoPrecio} />
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2">
              {cliente.telefono && <span>{cliente.telefono}</span>}
              {cliente.email && <span className="break-all">· {cliente.email}</span>}
              {(cliente.cuit || cliente.dni) && <span>· {cliente.cuit ? `${getTaxIdLabel(pais)} ${cliente.cuit}` : `${getPersonalIdLabel(pais)} ${cliente.dni}`}</span>}
            </p>
          </div>
          {/* Own row under the name on mobile (labels stay visible, so no icon-only buttons) */}
          <div className="flex w-full items-center gap-2 sm:w-auto sm:shrink-0 sm:gap-1.5">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="default" size="sm" className="h-10 flex-1 gap-1.5 sm:h-9 sm:flex-none">
                  <Plus className="h-4 w-4" /> Nuevo
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-44 p-1">
                <button
                  type="button"
                  className="flex items-center gap-2 w-full px-3 py-2.5 text-sm rounded-md hover:bg-accent transition-colors"
                  onClick={() => router.push(`/ordenes?clienteId=${cliente.id}`)}
                >
                  <Wrench className="h-4 w-4" /> Nueva orden
                </button>
                {puedeCotizar && (
                  <button
                    type="button"
                    className="flex items-center gap-2 w-full px-3 py-2.5 text-sm rounded-md hover:bg-accent transition-colors"
                    onClick={() => router.push(`/cotizaciones?clienteId=${cliente.id}`)}
                  >
                    <Receipt className="h-4 w-4" /> Nueva cotización
                  </button>
                )}
              </PopoverContent>
            </Popover>
            <Button variant="outline" size="sm" onClick={onEdit} className="h-10 flex-1 gap-1.5 sm:h-9 sm:flex-none">
              <Edit className="h-4 w-4" /> Editar
            </Button>
            <Button variant="outline" size="sm" onClick={onWhatsApp} className="h-10 flex-1 gap-1.5 sm:h-9 sm:flex-none">
              <WhatsAppIcon className="h-4 w-4 text-success-600" /> WhatsApp
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3 mt-1 lg:mt-4">
        <Card><CardContent className="p-3 text-center">
          <div className="text-xs text-muted-foreground">Debe</div>
          {resumen.debe === null && deudaError ? (
            <div
              className="text-sm sm:text-base font-medium text-muted-foreground"
              title="No se pudo cargar la deuda. Recargá la página para reintentar."
            >
              No disponible
            </div>
          ) : (
            <div className={`text-base sm:text-lg font-bold tabular-nums ${TONE_CLASS[resumen.debeTone]}`}>
              {resumen.debe === null ? "—" : formatPrice(resumen.debe)}
            </div>
          )}
          {porSucursal && resumen.debe !== null && (
            <div className="text-[11px] text-muted-foreground">en esta sucursal</div>
          )}
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <div className="text-xs text-muted-foreground">A favor</div>
          <div className={`text-base sm:text-lg font-bold tabular-nums ${TONE_CLASS[resumen.aFavorTone]}`}>
            {formatPrice(resumen.aFavor)}
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
