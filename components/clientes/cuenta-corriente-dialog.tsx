"use client"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { PiggyBank } from "lucide-react"
import { CuentaCorrientePanel } from "@/components/clientes/detalle/cuenta-corriente-panel"
import type { Cliente } from "@/types"

interface CuentaCorrienteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  cliente: Cliente
  onDeposito?: () => void
}

export function CuentaCorrienteDialog({
  open,
  onOpenChange,
  cliente,
  onDeposito,
}: CuentaCorrienteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PiggyBank className="h-5 w-5" />
            Cuenta Corriente - {cliente.nombre}
          </DialogTitle>
        </DialogHeader>
        {open && <CuentaCorrientePanel cliente={cliente} onDeposito={onDeposito} />}
      </DialogContent>
    </Dialog>
  )
}
