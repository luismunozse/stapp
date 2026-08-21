"use client"

import { useState, useEffect, useRef } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FormActionBar } from "@/components/ui/form-action-bar"
import { DraftRestoredNotice } from "@/components/ui/draft-restored-notice"
import { User, Building2 } from "lucide-react"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"
import { Switch } from "@/components/ui/switch"
import type { Cliente } from "@/types"
import { useCurrency } from "@/contexts/currency-context"
import { useModal } from "@/contexts/modal-context"
import { useOffline } from "@/contexts/offline-context"
import { useFormDraft } from "@/hooks/use-form-draft"
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
  aceptaWhatsapp: z.boolean().default(true),
  // Solo se renderizan/envían para ADMIN (ver design ADR-7) — el server
  // igual los rechaza con 403 si un no-ADMIN los manda igual.
  tipoPrecio: z.enum(["MINORISTA", "MAYORISTA"]).default("MINORISTA"),
  descuentoPct: z.number().min(0, "Debe estar entre 0 y 100").max(100, "Debe estar entre 0 y 100").optional(),
})

type ClienteFormData = z.infer<typeof clienteSchema>

/** Valores base para el form: prefill de edicion o blanco para alta. Vive
 *  afuera del componente (sin dependencias de hooks) para poder reusarla en
 *  useForm(defaultValues), el efecto de prefill y el discard del borrador
 *  sin triplicar el mismo objeto literal. */
