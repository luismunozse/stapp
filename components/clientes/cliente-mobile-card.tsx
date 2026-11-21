"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { User, Building2, Phone, Edit, Trash2, PiggyBank, DollarSign, MoreVertical, Wrench, Receipt } from "lucide-react"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { Cliente } from "@/types"
import { useCurrency } from "@/contexts/currency-context"
import { telHref } from "@/lib/tel-href"
import { clienteBalanceChip } from "@/lib/clientes-list-state"
import { useHasFeature } from "@/hooks/use-subscription"
import { TipoPrecioBadge } from "./tipo-precio-badge"
import { PracticaBadge } from "@/components/onboarding/practica-badge"

interface ClienteMobileCardProps {
  cliente: Cliente
  onEdit: (e: React.MouseEvent, cliente: Cliente) => void
  /** Sin onDelete no se muestra la opción Eliminar (solo ADMIN puede borrar). */
  onDelete?: (e: React.MouseEvent, cliente: Cliente) => void
  onWhatsApp?: (e: React.MouseEvent, cliente: Cliente) => void
  onCuentaCorriente?: (e: React.MouseEvent, cliente: Cliente) => void
  onCobrar?: (e: React.MouseEvent, cliente: Cliente) => void
  deleting: boolean
}

const MENU_ITEM = "flex items-center gap-2 w-full px-3 py-2.5 text-sm rounded-md hover:bg-accent transition-colors"

export function ClienteMobileCard({ cliente, onEdit, onDelete, onWhatsApp, onCuentaCorriente, onCobrar, deleting }: ClienteMobileCardProps) {
  const router = useRouter()
  const { formatPrice } = useCurrency()
  const { hasFeature: hasCotizaciones, loading: cotizacionesLoading } = useHasFeature("cotizaciones_online")
  const puedeCotizar = cotizacionesLoading || hasCotizaciones

  const chip = clienteBalanceChip(cliente)
  const tel = cliente.telefono ? telHref(cliente.telefono) : ""
  // Same gating as the menu item: handler only exists when the user can collect.
  const showCobrar = !!onCobrar && !cliente.esPractica && chip?.kind === "debe"

  // Initials avatar, like a phone's contact list
  const iniciales = cliente.nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("")

  // The name is a stretched link (its ::after covers the card) so the whole row
  // navigates with real link semantics; interactive children sit above it at z-10.
  // Contact-list row: avatar · name / phone · trailing quick actions. Edit and
  // the rest live in the ⋯ menu; the "Debe" chip itself collects.
  return (
    <Card className="relative active:bg-muted/50 transition-colors">
      <CardContent className="flex items-center gap-3 p-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
            cliente.tipoCliente === "EMPRESA" ? "bg-warning/10 text-warning-700" : "bg-primary/10 text-primary"
          }`}
          aria-hidden
        >
          {cliente.tipoCliente === "EMPRESA" ? (
            <Building2 className="h-5 w-5 text-warning-600" />
          ) : iniciales ? (
            iniciales
          ) : (
            <User className="h-5 w-5" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <Link
              href={`/clientes/${cliente.id}`}
              className="truncate font-medium text-sm after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
            >
              {cliente.nombre}
            </Link>
            {cliente.esPractica && <PracticaBadge />}
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
            {cliente.telefono && <span className="tabular-nums text-foreground/80">{cliente.telefono}</span>}
            {cliente.telefono && <span aria-hidden>·</span>}
            <span>{cliente.ordenesCount ?? 0} órdenes</span>
            <TipoPrecioBadge tipoPrecio={cliente.tipoPrecio} />
            {chip &&
              (showCobrar ? (
                <button
                  type="button"
                  onClick={(e) => onCobrar!(e, cliente)}
                  aria-label={`Cobrar a ${cliente.nombre}`}
                  className="relative z-10 rounded bg-destructive/10 px-1.5 py-0.5 font-medium tabular-nums text-destructive-text active:bg-destructive/20"
                >
                  {chip.label} {formatPrice(chip.amount)}
                </button>
              ) : (
                <span
                  className={`rounded px-1.5 py-0.5 font-medium tabular-nums ${
                    chip.kind === "debe" ? "bg-destructive/10 text-destructive-text" : "bg-info-50 text-info-700"
                  }`}
                >
                  {chip.label} {formatPrice(chip.amount)}
                </span>
              ))}
          </div>
        </div>

        <div
          role="group"
          aria-label={`Acciones rápidas de ${cliente.nombre}`}
          className="relative z-10 -mr-1.5 flex shrink-0 items-center"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {tel && (
            <Button asChild variant="ghost" size="icon" className="text-primary">
              <a href={`tel:${tel}`} aria-label={`Llamar a ${cliente.nombre}`}>
                <Phone className="h-[18px] w-[18px]" />
              </a>
            </Button>
          )}
          {onWhatsApp && (
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => onWhatsApp(e, cliente)}
              aria-label={`Enviar WhatsApp a ${cliente.nombre}`}
            >
              <WhatsAppIcon className="h-[18px] w-[18px] text-success-600" />
            </Button>
          )}
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
                <MoreVertical className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-48 p-1">
              <button type="button" className={MENU_ITEM} onClick={(e) => onEdit(e, cliente)}>
                <Edit className="h-4 w-4" />
                Editar
              </button>
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
                  Nuevo presupuesto
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
              {onDelete && !cliente.esPractica && (
                <>
                  <div className="h-px bg-border my-1" />
                  <button
                    type="button"
                    className="flex items-center gap-2 w-full px-3 py-2.5 text-sm rounded-md hover:bg-destructive/10 text-destructive-text transition-colors"
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
      </CardContent>
    </Card>
  )
}
