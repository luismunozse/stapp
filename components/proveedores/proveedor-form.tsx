"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { X } from "lucide-react"

const CONDICION_IVA_OPTIONS = [
  { value: "RESPONSABLE_INSCRIPTO", label: "Responsable Inscripto" },
  { value: "MONOTRIBUTO", label: "Monotributo" },
  { value: "EXENTO", label: "Exento" },
  { value: "NO_RESPONSABLE", label: "No Responsable" },
  { value: "CONSUMIDOR_FINAL", label: "Consumidor Final" },
] as const

const CONDICION_PAGO_OPTIONS = [
  { value: "CONTADO", label: "Contado" },
  { value: "CTA_CTE", label: "Cuenta corriente" },
  { value: "TRANSFERENCIA", label: "Transferencia" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "OTRO", label: "Otro" },
] as const

const NONE = "__none__"

const proveedorSchema = z.object({
  nombre: z.string().min(1, "El nombre es requerido"),
  telefono: z.string().optional(),
  whatsapp: z.string().optional(),
  email: z.string().email("Email inválido").optional().or(z.literal("")),
  direccion: z.string().optional(),
  website: z.string().url("URL inválida").optional().or(z.literal("")),
  notas: z.string().optional(),
  activo: z.boolean(),
  razonSocial: z.string().optional(),
  cuit: z.string().optional(),
  condicionIva: z.string().optional(),
  ingresosBrutos: z.string().optional(),
  condicionPago: z.string().optional(),
  diasPago: z.union([z.number(), z.nan()]).optional(),
})

type ProveedorFormData = z.infer<typeof proveedorSchema>

interface Proveedor {
  id: string
  nombre: string
  telefono?: string | null
  whatsapp?: string | null
  email?: string | null
  direccion?: string | null
  website?: string | null
  notas?: string | null
  activo: boolean
  razonSocial?: string | null
  cuit?: string | null
  condicionIva?: string | null
  ingresosBrutos?: string | null
  condicionPago?: string | null
  diasPago?: number | null
}

interface ProveedorFormProps {
  proveedor: Proveedor | null
  onClose: () => void
  onSuccess: () => void
}

export function ProveedorForm({ proveedor, onClose, onSuccess }: ProveedorFormProps) {
  const [loading, setLoading] = useState(false)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ProveedorFormData>({
    resolver: zodResolver(proveedorSchema),
    defaultValues: {
      nombre: proveedor?.nombre || "",
      telefono: proveedor?.telefono || "",
      whatsapp: proveedor?.whatsapp || "",
      email: proveedor?.email || "",
      direccion: proveedor?.direccion || "",
      website: proveedor?.website || "",
      notas: proveedor?.notas || "",
      activo: proveedor?.activo ?? true,
      razonSocial: proveedor?.razonSocial || "",
      cuit: proveedor?.cuit || "",
      condicionIva: proveedor?.condicionIva || "",
      ingresosBrutos: proveedor?.ingresosBrutos || "",
      condicionPago: proveedor?.condicionPago || "",
      diasPago: proveedor?.diasPago ?? undefined,
    },
  })

  const condicionIva = watch("condicionIva") || ""
  const condicionPago = watch("condicionPago") || ""

  const onSubmit = async (data: ProveedorFormData) => {
    setLoading(true)
    try {
      const url = proveedor ? `/api/proveedores/${proveedor.id}` : "/api/proveedores"
      const method = proveedor ? "PUT" : "POST"

      const payload = {
        ...data,
        diasPago: typeof data.diasPago === "number" && !isNaN(data.diasPago) ? data.diasPago : null,
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const error = await res.json()
        alert(error.error || "Error al guardar proveedor")
        return
      }

      onSuccess()
    } catch (error) {
      console.error("Error saving proveedor:", error)
      alert("Error al guardar proveedor")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{proveedor ? "Editar Proveedor" : "Nuevo Proveedor"}</CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="nombre">Nombre *</Label>
              <Input
                id="nombre"
                {...register("nombre")}
                placeholder="Nombre del proveedor"
              />
              {errors.nombre && (
                <p className="text-sm text-destructive">{errors.nombre.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="telefono">Teléfono</Label>
              <Input
                id="telefono"
                {...register("telefono")}
                placeholder="+54 11 1234-5678"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="whatsapp">WhatsApp (sin +)</Label>
              <Input
                id="whatsapp"
                {...register("whatsapp")}
                placeholder="5491112345678"
              />
              <p className="text-xs text-muted-foreground">
                Número completo sin espacios ni guiones
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                {...register("email")}
                placeholder="contacto@proveedor.com"
              />
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="direccion">Dirección</Label>
            <Input
              id="direccion"
              {...register("direccion")}
              placeholder="Av. Corrientes 1234, CABA"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="website">Página Web</Label>
            <Input
              id="website"
              {...register("website")}
              placeholder="https://www.proveedor.com"
            />
            {errors.website && (
              <p className="text-sm text-destructive">{errors.website.message}</p>
            )}
          </div>

          {/* Datos fiscales y condiciones comerciales */}
          <div className="space-y-3 pt-2 border-t">
            <h4 className="text-sm font-semibold text-muted-foreground">
              Datos fiscales y condiciones
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="razonSocial">Razón social</Label>
                <Input
                  id="razonSocial"
                  {...register("razonSocial")}
                  placeholder="Razón social legal"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cuit">CUIT</Label>
                <Input
                  id="cuit"
                  {...register("cuit")}
                  placeholder="30-12345678-9"
                />
              </div>
              <div className="space-y-2">
                <Label>Condición IVA</Label>
                <Select
                  value={condicionIva || NONE}
                  onValueChange={(v) => setValue("condicionIva", v === NONE ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sin especificar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Sin especificar</SelectItem>
                    {CONDICION_IVA_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ingresosBrutos">Ingresos Brutos / IIBB</Label>
                <Input
                  id="ingresosBrutos"
                  {...register("ingresosBrutos")}
                  placeholder="N° IIBB"
                />
              </div>
              <div className="space-y-2">
                <Label>Condición de pago</Label>
                <Select
                  value={condicionPago || NONE}
                  onValueChange={(v) => setValue("condicionPago", v === NONE ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sin especificar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Sin especificar</SelectItem>
                    {CONDICION_PAGO_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="diasPago">Días de pago</Label>
                <Input
                  id="diasPago"
                  type="number"
                  min={0}
                  max={365}
                  {...register("diasPago", { valueAsNumber: true })}
                  placeholder="0 = contado, 30, 60..."
                />
                <p className="text-xs text-muted-foreground">
                  Cantidad de días desde factura. Dejá vacío si no aplica.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notas">Notas</Label>
            <Textarea
              id="notas"
              {...register("notas")}
              placeholder="Información adicional sobre el proveedor..."
              rows={3}
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="activo"
              {...register("activo")}
              className="h-4 w-4"
            />
            <Label htmlFor="activo">Proveedor activo</Label>
          </div>

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
