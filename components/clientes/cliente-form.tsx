"use client"

import { useState, useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { User, Building2 } from "lucide-react"
import type { Cliente } from "@/types"
import { useCurrency } from "@/contexts/currency-context"
import { useModal } from "@/contexts/modal-context"
import { useOffline } from "@/contexts/offline-context"
import { STORES } from "@/lib/offline/constants"
import { getCountryConfig } from "@/lib/countries"

const clienteSchema = z.object({
  tipoCliente: z.enum(["INDIVIDUAL", "EMPRESA"]).default("INDIVIDUAL"),
  nombre: z.string()
    .min(1, "El nombre es requerido")
    .regex(/^[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ\s.'\-0-9]+$/, "El nombre contiene caracteres no permitidos"),
  telefono: z.string()
    .min(1, "El teléfono es requerido")
    .min(7, "El teléfono debe tener al menos 7 dígitos"),
  email: z.string().email("Email inválido").optional().or(z.literal("")),
  direccion: z.string().optional(),
  dni: z.string().optional().or(z.literal("")),
  razonSocial: z.string().optional(),
  cuit: z.string().optional().or(z.literal("")),
})

type ClienteFormData = z.infer<typeof clienteSchema>

interface ClienteFormProps {
  cliente?: Cliente | null
  open: boolean
  onClose: () => void
  onSuccess: (cliente?: Cliente, opts?: { queuedOffline?: boolean }) => void
}

export function ClienteForm({ cliente, open, onClose, onSuccess }: ClienteFormProps) {
  const { pais } = useCurrency()
  const countryConfig = getCountryConfig(pais)
  const { showError, showInfo } = useModal()
  const { offlineFetch } = useOffline()
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
    if (open) {
      reset(cliente
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
          }
      )
    }
  }, [open, cliente, reset])

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

      const isCreating = !cliente
      const res = await (isCreating
        ? offlineFetch(url, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }, { store: STORES.CLIENTS, description: `Cliente - ${data.nombre}` })
        : fetch(url, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }))

      if (res.status === 202) {
        await showInfo("Cliente guardado offline. Se sincronizará automáticamente cuando vuelva la conexión. No podrá asignarse a la operación actual hasta entonces.")
        onSuccess(undefined, { queuedOffline: true })
        return
      }

      if (!res.ok) {
        const error = await res.json()
        await showError(error.error || "Error al guardar cliente")
        return
      }

      let createdCliente: Cliente | undefined
      try {
        createdCliente = await res.json()
      } catch {
        createdCliente = undefined
      }
      onSuccess(createdCliente)
    } catch (error) {
      console.error("Error saving cliente:", error)
      await showError("Error al guardar cliente")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{cliente ? "Editar Cliente" : "Nuevo Cliente"}</DialogTitle>
        </DialogHeader>
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
                <Label htmlFor="cuit">{countryConfig.taxIdLabel}</Label>
                <Input
                  id="cuit"
                  {...register("cuit")}
                  placeholder={countryConfig.taxIdPlaceholder}
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
              maxLength={15}
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
              {tipoCliente === "EMPRESA" ? `${countryConfig.personalIdLabel} del contacto` : countryConfig.personalIdLabel}
            </Label>
            <Input
              id="dni"
              {...register("dni")}
              placeholder={countryConfig.personalIdPlaceholder}
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
      </DialogContent>
    </Dialog>
  )
}
