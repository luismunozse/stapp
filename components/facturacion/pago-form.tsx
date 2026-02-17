"use client"

import { useState, useMemo } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { X, DollarSign, CreditCard, Banknote, ArrowRightLeft, Wallet, CircleDollarSign, MoreHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"
import { useCurrency } from "@/contexts/currency-context"

const METODOS_PAGO = [
  { value: "EFECTIVO", label: "Efectivo", icon: Banknote },
  { value: "TRANSFERENCIA", label: "Transferencia", icon: ArrowRightLeft },
  { value: "TARJETA_DEBITO", label: "Tarjeta Débito", icon: CreditCard },
  { value: "TARJETA_CREDITO", label: "Tarjeta Crédito", icon: CreditCard },
  { value: "MERCADOPAGO", label: "MercadoPago", icon: Wallet },
  { value: "OTRO", label: "Otro", icon: MoreHorizontal },
] as const

type MetodoPago = typeof METODOS_PAGO[number]["value"]

const pagoSchema = z.object({
  monto: z.number().positive("El monto debe ser mayor a 0"),
  metodoPago: z.enum(["EFECTIVO", "TRANSFERENCIA", "TARJETA_DEBITO", "TARJETA_CREDITO", "MERCADOPAGO", "OTRO"]),
  numeroReferencia: z.string().optional(),
  observaciones: z.string().optional(),
  cuotas: z.number().int().min(1).nullable().optional(),
  recargoPorcentaje: z.number().min(0).max(100).nullable().optional(),
})

type PagoFormData = z.infer<typeof pagoSchema>

interface PagoFormProps {
  facturaId: string
  total: number
  montoAbonado: number
  onClose: () => void
  onSuccess: () => void
}

export function PagoForm({
  facturaId,
  total,
  montoAbonado,
  onClose,
  onSuccess,
}: PagoFormProps) {
  const [loading, setLoading] = useState(false)
  const { formatPrice } = useCurrency()
  const pendiente = total - montoAbonado

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
    setValue,
  } = useForm<PagoFormData>({
    resolver: zodResolver(pagoSchema),
    defaultValues: {
      monto: pendiente,
      metodoPago: "EFECTIVO",
      numeroReferencia: "",
      observaciones: "",
      cuotas: null,
      recargoPorcentaje: null,
    },
  })

  const metodoPago = watch("metodoPago")
  const cuotas = watch("cuotas")
  const recargoPorcentaje = watch("recargoPorcentaje")
  const monto = watch("monto")

  const showReferencia = metodoPago === "TRANSFERENCIA" || metodoPago === "MERCADOPAGO"
  const showCuotas = metodoPago === "TARJETA_CREDITO"
  const showRecargo = metodoPago === "TARJETA_CREDITO" || metodoPago === "TARJETA_DEBITO"

  // Cálculo de recargo en tiempo real
  const recargoInfo = useMemo(() => {
    if (!showRecargo || !recargoPorcentaje || recargoPorcentaje <= 0) return null

    const montoOriginal = monto / (1 + recargoPorcentaje / 100)
    const montoRecargo = monto - montoOriginal
    const montoCuota = cuotas && cuotas > 1 ? monto / cuotas : null

    return { montoOriginal, montoRecargo, montoCuota }
  }, [monto, recargoPorcentaje, cuotas, showRecargo])

  const handleMetodoChange = (value: MetodoPago) => {
    setValue("metodoPago", value)
    // Limpiar campos condicionales
    if (value !== "TARJETA_CREDITO" && value !== "TARJETA_DEBITO") {
      setValue("cuotas", null)
      setValue("recargoPorcentaje", null)
    }
    if (value !== "TRANSFERENCIA" && value !== "MERCADOPAGO") {
      setValue("numeroReferencia", "")
    }
    if (value === "TARJETA_CREDITO") {
      setValue("cuotas", 1)
    }
  }

  const onSubmit = async (data: PagoFormData) => {
    setLoading(true)
    try {
      const payload: Record<string, any> = {
        facturaId,
        monto: data.monto,
        metodoPago: data.metodoPago,
        numeroReferencia: data.numeroReferencia || undefined,
        observaciones: data.observaciones || undefined,
      }

      // Agregar datos de cuotas/recargo si aplica
      if (showCuotas && data.cuotas && data.cuotas > 0) {
        payload.cuotas = data.cuotas
      }
      if (showRecargo && data.recargoPorcentaje && data.recargoPorcentaje > 0) {
        payload.recargoPorcentaje = data.recargoPorcentaje
        payload.montoOriginal = recargoInfo?.montoOriginal ?? null
      }

      const res = await fetch("/api/pagos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const error = await res.json()
        alert(error.error || "Error al registrar pago")
        return
      }

      onSuccess()
    } catch (error) {
      console.error("Error:", error)
      alert("Error al registrar pago")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="mb-4">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <DollarSign className="h-5 w-5" />
            Registrar Pago
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Resumen financiero */}
        <div className="mb-5 p-3 bg-muted rounded-lg">
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <span className="text-muted-foreground">Total</span>
              <div className="font-semibold">{formatPrice(total)}</div>
            </div>
            <div>
              <span className="text-muted-foreground">Abonado</span>
              <div className="font-semibold text-green-600">
                {formatPrice(montoAbonado)}
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">Pendiente</span>
              <div className="font-semibold text-red-600">
                {formatPrice(pendiente)}
              </div>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Método de pago - botones visuales */}
          <div>
            <Label className="mb-2 block">Método de pago</Label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {METODOS_PAGO.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => handleMetodoChange(value)}
                  className={cn(
                    "flex flex-col items-center gap-1 p-2.5 rounded-lg border-2 text-center transition-all text-xs",
                    metodoPago === value
                      ? "border-primary bg-primary/5 text-primary font-medium"
                      : "border-border hover:border-muted-foreground/30 text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="leading-tight">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Monto */}
          <div>
            <Label htmlFor="monto">
              {showRecargo && recargoPorcentaje ? "Monto total (con recargo)" : "Monto a pagar"} *
            </Label>
            <Input
              id="monto"
              type="number"
              step="0.01"
              max={pendiente}
              {...register("monto", { valueAsNumber: true })}
            />
            {errors.monto && (
              <p className="text-sm text-destructive mt-1">
                {errors.monto.message}
              </p>
            )}
          </div>

          {/* Cuotas - solo para tarjeta de crédito */}
          {showCuotas && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="cuotas">Cuotas</Label>
                <Input
                  id="cuotas"
                  type="number"
                  min={1}
                  max={48}
                  placeholder="1"
                  {...register("cuotas", { valueAsNumber: true })}
                />
              </div>
              <div>
                <Label htmlFor="recargoPorcentaje">Recargo %</Label>
                <Input
                  id="recargoPorcentaje"
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  placeholder="0"
                  {...register("recargoPorcentaje", { valueAsNumber: true })}
                />
              </div>
            </div>
          )}

          {/* Recargo solo débito (sin cuotas) */}
          {metodoPago === "TARJETA_DEBITO" && (
            <div>
              <Label htmlFor="recargoPorcentaje">Recargo % (si aplica)</Label>
              <Input
                id="recargoPorcentaje"
                type="number"
                step="0.01"
                min={0}
                max={100}
                placeholder="0"
                {...register("recargoPorcentaje", { valueAsNumber: true })}
              />
            </div>
          )}

          {/* Preview de recargo */}
          {recargoInfo && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Monto sin recargo:</span>
                <span className="font-medium">{formatPrice(recargoInfo.montoOriginal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Recargo ({recargoPorcentaje}%):</span>
                <span className="font-medium text-amber-600">+{formatPrice(recargoInfo.montoRecargo)}</span>
              </div>
              <div className="flex justify-between border-t border-amber-200 dark:border-amber-800 pt-1">
                <span className="font-medium">Total cobrado:</span>
                <span className="font-bold">{formatPrice(monto)}</span>
              </div>
              {recargoInfo.montoCuota && cuotas && cuotas > 1 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>{cuotas} cuotas de:</span>
                  <span>{formatPrice(recargoInfo.montoCuota)}</span>
                </div>
              )}
            </div>
          )}

          {/* Referencia - para transferencia y mercadopago */}
          {showReferencia && (
            <div>
              <Label htmlFor="numeroReferencia">Número de referencia</Label>
              <Input
                id="numeroReferencia"
                {...register("numeroReferencia")}
                placeholder={
                  metodoPago === "TRANSFERENCIA"
                    ? "CBU, alias o nro. de operación"
                    : "Nro. de operación MercadoPago"
                }
              />
            </div>
          )}

          {/* Observaciones */}
          <div>
            <Label htmlFor="observaciones">Observaciones</Label>
            <Textarea
              id="observaciones"
              {...register("observaciones")}
              placeholder="Notas adicionales..."
              rows={2}
            />
          </div>

          {/* Acciones */}
          <div className="flex gap-2 justify-end pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Registrando..." : `Registrar Pago`}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
