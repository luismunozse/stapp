"use client"

import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Sparkles, Clock, Check, Gift } from "lucide-react"

const STORAGE_KEY = "stapp_policy_change_seen_v1"

interface PolicyChangeModalProps {
  daysRemaining: number
}

export function PolicyChangeModal({ daysRemaining }: PolicyChangeModalProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    // Verificar si ya vio el modal
    const hasSeen = localStorage.getItem(STORAGE_KEY)
    if (!hasSeen) {
      // Pequeño delay para mejor UX
      const timer = setTimeout(() => setOpen(true), 500)
      return () => clearTimeout(timer)
    }
  }, [])

  const handleClose = () => {
    localStorage.setItem(STORAGE_KEY, "true")
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-center sm:text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-500">
            <Gift className="h-8 w-8 text-white" />
          </div>
          <DialogTitle className="text-xl">
            Cambios en nuestras políticas
          </DialogTitle>
          <DialogDescription className="text-base">
            Queremos que conozcas todas las funcionalidades de STApp
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            Hemos actualizado nuestro modelo de servicio. A partir de ahora, todas las
            cuentas incluyen un <strong>período de prueba gratuito de 30 días</strong> con
            acceso completo a todas las funcionalidades Premium.
          </p>

          <div className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950/30 dark:to-purple-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2 font-medium">
              <Sparkles className="h-5 w-5 text-blue-600" />
              Durante tu prueba gratuita tienes:
            </div>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-green-500" />
                Órdenes, técnicos y clientes ilimitados
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-green-500" />
                Reportes avanzados y exportación de datos
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-green-500" />
                Logo personalizado y 5GB de almacenamiento
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-green-500" />
                Soporte prioritario
              </li>
            </ul>
          </div>

          <div className="flex items-center gap-2 text-sm bg-muted p-3 rounded-lg">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span>
              Te quedan <strong className="text-primary">{daysRemaining} días</strong> de
              prueba gratuita. Después podrás suscribirte para continuar.
            </span>
          </div>
        </div>

        <DialogFooter className="sm:justify-center gap-2">
          <Button onClick={handleClose} className="w-full sm:w-auto">
            Entendido, ¡gracias!
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
