"use client"

import { useState } from "react"
import Image from "next/image"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Check, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface UpgradeModalProps {
  open: boolean
  onClose: () => void
}

export function UpgradeModal({ open, onClose }: UpgradeModalProps) {
  const [billingPeriod, setBillingPeriod] = useState<"MONTHLY" | "YEARLY">("MONTHLY")
  const [loading, setLoading] = useState(false)

  const prices = {
    MONTHLY: 14999,
    YEARLY: 143990,
  }

  // Formatear precio en pesos argentinos
  const formatPrice = (price: number) => {
    return price.toLocaleString("es-AR")
  }

  const monthlySavings = Math.round(
    ((prices.MONTHLY * 12 - prices.YEARLY) / (prices.MONTHLY * 12)) * 100
  )

  const handleUpgrade = async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/mercadopago/preference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billingPeriod }),
      })

      const data = await response.json()

      if (data.initPoint) {
        window.location.href = data.initPoint
      } else {
        throw new Error("No se pudo iniciar el pago")
      }
    } catch (error) {
      console.error("Error starting checkout:", error)
      alert("Error al iniciar el proceso de pago. Intenta de nuevo.")
    } finally {
      setLoading(false)
    }
  }

  const features = [
    "Órdenes ilimitadas",
    "Técnicos ilimitados",
    "Clientes ilimitados",
    "Reportes avanzados",
    "5GB almacenamiento",
    "Notificaciones WhatsApp",
    "Logo personalizado",
    "Soporte prioritario",
  ]

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Actualizar a Premium</DialogTitle>
          <DialogDescription>
            Desbloquea todas las funcionalidades sin límites
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Billing period selection */}
          <div className="space-y-3">
            <label className="text-sm font-medium">Período de facturación</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setBillingPeriod("MONTHLY")}
                className={cn(
                  "p-4 rounded-lg border-2 text-left transition-colors",
                  billingPeriod === "MONTHLY"
                    ? "border-primary bg-primary/5"
                    : "border-gray-200 hover:border-gray-300"
                )}
              >
                <div className="font-semibold">Mensual</div>
                <div className="text-2xl font-bold">${formatPrice(prices.MONTHLY)}</div>
                <div className="text-sm text-muted-foreground">por mes</div>
              </button>
              <button
                type="button"
                onClick={() => setBillingPeriod("YEARLY")}
                className={cn(
                  "p-4 rounded-lg border-2 text-left transition-colors relative",
                  billingPeriod === "YEARLY"
                    ? "border-primary bg-primary/5"
                    : "border-gray-200 hover:border-gray-300"
                )}
              >
                <div className="absolute -top-2 -right-2 bg-green-500 text-white text-xs px-2 py-0.5 rounded-full">
                  -{monthlySavings}%
                </div>
                <div className="font-semibold">Anual</div>
                <div className="text-2xl font-bold">
                  ${formatPrice(Math.round(prices.YEARLY / 12))}
                </div>
                <div className="text-sm text-muted-foreground">
                  por mes (${formatPrice(prices.YEARLY)}/año)
                </div>
              </button>
            </div>
          </div>

          {/* Payment method info - MercadoPago */}
          <div className="space-y-3">
            <label className="text-sm font-medium">Método de pago</label>
            <div className="p-4 rounded-lg border-2 border-primary bg-primary/5 text-center">
              <Image
                src="/Mercado_Pago.svg.png"
                alt="MercadoPago"
                width={120}
                height={32}
                className="mx-auto mb-2"
              />
              <div className="text-xs text-muted-foreground">
                Tarjeta de crédito, débito, efectivo y más opciones de pago
              </div>
            </div>
          </div>

          {/* Features list */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Incluye:</label>
            <div className="grid grid-cols-2 gap-2">
              {features.map((feature) => (
                <div key={feature} className="flex items-center gap-2 text-sm">
                  <Check className="h-4 w-4 text-green-500" />
                  {feature}
                </div>
              ))}
            </div>
          </div>

          {/* Action button */}
          <Button
            className="w-full"
            size="lg"
            onClick={handleUpgrade}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Procesando...
              </>
            ) : (
              <>
                Continuar al pago - $
                {formatPrice(billingPeriod === "YEARLY" ? prices.YEARLY : prices.MONTHLY)}
                {billingPeriod === "YEARLY" ? "/año" : "/mes"}
              </>
            )}
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            Garantía de devolución de 30 días. Cancela cuando quieras.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
