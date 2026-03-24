"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { User, Building2, Phone, Mail, MapPin, Edit, Trash2, MessageCircle } from "lucide-react"
import type { Cliente } from "@/types"
import { useCurrency } from "@/contexts/currency-context"

interface ClienteMobileCardProps {
  cliente: Cliente
  onEdit: (e: React.MouseEvent, cliente: Cliente) => void
  onDelete: (e: React.MouseEvent, cliente: Cliente) => void
  onWhatsApp?: (e: React.MouseEvent, cliente: Cliente) => void
  deleting: boolean
}

export function ClienteMobileCard({ cliente, onEdit, onDelete, onWhatsApp, deleting }: ClienteMobileCardProps) {
  const { formatDate } = useCurrency()

  return (
    <Card>
      <CardContent className="p-4">
        {/* Header: Avatar + Nombre + Actions */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${
              cliente.tipoCliente === "EMPRESA" ? "bg-amber-500/10" : "bg-primary/10"
            }`}>
              {cliente.tipoCliente === "EMPRESA" ? (
                <Building2 className="h-4 w-4 text-amber-600" />
              ) : (
                <User className="h-4 w-4 text-primary" />
              )}
            </div>
            <div>
              <div className="font-medium text-sm">{cliente.nombre}</div>
              <div className="flex items-center gap-2">
                {cliente.tipoCliente === "EMPRESA" && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700">
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
          <div role="group" className="flex items-center gap-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            {onWhatsApp && (
              <Button
                variant="ghost"
                size="icon"
                className="no-touch-min h-8 w-8 text-muted-foreground hover:text-green-600"
                onClick={(e) => onWhatsApp(e, cliente)}
              >
                <MessageCircle className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="no-touch-min h-8 w-8"
              onClick={(e) => onEdit(e, cliente)}
            >
              <Edit className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="no-touch-min h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={(e) => onDelete(e, cliente)}
              disabled={deleting}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Info */}
        <div className="space-y-1.5 text-sm">
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
        </div>
      </CardContent>
    </Card>
  )
}
