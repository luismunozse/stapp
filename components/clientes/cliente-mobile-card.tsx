"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { User, Building2, Phone, Mail, MapPin, Edit, Trash2, PiggyBank, DollarSign, MoreHorizontal, Wrench, Receipt } from "lucide-react"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { Cliente } from "@/types"
import { useCurrency } from "@/contexts/currency-context"
import { getPersonalIdLabel } from "@/lib/countries"
import { telHref } from "@/lib/tel-href"
import { clienteBalanceChip } from "@/lib/clientes-list-state"
import { useHasFeature } from "@/hooks/use-subscription"
import { TipoPrecioBadge } from "./tipo-precio-badge"
import { PracticaBadge } from "@/components/onboarding/practica-badge"

interface ClienteMobileCardProps {
  cliente: Cliente
  onEdit: (e: React.MouseEvent, cliente: Cliente) => void
  onDelete: (e: React.MouseEvent, cliente: Cliente) => void
  onWhatsApp?: (e: React.MouseEvent, cliente: Cliente) => void
  onCuentaCorriente?: (e: React.MouseEvent, cliente: Cliente) => void
  onCobrar?: (e: React.MouseEvent, cliente: Cliente) => void
  deleting: boolean
}

const MENU_ITEM = "flex items-center gap-2 w-full px-3 py-2.5 text-sm rounded-md hover:bg-accent transition-colors"

export function ClienteMobileCard({ cliente, onEdit, onDelete, onWhatsApp, onCuentaCorriente, onCobrar, deleting }: ClienteMobileCardProps) {
  const router = useRouter()
  const { formatDate, formatPrice, pais } = useCurrency()
  const { hasFeature: hasCotizaciones, loading: cotizacionesLoading } = useHasFeature("cotizaciones_online")
  const puedeCotizar = cotizacionesLoading || hasCotizaciones

  const chip = clienteBalanceChip(cliente)
  const tel = cliente.telefono ? telHref(cliente.telefono) : ""
  // Same gating as the menu item: handler only exists when the user can collect.
  const showCobrar = !!onCobrar && !cliente.esPractica && chip?.kind === "debe"
  const showActions = !!tel || !!onWhatsApp || showCobrar

  // The name is a stretched link (its ::after covers the card) so the whole card
  // navigates with real link semantics; interactive children sit above it at z-10.
  return (
    <Card className="relative active:bg-muted/50 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-3 min-w-0">
            <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${
              cliente.tipoCliente === "EMPRESA" ? "bg-warning/10" : "bg-primary/10"
            }`}>
              {cliente.tipoCliente === "EMPRESA" ? (
                <Building2 className="h-4 w-4 text-warning-600" />
              ) : (
                <User className="h-4 w-4 text-primary" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Link
                  href={`/clientes/${cliente.id}`}
                  className="font-medium text-sm after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
                >
                  {cliente.nombre}
                </Link>
                {chip && (
                  <span
                    className={`text-xs font-medium tabular-nums px-1.5 py-0.5 rounded ${
                      chip.kind === "debe" ? "bg-destructive/10 text-destructive" : "bg-info-50 text-info-700"
                    }`}
                  >
                    {chip.label} {formatPrice(chip.amount)}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {cliente.tipoCliente === "EMPRESA" && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-warning/10 text-warning-700">
                    Empresa
                  </span>
                )}
                <TipoPrecioBadge tipoPrecio={cliente.tipoPrecio} />
                {cliente.esPractica && <PracticaBadge />}
                {cliente.dni && (
                  <span className="text-xs text-muted-foreground">{getPersonalIdLabel(pais)}: {cliente.dni}</span>
                )}
              </div>
              {cliente.razonSocial && (
                <div className="text-xs text-muted-foreground">{cliente.razonSocial}</div>
              )}
            </div>
          </div>
          <div role="group" className="relative z-10 flex items-center shrink-0 -mr-2 -mt-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => onEdit(e, cliente)}
              title="Editar"
              aria-label="Editar"
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground"
                  onClick={(e) => e.stopPropagation()}
                  title="Más acciones"
                  aria-label="Más acciones"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-48 p-1">
                <button
                  type="button"
                  className={MENU_ITEM}
                  onClick={(e) => { e.stopPropagation(); router.push(`/ordenes?clienteId=${cliente.id}`) }}
                >
                  <Wrench className="h-4 w-4" />
                  Nueva orden
                </button>
                {puedeCotizar && (
                  <button
                    type="button"
                    className={MENU_ITEM}
                    onClick={(e) => { e.stopPropagation(); router.push(`/cotizaciones?clienteId=${cliente.id}`) }}
                  >
                    <Receipt className="h-4 w-4" />
                    Nueva cotización
                  </button>
                )}
                {onCobrar && !cliente.esPractica && (
                  <button type="button" className={MENU_ITEM} onClick={(e) => onCobrar(e, cliente)}>
                    <DollarSign className="h-4 w-4 text-success-600" />
                    Cobrar órdenes
                  </button>
                )}
                {onCuentaCorriente && !cliente.esPractica && (
                  <button type="button" className={MENU_ITEM} onClick={(e) => onCuentaCorriente(e, cliente)}>
                    <PiggyBank className="h-4 w-4 text-info-600" />
                    Cuenta corriente
                  </button>
                )}
                {!cliente.esPractica && (
                  <>
                    <div className="h-px bg-border my-1" />
                    <button
                      type="button"
                      className="flex items-center gap-2 w-full px-3 py-2.5 text-sm rounded-md hover:bg-destructive/10 text-destructive transition-colors"
                      onClick={(e) => onDelete(e, cliente)}
                      disabled={deleting}
                    >
                      <Trash2 className="h-4 w-4" />
                      Eliminar
                    </button>
                  </>
                )}
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Phone is the primary datum; email and address are de-emphasized */}
        <div className="mt-2 space-y-1 pl-12">
          <div className="text-sm font-medium tabular-nums">{cliente.telefono}</div>
          {cliente.email && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground/80">
              <Mail className="h-3 w-3 shrink-0" />
              <span className="truncate">{cliente.email}</span>
            </div>
          )}
          {cliente.direccion && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground/80">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{cliente.direccion}</span>
            </div>
          )}
          <div className="text-xs text-muted-foreground pt-0.5">
            {cliente.ordenesCount ?? 0} órdenes
            {cliente.ultimaVisita && <> · Última: {formatDate(cliente.ultimaVisita)}</>}
          </div>
        </div>

        {showActions && (
          <div
            role="group"
            aria-label={`Acciones rápidas de ${cliente.nombre}`}
            className="relative z-10 mt-3 pt-3 border-t flex items-center gap-2"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {tel && (
              <Button asChild variant="outline" size="sm" className="h-10 flex-1 gap-1.5">
                <a href={`tel:${tel}`} aria-label={`Llamar a ${cliente.nombre}`}>
                  <Phone className="h-4 w-4" />
                  Llamar
                </a>
              </Button>
            )}
            {onWhatsApp && (
              <Button
                variant="outline"
                size="sm"
                className="h-10 flex-1 gap-1.5"
                onClick={(e) => onWhatsApp(e, cliente)}
                aria-label={`Enviar WhatsApp a ${cliente.nombre}`}
              >
                <WhatsAppIcon className="h-4 w-4 text-success-600" />
                WhatsApp
              </Button>
            )}
            {showCobrar && (
              <Button
                size="sm"
                className="h-10 flex-1 gap-1.5"
                onClick={(e) => onCobrar!(e, cliente)}
                aria-label={`Cobrar a ${cliente.nombre}`}
              >
                <DollarSign className="h-4 w-4" />
                Cobrar
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
