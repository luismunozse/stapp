"use client"

import { useState, useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DatePicker } from "@/components/ui/date-picker"
import { X } from "lucide-react"
import type { Cliente, TipoDispositivo } from "@/types"

const ordenSchema = z.object({
  clienteId: z.string().min(1, "El cliente es requerido"),
  dispositivo: z.string().min(1, "El dispositivo es requerido"),
  tipoDispositivo: z.enum(["CELULAR", "COMPUTADORA"]),
  problemaReportado: z.string().min(1, "El problema es requerido"),
  presupuesto: z.union([z.number().positive(), z.nan(), z.undefined()]).optional(),
  fechaPrometida: z.string().optional(),
  observaciones: z.string().optional(),
})

type OrdenFormData = z.infer<typeof ordenSchema>

interface OrdenFormProps {
  onClose: () => void
  onSuccess: () => void
}

export function OrdenForm({ onClose, onSuccess }: OrdenFormProps) {
  const [loading, setLoading] = useState(false)
  const [clientes, setClientes] = useState<Cliente[]>([])
  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
  } = useForm<OrdenFormData>({
    resolver: zodResolver(ordenSchema),
    defaultValues: {
      clienteId: "",
      dispositivo: "",
      tipoDispositivo: "CELULAR",
      problemaReportado: "",
      fechaPrometida: "",
    },
  })

  useEffect(() => {
    fetch("/api/clientes")
      .then((res) => res.json())
      .then((data) => setClientes(data))
      .catch(console.error)
  }, [])

  const onSubmit = async (data: OrdenFormData) => {
    setLoading(true)
    try {
      const res = await fetch("/api/ordenes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          presupuesto: data.presupuesto && data.presupuesto > 0 ? data.presupuesto : undefined,
          fechaPrometida: data.fechaPrometida || undefined,
        }),
      })

      if (!res.ok) {
        const error = await res.json()
        alert(error.error || "Error al crear orden")
        return
      }

      onSuccess()
    } catch (error) {
      console.error("Error creating orden:", error)
      alert("Error al crear orden")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Nueva Orden de Servicio</CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Label htmlFor="clienteId">Cliente *</Label>
            <Select
              id="clienteId"
              {...register("clienteId")}
              onChange={(e) => setValue("clienteId", e.target.value)}
            >
              <option value="">Seleccionar cliente...</option>
              {clientes.map((cliente) => (
                <option key={cliente.id} value={cliente.id}>
                  {cliente.nombre} - {cliente.telefono}
                </option>
              ))}
            </Select>
            {errors.clienteId && (
              <p className="text-sm text-destructive mt-1">
                {errors.clienteId.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="dispositivo">Dispositivo *</Label>
              <Input
                id="dispositivo"
                {...register("dispositivo")}
                placeholder="Ej: iPhone 12"
              />
              {errors.dispositivo && (
                <p className="text-sm text-destructive mt-1">
                  {errors.dispositivo.message}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="tipoDispositivo">Tipo *</Label>
              <Select
                id="tipoDispositivo"
                {...register("tipoDispositivo")}
                onChange={(e) =>
                  setValue("tipoDispositivo", e.target.value as TipoDispositivo)
                }
              >
                <option value="CELULAR">Celular</option>
                <option value="COMPUTADORA">Computadora</option>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="problemaReportado">Problema Reportado *</Label>
            <Textarea
              id="problemaReportado"
              {...register("problemaReportado")}
              placeholder="Describa el problema..."
              rows={4}
            />
            {errors.problemaReportado && (
              <p className="text-sm text-destructive mt-1">
                {errors.problemaReportado.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="presupuesto">Presupuesto (Opcional)</Label>
              <Input
                id="presupuesto"
                type="number"
                step="0.01"
                min="0"
                {...register("presupuesto", { 
                  valueAsNumber: true,
                  setValueAs: (value) => value === "" || value === null || value === undefined ? undefined : Number(value)
                })}
                placeholder="0.00"
              />
            </div>
            <DatePicker
              id="fechaPrometida"
              label="Fecha Prometida (Opcional)"
              value={watch("fechaPrometida")}
              onChange={(value) => setValue("fechaPrometida", value || "")}
              min={new Date().toISOString().split("T")[0]}
            />
          </div>

          <div>
            <Label htmlFor="observaciones">Observaciones</Label>
            <Textarea
              id="observaciones"
              {...register("observaciones")}
              placeholder="Observaciones adicionales..."
              rows={2}
            />
          </div>

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creando..." : "Crear Orden"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