function clienteFormDefaults(cliente?: Cliente | null): ClienteFormData {
  return cliente
    ? {
        tipoCliente: cliente.tipoCliente || "INDIVIDUAL",
        nombre: cliente.nombre,
        telefono: cliente.telefono,
        email: cliente.email || "",
        direccion: cliente.direccion || "",
        dni: cliente.dni || "",
        razonSocial: cliente.razonSocial || "",
        cuit: cliente.cuit || "",
        aceptaWhatsapp: cliente.aceptaWhatsapp ?? true,
        tipoPrecio: cliente.tipoPrecio || "MINORISTA",
        descuentoPct: cliente.descuentoPct ?? undefined,
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
        aceptaWhatsapp: true,
        tipoPrecio: "MINORISTA",
        descuentoPct: undefined,
      }
}

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
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === "ADMIN"
  const [loading, setLoading] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
    getValues,
    setValue,
  } = useForm<ClienteFormData>({
    resolver: zodResolver(clienteSchema),
    defaultValues: clienteFormDefaults(cliente),
  })

  const tipoCliente = watch("tipoCliente")
  const tipoPrecio = watch("tipoPrecio")

  // Depende del ID, no de la identidad del objeto: cliente-detalle.tsx pasa
  // este prop desde SWR y cada revalidacion trae un objeto nuevo con los mismos
  // datos. Con `cliente` en las dependencias, esa revalidacion reseteaba un
  // dialog abierto a los valores del servidor y se llevaba puesto el borrador
  // recien restaurado, mientras el aviso seguia diciendo que se restauro uno.
  useEffect(() => {
    if (open) {
      reset(clienteFormDefaults(cliente))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cliente?.id, reset])

  // --- Borrador local (useFormDraft) ----------------------------------------
  // recordId por cliente.id: nunca mezcla un borrador de alta con uno de
  // edicion, ni el de un cliente con el de otro. Solo activo mientras el
  // dialog esta abierto (el componente queda montado con `open=false` entre
  // usos) para no seguir grabando ni restaurando en segundo plano.
  const recordId = cliente?.id ?? null
  const [draftNoticeVisible, setDraftNoticeVisible] = useState(false)
  const draftAppliedForRef = useRef<string | null>(null)
  /** Raiz del formulario para el gate de interaccion del hook: este dialog se
   *  monta adentro de OrdenForm y RecepcionForm (via ClienteSelector), asi que
   *  cada uno tiene que reconocer solo sus propios controles. */
  const formRef = useRef<HTMLFormElement>(null)
  const { draft, ready: draftReady, clearDraft, notifyChange } = useFormDraft<ClienteFormData>({
    feature: "cliente-form",
    recordId,
    // `getValues()` en vez de `watch()`: leer el form entero en render
    // suscribe el componente a cada tecla. El borrador no necesita re-render,
    // solo el valor al momento de grabar.
    getValue: () => getValues(),
    enabled: open,
    rootRef: formRef,
    // En edicion, si otro usuario guardo el cliente despues de que se escribio
    // este borrador, restaurarlo pisaria ese guardado (el submit manda el form
    // entero). El hook lo descarta comparando contra este token.
    recordUpdatedAt: cliente?.updatedAt ?? null,
  })

  // Los cambios de react-hook-form ya no re-renderizan el formulario, asi que
  // hay que avisarle al borrador por suscripcion.
  useEffect(() => {
    const subscription = watch(() => notifyChange())
    return () => subscription.unsubscribe()
  }, [watch, notifyChange])

  useEffect(() => {
    if (!open) {
      draftAppliedForRef.current = null
      setDraftNoticeVisible(false)
      return
    }
    const scopeKey = recordId ?? "new"
    if (!draftReady || draftAppliedForRef.current === scopeKey) return
    draftAppliedForRef.current = scopeKey
    if (!draft) return
    try {
      reset(draft)
      setDraftNoticeVisible(true)
    } catch (error) {
      // Un borrador de otra forma (cambio de campos sin bump de version) no
      // puede tumbar el dialog: la excepcion correria dentro de un efecto y se
      // llevaria el arbol entero.
      console.error("Borrador de cliente invalido, se descarta:", error)
      clearDraft()
      setDraftNoticeVisible(false)
      reset(clienteFormDefaults(cliente))
    }
    // `cliente` solo se usa en el rescate del catch: incluirlo en las
    // dependencias volveria a correr el efecto en cada revalidacion de SWR.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, recordId, draftReady, draft, reset, clearDraft])

  const discardDraft = () => {
    clearDraft()
    setDraftNoticeVisible(false)
    reset(clienteFormDefaults(cliente))
  }

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
      if (isAdmin) {
        // Mismo patrón que razonSocial/cuit arriba: al volver a MINORISTA se
        // limpia el % explícitamente (REQ-5.2), no queda un descuento
        // fantasma guardado detrás de un tier que ya no lo usa.
        if (data.tipoPrecio === "MINORISTA") {
          payload.descuentoPct = null
        }
      } else {
        // Los campos ni siquiera se renderizan para no-ADMIN, pero el estado
        // por defecto del form ("MINORISTA") no debe reenviarse — el back
        // ya lo ignora si viene undefined, pero si viniera un valor previo
        // de un cliente MAYORISTA (edición sin tocar el tier) reenviar
        // tipoPrecio dispararía el gate 403 aunque el usuario no tocó nada.
        delete payload.tipoPrecio
        delete payload.descuentoPct
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
        clearDraft()
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
      clearDraft()
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
        <form ref={formRef} onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {draftNoticeVisible && (
            <DraftRestoredNotice onDiscard={discardDraft} />
          )}

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
                  inputMode="numeric"
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
              type="tel"
              inputMode="tel"
              autoComplete="tel"
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
              inputMode="email"
              autoComplete="email"
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
              inputMode="numeric"
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
              autoComplete="street-address"
              {...register("direccion")}
              placeholder="Dirección completa"
            />
          </div>

          {/* Precio mayorista — solo ADMIN puede definirlo (design ADR-7) */}
          {isAdmin && (
            <div>
              <Label>Precio</Label>
              <div className="grid grid-cols-2 gap-2 mt-1.5">
                <button
                  type="button"
                  onClick={() => setValue("tipoPrecio", "MINORISTA")}
                  className={`px-3 py-2.5 rounded-md border text-sm font-medium transition-colors ${
                    tipoPrecio === "MINORISTA"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-input bg-background hover:bg-accent"
                  }`}
                >
                  Minorista
                </button>
                <button
                  type="button"
                  onClick={() => setValue("tipoPrecio", "MAYORISTA")}
                  className={`px-3 py-2.5 rounded-md border text-sm font-medium transition-colors ${
                    tipoPrecio === "MAYORISTA"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-input bg-background hover:bg-accent"
                  }`}
                >
                  Mayorista
                </button>
              </div>
              {tipoPrecio === "MAYORISTA" && (
                <div className="mt-2">
                  <Label htmlFor="descuentoPct">Descuento mayorista (%)</Label>
                  <Input
                    id="descuentoPct"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={100}
                    step="0.01"
                    {...register("descuentoPct", {
                      setValueAs: (v) => (v === "" || v === null ? undefined : Number(v)),
                    })}
                    placeholder="15"
                  />
                  {errors.descuentoPct && (
                    <p className="text-sm text-destructive mt-1">
                      {errors.descuentoPct.message}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="aceptaWhatsapp" className="flex items-center gap-1.5">
                <WhatsAppIcon className="h-4 w-4 text-success-600" />
                Acepta notificaciones por WhatsApp
              </Label>
              <p className="text-xs text-muted-foreground">
                Desactivar para no enviar mensajes automáticos de WhatsApp a este cliente.
              </p>
            </div>
            <Switch
              id="aceptaWhatsapp"
              checked={watch("aceptaWhatsapp") ?? true}
              onCheckedChange={(checked) => setValue("aceptaWhatsapp", checked)}
            />
          </div>

          <FormActionBar inDialog>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Guardando..." : "Guardar"}
            </Button>
          </FormActionBar>
        </form>
      </DialogContent>
    </Dialog>
  )
}
