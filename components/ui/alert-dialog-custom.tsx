"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { AlertTriangle, Info, CheckCircle, XCircle } from "lucide-react"

type AlertVariant = "error" | "warning" | "info" | "success"

interface AlertDialogCustomProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  buttonText?: string
  variant?: AlertVariant
}

const variantConfig = {
  error: {
    icon: XCircle,
    iconClass: "text-red-500",
    bgClass: "bg-red-100",
  },
  warning: {
    icon: AlertTriangle,
    iconClass: "text-yellow-500",
    bgClass: "bg-yellow-100",
  },
  info: {
    icon: Info,
    iconClass: "text-blue-500",
    bgClass: "bg-blue-100",
  },
  success: {
    icon: CheckCircle,
    iconClass: "text-green-500",
    bgClass: "bg-green-100",
  },
}

export function AlertDialogCustom({
  open,
  onOpenChange,
  title,
  description,
  buttonText = "Aceptar",
  variant = "info",
}: AlertDialogCustomProps) {
  const config = variantConfig[variant]
  const Icon = config.icon

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-full ${config.bgClass}`}>
              <Icon className={`h-6 w-6 ${config.iconClass}`} />
            </div>
            <div>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription className="mt-1">{description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{buttonText}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
