"use client"

import { useState, useEffect } from "react"
import Image from "next/image"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Check, Loader2, Crown, Shield, Zap, Globe } from "lucide-react"
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
  const [pricesArs, setPricesArs] = useState({ MONTHLY: 19999, YEARLY: 191990 })
  const [pricesUsd, setPricesUsd] = useState({ MONTHLY: 14, YEARLY: 134 })

  useEffect(() => {
    if (!open) return
    fetch("/api/subscriptions")
      .then((res) => res.json())
      .then((data) => {
        const premiumPlan = data.plans?.find((p: any) => p.tipo === "PREMIUM")
        if (premiumPlan) {
          setPricesArs({
            MONTHLY: Number(premiumPlan.precio_mensual),
            YEARLY: Number(premiumPlan.precio_anual),
          })
          if (premiumPlan.precio_mensual_usd) {
            setPricesUsd({
              MONTHLY: Number(premiumPlan.precio_mensual_usd),
              YEARLY: Number(premiumPlan.precio_anual_usd),
            })
          }
        }
      })
      .catch(() => {})
  }, [open])

  const formatPriceArs = (price: number) => {
    return price.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  }

  const currentPrices = paymentMethod === "mercadopago" ? pricesArs : pricesUsd
  const currencySymbol = paymentMethod === "mercadopago" ? "$" : "USD $"

  const monthlySavings = Math.round(
    ((currentPrices.MONTHLY * 12 - currentPrices.YEARLY) / (currentPrices.MONTHLY * 12)) * 100
  )

  const formatCurrentPrice = (price: number) => {
    if (paymentMethod === "mercadopago") return formatPriceArs(price)
    return price.toString()
  }

  const openPaymentUrl = async (url: string) => {
    try {
      const { Capacitor } = await import("@capacitor/core")
      if (Capacitor.isNativePlatform()) {
        const { Browser } = await import("@capacitor/browser")
        await Browser.open({ url })
      } else {
        window.location.href = url
      }
    } catch {
      window.location.href = url
    }
  }

  const handleUpgrade = async () => {
    setLoading(true)
    try {
      if (paymentMethod === "mercadopago") {
        const response = await fetch("/api/mercadopago/preference", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ billingPeriod }),
        })

        const data = await response.json()

        if (data.initPoint) {
          await openPaymentUrl(data.initPoint)
        } else {
          throw new Error("No se pudo iniciar el pago")
        }
      } else {
        const response = await fetch("/api/lemonsqueezy/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ billingPeriod }),
        })

        const data = await response.json()

        if (data.url) {
          await openPaymentUrl(data.url)
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
    { icon: Zap, text: "Órdenes ilimitadas" },
    { icon: Zap, text: "Técnicos ilimitados" },
    { icon: Zap, text: "Clientes ilimitados" },
    { icon: Zap, text: "Reportes avanzados" },
    { icon: Zap, text: "5GB almacenamiento" },
    { icon: Zap, text: "Notificaciones WhatsApp" },
    { icon: Zap, text: "Logo personalizado" },
    { icon: Zap, text: "Soporte prioritario" },
  ]

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[540px] p-0 gap-0 overflow-hidden">
        {/* Header con gradiente */}
        <div className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent px-6 pt-6 pb-4">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-primary/10">
                <Crown className="h-5 w-5 text-primary" />
              </div>
              <DialogTitle className="text-xl">Activar Plan Premium</DialogTitle>
            </div>
            <DialogDescription className="text-sm">
              Desbloquea todo el potencial de STApp sin límites
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-6 pb-6 space-y-5">
          {/* Método de pago */}
          <div className="space-y-2.5">
            <label className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Método de pago
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPaymentMethod("mercadopago")}
                className={cn(
                  "relative p-4 rounded-xl border-2 text-center transition-all duration-200",
                  paymentMethod === "mercadopago"
                    ? "border-primary bg-primary/5 shadow-sm shadow-primary/10"
                    : "border-border hover:border-muted-foreground/30 hover:bg-muted/50"
                )}
              >
                {paymentMethod === "mercadopago" && (
                  <div className="absolute top-2 right-2">
                    <div className="h-2 w-2 rounded-full bg-primary" />
                  </div>
                )}
                <Image
                  src="/Mercado_Pago.svg.png"
                  alt="MercadoPago"
                  width={80}
                  height={22}
                  className="mx-auto mb-2"
                />
                <div className="text-sm font-semibold">Argentina</div>
                <div className="text-xs text-muted-foreground">Pesos (ARS)</div>
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod("stripe")}
                className={cn(
                  "relative p-4 rounded-xl border-2 text-center transition-all duration-200",
                  paymentMethod === "stripe"
                    ? "border-primary bg-primary/5 shadow-sm shadow-primary/10"
                    : "border-border hover:border-muted-foreground/30 hover:bg-muted/50"
                )}
              >
                {paymentMethod === "stripe" && (
                  <div className="absolute top-2 right-2">
                    <div className="h-2 w-2 rounded-full bg-primary" />
                  </div>
                )}
                <div className="flex justify-center mb-2">
                  <div className="relative">
                    <Globe className="h-6 w-6 text-blue-500" />
                    <span className="absolute -top-1 -right-2 text-[10px]">🌎</span>
                  </div>
                </div>
                <div className="text-sm font-semibold">Internacional</div>
                <div className="text-xs text-muted-foreground">Dólares (USD)</div>
              </button>
            </div>
          </div>

          {/* Período de facturación */}
          <div className="space-y-2.5">
            <label className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Período de facturación
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setBillingPeriod("MONTHLY")}
                className={cn(
                  "relative p-4 rounded-xl border-2 text-left transition-all duration-200",
                  billingPeriod === "MONTHLY"
                    ? "border-primary bg-primary/5 shadow-sm shadow-primary/10"
                    : "border-border hover:border-muted-foreground/30 hover:bg-muted/50"
                )}
              >
                <div className="text-xs font-medium text-muted-foreground mb-1">Mensual</div>
                <div className="text-2xl font-bold tracking-tight">
                  {currencySymbol}{formatCurrentPrice(currentPrices.MONTHLY)}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">por mes</div>
              </button>
              <button
                type="button"
                onClick={() => setBillingPeriod("YEARLY")}
                className={cn(
                  "relative p-4 rounded-xl border-2 text-left transition-all duration-200",
                  billingPeriod === "YEARLY"
                    ? "border-primary bg-primary/5 shadow-sm shadow-primary/10"
                    : "border-border hover:border-muted-foreground/30 hover:bg-muted/50"
                )}
              >
                <div className="absolute -top-2.5 -right-2 bg-green-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">
                  AHORRA {monthlySavings}%
                </div>
                <div className="text-xs font-medium text-muted-foreground mb-1">Anual</div>
                <div className="text-2xl font-bold tracking-tight">
                  {currencySymbol}{paymentMethod === "mercadopago" ? formatCurrentPrice(Math.round(currentPrices.YEARLY / 12)) : (currentPrices.YEARLY / 12).toFixed(1).replace(/\.0$/, "")}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  por mes <span className="text-muted-foreground/60">({currencySymbol}{formatCurrentPrice(currentPrices.YEARLY)}/año)</span>
                </div>
              </button>
            </div>
          </div>

          {/* Features compactas */}
          <div className="bg-muted/40 rounded-xl p-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {features.map(({ text }) => (
                <div key={text} className="flex items-center gap-2 text-sm">
                  <Check className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                  <span className="text-muted-foreground">{text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Botón de acción */}
          <Button
            className="w-full h-12 text-base font-semibold"
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
                Continuar al pago — {currencySymbol}
                {formatCurrentPrice(billingPeriod === "YEARLY" ? currentPrices.YEARLY : currentPrices.MONTHLY)}
                {billingPeriod === "YEARLY" ? "/año" : "/mes"}
              </>
            )}
          </Button>

          {/* Footer de confianza */}
          <div className="flex items-center justify-center gap-4 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-1">
              <Shield className="h-3 w-3" />
              <span>Pago seguro</span>
            </div>
            <span className="text-muted-foreground/30">|</span>
            <span>Cancela cuando quieras</span>
            <span className="text-muted-foreground/30">|</span>
            <span>Garantía 30 días</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
