"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { User, Phone, Mail, MapPin, Edit, Trash2 } from "lucide-react"
import type { Cliente } from "@/types"
import { useCurrency } from "@/contexts/currency-context"

interface ClienteMobileCardProps {
  cliente: Cliente
  onEdit: (e: React.MouseEvent, cliente: Cliente) => void
  onDelete: (e: React.MouseEvent, cliente: Cliente) => void
  deleting: boolean
}

export function ClienteMobileCard({ cliente, onEdit, onDelete, deleting }: ClienteMobileCardProps) {
  const { formatDate } = useCurrency()

  return (
    <Card>
      <CardContent className="p-4">
        {/* Header: Avatar + Nombre + Actions */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <User className="h-4 w-4 text-primary" />
            </div>
            <div>
              <div className="font-medium text-sm">{cliente.nombre}</div>
              {cliente.dni && (
                <div className="text-xs text-muted-foreground">DNI: {cliente.dni}</div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
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
