"use client"

import { useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { User, Building2, Phone, Mail, MapPin, Edit, Trash2, PiggyBank, DollarSign, MoreHorizontal } from "lucide-react"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { Cliente } from "@/types"
import { useCurrency } from "@/contexts/currency-context"

interface ClienteMobileCardProps {
  cliente: Cliente
  onEdit: (e: React.MouseEvent, cliente: Cliente) => void
  onDelete: (e: React.MouseEvent, cliente: Cliente) => void
  onWhatsApp?: (e: React.MouseEvent, cliente: Cliente) => void
  onCuentaCorriente?: (e: React.MouseEvent, cliente: Cliente) => void
  onCobrar?: (e: React.MouseEvent, cliente: Cliente) => void
  deleting: boolean
}

export function ClienteMobileCard({ cliente, onEdit, onDelete, onWhatsApp, onCuentaCorriente, onCobrar, deleting }: ClienteMobileCardProps) {
  const router = useRouter()
  const { formatDate, formatPrice } = useCurrency()

  return (
    <Card>
      <CardContent className="p-4">
        {/* Header: Avatar + Nombre + Actions */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${
              cliente.tipoCliente === "EMPRESA" ? "bg-warning/10" : "bg-primary/10"
            }`}>
              {cliente.tipoCliente === "EMPRESA" ? (
                <Building2 className="h-4 w-4 text-warning-600" />
              ) : (
                <User className="h-4 w-4 text-primary" />
              )}
            </div>
            <div>
              <div className="font-medium text-sm">{cliente.nombre}</div>
              <div className="flex items-center gap-2">
                {cliente.tipoCliente === "EMPRESA" && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-warning/10 text-warning-700">
                    Empresa
                  </span>
                )}
                {cliente.dni && (
                  <span className="text-xs text-muted-foreground">DNI: {cliente.dni}</span>
                )}
              </div>
              {cliente.razonSocial && (
                <div className="text-xs text-muted-foreground">{cliente.razonSocial}</div>
              )}
            </div>
          </div>
          <div role="group" className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon"
              className="no-touch-min h-8 w-8"
              onClick={(e) => onEdit(e, cliente)}
              title="Editar"
            >
              <Edit className="h-3.5 w-3.5" />
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="no-touch-min h-8 w-8 text-muted-foreground"
                  onClick={(e) => e.stopPropagation()}
                  title="Más acciones"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-48 p-1">
                {onWhatsApp && (
                  <button
                    type="button"
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors"
                    onClick={(e) => onWhatsApp(e, cliente)}
                  >
                    <WhatsAppIcon className="h-4 w-4 text-success-600" />
                    Enviar WhatsApp
                  </button>
                )}
                {onCobrar && (
                  <button
                    type="button"
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors"
                    onClick={(e) => onCobrar(e, cliente)}
                  >
                    <DollarSign className="h-4 w-4 text-success-600" />
                    Cobrar órdenes
                  </button>
                )}
                {onCuentaCorriente && (
                  <button
                    type="button"
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors"
                    onClick={(e) => onCuentaCorriente(e, cliente)}
                  >
                    <PiggyBank className="h-4 w-4 text-info-600" />
                    Cuenta corriente
                  </button>
                )}
                <div className="h-px bg-border my-1" />
                <button
                  type="button"
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-md hover:bg-destructive/10 text-destructive transition-colors"
                  onClick={(e) => onDelete(e, cliente)}
                  disabled={deleting}
                >
                  <Trash2 className="h-4 w-4" />
                  Eliminar
                </button>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Info */}
        <div
          className="space-y-1.5 text-sm cursor-pointer"
          onClick={() => router.push(`/clientes/${cliente.id}`)}
        >
          <div className="flex items-center gap-2 text-muted-foreground">
            <Phone className="h-3.5 w-3.5 shrink-0" />
            <span>{cliente.telefono}</span>
          </div>

          {cliente.email && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Mail className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{cliente.email}</span>
            </div>
          )}

          {cliente.direccion && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{cliente.direccion}</span>
            </div>
          )}

          <div className="text-xs text-muted-foreground pt-1">
            Registrado: {formatDate(cliente.createdAt)}
          </div>

          {(cliente.deudaPendiente ?? 0) > 0 && (
            <div className="flex items-center gap-2 text-destructive font-medium">
              <PiggyBank className="h-3.5 w-3.5 shrink-0" />
              <span>Debe: {formatPrice(cliente.deudaPendiente || 0)}</span>
            </div>
          )}
          <div className="flex items-center gap-3 text-xs text-muted-foreground pt-0.5">
            <span>{cliente.ordenesCount ?? 0} órdenes</span>
            {cliente.ultimaVisita && <span>· Última: {formatDate(cliente.ultimaVisita)}</span>}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
