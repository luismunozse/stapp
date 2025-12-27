"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { X, DollarSign } from "lucide-react"
import { formatCurrency } from "@/lib/utils"

const pagoSchema = z.object({
  monto: z.number().positive("El monto debe ser mayor a 0"),
  metodoPago: z.enum(["EFECTIVO", "TRANSFERENCIA"]),
  numeroReferencia: z.string().optional(),
  observaciones: z.string().optional(),
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
    },
  })

  const metodoPago = watch("metodoPago")

  const onSubmit = async (data: PagoFormData) => {
    setLoading(true)
    try {
      const res = await fetch("/api/pagos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facturaId,
          ...data,
        }),
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
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Registrar Pago
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4 p-3 bg-muted rounded-lg">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
            <div>
              <span className="text-muted-foreground">Total:</span>
              <div className="font-medium">{formatCurrency(total)}</div>
            </div>
            <div>
              <span className="text-muted-foreground">Abonado:</span>
              <div className="font-medium text-green-600">
                {formatCurrency(montoAbonado)}
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">Pendiente:</span>
              <div className="font-medium text-red-600">
                {formatCurrency(pendiente)}
              </div>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="monto">Monto a pagar *</Label>
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
            <div>
              <Label htmlFor="metodoPago">Método de pago *</Label>
              <Select
                id="metodoPago"
                {...register("metodoPago")}
                onChange={(e) =>
                  setValue("metodoPago", e.target.value as "EFECTIVO" | "TRANSFERENCIA")
                }
              >
                <option value="EFECTIVO">Efectivo</option>
                <option value="TRANSFERENCIA">Transferencia</option>
              </Select>
            </div>
          </div>

          {metodoPago === "TRANSFERENCIA" && (
            <div>
              <Label htmlFor="numeroReferencia">Número de referencia</Label>
              <Input
                id="numeroReferencia"
                {...register("numeroReferencia")}
                placeholder="Ej: CBU, alias o número de operación"
              />
            </div>
          )}

          <div>
            <Label htmlFor="observaciones">Observaciones</Label>
            <Textarea
              id="observaciones"
              {...register("observaciones")}
              placeholder="Notas adicionales..."
              rows={2}
            />
          </div>

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Registrando..." : "Registrar Pago"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
