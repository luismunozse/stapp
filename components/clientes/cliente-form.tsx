"use client"

import { useState, useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { X, User, Building2 } from "lucide-react"
import type { Cliente, TipoCliente } from "@/types"

const clienteSchema = z.object({
  tipoCliente: z.enum(["INDIVIDUAL", "EMPRESA"]).default("INDIVIDUAL"),
  nombre: z.string()
    .min(1, "El nombre es requerido")
    .regex(/^[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ\s.]+$/, "El nombre solo debe contener letras"),
  telefono: z.string()
    .min(1, "El teléfono es requerido")
    .regex(/^\d{10}$/, "El teléfono debe tener exactamente 10 dígitos"),
  email: z.string().email("Email inválido").optional().or(z.literal("")),
  direccion: z.string().optional(),
  dni: z.string()
    .regex(/^(\d{7,8})?$/, "El DNI debe tener 7 u 8 dígitos")
    .optional()
    .or(z.literal("")),
  razonSocial: z.string().optional(),
  cuit: z.string()
    .regex(/^(\d{2}-?\d{8}-?\d{1})?$/, "CUIT inválido (formato: XX-XXXXXXXX-X)")
    .optional()
    .or(z.literal("")),
})

type ClienteFormData = z.infer<typeof clienteSchema>

interface ClienteFormProps {
  cliente?: Cliente | null
  onClose: () => void
  onSuccess: () => void
}

export function ClienteForm({ cliente, onClose, onSuccess }: ClienteFormProps) {
  const [loading, setLoading] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
    setValue,
  } = useForm<ClienteFormData>({
    resolver: zodResolver(clienteSchema),
    defaultValues: cliente
      ? {
          tipoCliente: cliente.tipoCliente || "INDIVIDUAL",
          nombre: cliente.nombre,
          telefono: cliente.telefono,
          email: cliente.email || "",
          direccion: cliente.direccion || "",
          dni: cliente.dni || "",
          razonSocial: cliente.razonSocial || "",
          cuit: cliente.cuit || "",
        }
      : {
          tipoCliente: "INDIVIDUAL",
          nombre: "",
          telefono: "",
          email: "",
          direccion: "",
          dni: "",
          razonSocial: "",
          cuit: "",
        },
  })

  const tipoCliente = watch("tipoCliente")

  useEffect(() => {
    if (cliente) {
      reset({
        tipoCliente: cliente.tipoCliente || "INDIVIDUAL",
        nombre: cliente.nombre,
        telefono: cliente.telefono,
        email: cliente.email || "",
        direccion: cliente.direccion || "",
        dni: cliente.dni || "",
        razonSocial: cliente.razonSocial || "",
        cuit: cliente.cuit || "",
      })
    }
  }, [cliente, reset])

  const onSubmit = async (data: ClienteFormData) => {
    setLoading(true)
    try {
      const url = cliente ? `/api/clientes/${cliente.id}` : "/api/clientes"
      const method = cliente ? "PUT" : "POST"

      const payload: any = { ...data }
      if (data.tipoCliente === "INDIVIDUAL") {
        payload.razonSocial = ""
        payload.cuit = ""
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const error = await res.json()
        alert(error.error || "Error al guardar cliente")
        return
      }

      onSuccess()
    } catch (error) {
      console.error("Error saving cliente:", error)
      alert("Error al guardar cliente")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{cliente ? "Editar Cliente" : "Nuevo Cliente"}</CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Tipo de cliente */}
          <div>
            <Label>Tipo de cliente</Label>
            <div className="grid grid-cols-2 gap-2 mt-1.5">
              <button
                type="button"
                onClick={() => setValue("tipoCliente", "INDIVIDUAL")}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-md border text-sm font-medium transition-colors ${
                  tipoCliente === "INDIVIDUAL"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input bg-background hover:bg-accent"
                }`}
              >
                <User className="h-4 w-4" />
                Individual
              </button>
              <button
                type="button"
                onClick={() => setValue("tipoCliente", "EMPRESA")}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-md border text-sm font-medium transition-colors ${
                  tipoCliente === "EMPRESA"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input bg-background hover:bg-accent"
                }`}
              >
                <Building2 className="h-4 w-4" />
                Empresa
              </button>
            </div>
          </div>

          <div>
            <Label htmlFor="nombre">
              {tipoCliente === "EMPRESA" ? "Nombre de contacto *" : "Nombre *"}
            </Label>
            <Input
              id="nombre"
              {...register("nombre")}
              placeholder={tipoCliente === "EMPRESA" ? "Nombre del contacto" : "Nombre completo"}
            />
            {errors.nombre && (
              <p className="text-sm text-destructive mt-1">
                {errors.nombre.message}
              </p>
            )}
          </div>

          {/* Campos de empresa */}
          {tipoCliente === "EMPRESA" && (
            <>
              <div>
                <Label htmlFor="razonSocial">Razón Social</Label>
                <Input
                  id="razonSocial"
                  {...register("razonSocial")}
                  placeholder="Razón social de la empresa"
                />
              </div>

              <div>
                <Label htmlFor="cuit">CUIT</Label>
                <Input
                  id="cuit"
                  {...register("cuit")}
                  placeholder="XX-XXXXXXXX-X"
                  maxLength={13}
                />
                {errors.cuit && (
                  <p className="text-sm text-destructive mt-1">
                    {errors.cuit.message}
                  </p>
                )}
              </div>
            </>
          )}

          <div>
            <Label htmlFor="telefono">Teléfono *</Label>
            <Input
              id="telefono"
              {...register("telefono")}
              placeholder="1123456789"
              maxLength={10}
            />
            {errors.telefono && (
              <p className="text-sm text-destructive mt-1">
                {errors.telefono.message}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              {...register("email")}
              placeholder="cliente@email.com"
            />
            {errors.email && (
              <p className="text-sm text-destructive mt-1">
                {errors.email.message}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="dni">
              {tipoCliente === "EMPRESA" ? "DNI del contacto" : "DNI"}
            </Label>
            <Input
              id="dni"
              {...register("dni")}
              placeholder="12345678"
              maxLength={8}
            />
            {errors.dni && (
              <p className="text-sm text-destructive mt-1">
                {errors.dni.message}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="direccion">Dirección</Label>
            <Input
              id="direccion"
              {...register("direccion")}
              placeholder="Dirección completa"
            />
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
