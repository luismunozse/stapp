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
import { Check, Loader2, CreditCard, Globe } from "lucide-react"
import { cn } from "@/lib/utils"

type PaymentMethod = "mercadopago" | "stripe"

interface UpgradeModalProps {
  open: boolean
  onClose: () => void
}

export function UpgradeModal({ open, onClose }: UpgradeModalProps) {
  const [billingPeriod, setBillingPeriod] = useState<"MONTHLY" | "YEARLY">("MONTHLY")
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("mercadopago")
  const [loading, setLoading] = useState(false)

  const pricesArs = {
    MONTHLY: 19999,
    YEARLY: 191990,
  }

  const pricesUsd = {
    MONTHLY: 12,
    YEARLY: 115,
  }

  const formatPriceArs = (price: number) => {
    return price.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  }

  const currentPrices = paymentMethod === "mercadopago" ? pricesArs : pricesUsd
  const currencySymbol = paymentMethod === "mercadopago" ? "$" : "USD $"
  const currencyLabel = paymentMethod === "mercadopago" ? "ARS" : "USD"

  const monthlySavings = Math.round(
    ((currentPrices.MONTHLY * 12 - currentPrices.YEARLY) / (currentPrices.MONTHLY * 12)) * 100
  )

  const formatCurrentPrice = (price: number) => {
    if (paymentMethod === "mercadopago") return formatPriceArs(price)
    return price.toString()
  }

  const handleUpgrade = async () => {
    setLoading(true)
    try {
      if (paymentMethod === "mercadopago") {
        // MercadoPago flow (Argentina - ARS)
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
      } else {
        // LemonSqueezy flow (International - USD)
        const response = await fetch("/api/lemonsqueezy/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ billingPeriod }),
        })

        const data = await response.json()

        if (data.url) {
          window.location.href = data.url
        } else {
          throw new Error("No se pudo iniciar el pago")
        }
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
          {/* Payment method selection */}
          <div className="space-y-3">
            <label className="text-sm font-medium">Tu ubicación</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPaymentMethod("mercadopago")}
                className={cn(
                  "p-3 rounded-lg border-2 text-center transition-colors",
                  paymentMethod === "mercadopago"
                    ? "border-primary bg-primary/5"
                    : "border-muted hover:border-muted-foreground/30"
                )}
              >
                <div className="text-lg mb-1">🇦🇷</div>
                <div className="text-sm font-semibold">Argentina</div>
                <div className="text-xs text-muted-foreground">Pesos (ARS)</div>
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod("stripe")}
                className={cn(
                  "p-3 rounded-lg border-2 text-center transition-colors",
                  paymentMethod === "stripe"
                    ? "border-primary bg-primary/5"
                    : "border-muted hover:border-muted-foreground/30"
                )}
              >
                <div className="text-lg mb-1">🌎</div>
                <div className="text-sm font-semibold">Otros países</div>
                <div className="text-xs text-muted-foreground">Dólares (USD)</div>
              </button>
            </div>
          </div>

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
                    : "border-muted hover:border-muted-foreground/30"
                )}
              >
                <div className="font-semibold">Mensual</div>
                <div className="text-2xl font-bold">
                  {currencySymbol}{formatCurrentPrice(currentPrices.MONTHLY)}
                </div>
                <div className="text-sm text-muted-foreground">por mes</div>
              </button>
              <button
                type="button"
                onClick={() => setBillingPeriod("YEARLY")}
                className={cn(
                  "p-4 rounded-lg border-2 text-left transition-colors relative",
                  billingPeriod === "YEARLY"
                    ? "border-primary bg-primary/5"
                    : "border-muted hover:border-muted-foreground/30"
                )}
              >
                <div className="absolute -top-2 -right-2 bg-green-500 text-white text-xs px-2 py-0.5 rounded-full">
                  -{monthlySavings}%
                </div>
                <div className="font-semibold">Anual</div>
                <div className="text-2xl font-bold">
                  {currencySymbol}{formatCurrentPrice(Math.round(currentPrices.YEARLY / 12))}
                </div>
                <div className="text-sm text-muted-foreground">
                  por mes ({currencySymbol}{formatCurrentPrice(currentPrices.YEARLY)}/año)
                </div>
              </button>
            </div>
          </div>

          {/* Payment provider info */}
          <div className="p-3 rounded-lg border bg-muted/30 text-center">
            {paymentMethod === "mercadopago" ? (
              <>
                <Image
                  src="/Mercado_Pago.svg.png"
                  alt="MercadoPago"
                  width={100}
                  height={28}
                  className="mx-auto mb-1"
                />
                <div className="text-xs text-muted-foreground">
                  Tarjeta de crédito, débito, efectivo y más
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center gap-2">
                <CreditCard className="h-5 w-5 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">Pago Internacional</div>
                  <div className="text-xs text-muted-foreground">
                    Tarjeta de crédito y débito internacional
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Features list */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Incluye:</label>
            <div className="grid grid-cols-2 gap-2">
              {features.map((feature) => (
                <div key={feature} className="flex items-center gap-2 text-sm">
                  <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
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
                Continuar al pago - {currencySymbol}
                {formatCurrentPrice(billingPeriod === "YEARLY" ? currentPrices.YEARLY : currentPrices.MONTHLY)}
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
