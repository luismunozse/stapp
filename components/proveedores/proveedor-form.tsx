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
import { Badge } from "@/components/ui/badge"
import { FormActionBar } from "@/components/ui/form-action-bar"
import { Star, X, Upload, ImageIcon, Trash2, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { useModal } from "@/contexts/modal-context"

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

const whatsappValidator = z
  .string()
  .optional()
  .refine(
    (v) => !v || /^\d{10,15}$/.test(v.replace(/\D/g, "")),
    "WhatsApp inválido: 10-15 dígitos, sin + ni espacios"
  )

const proveedorSchema = z.object({
  nombre: z.string().min(1, "El nombre es requerido"),
  telefono: z.string().optional(),
  whatsapp: whatsappValidator,
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
  leadTimeDias: z.union([z.number(), z.nan()]).optional(),
  pedidoMinimo: z.union([z.number(), z.nan()]).optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  tags: z.array(z.string()).optional(),
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
  leadTimeDias?: number | null
  pedidoMinimo?: number | null
  rating?: number | null
  tags?: string[] | null
  logoUrl?: string | null
}

interface ProveedorFormProps {
  proveedor: Proveedor | null
  onClose: () => void
  onSuccess: () => void
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(",")[1] || "")
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function ProveedorForm({ proveedor, onClose, onSuccess }: ProveedorFormProps) {
  const { showError } = useModal()
  const [loading, setLoading] = useState(false)
  const [tags, setTags] = useState<string[]>(proveedor?.tags || [])
  const [tagInput, setTagInput] = useState("")
  const [rating, setRating] = useState<number | null>(proveedor?.rating ?? null)
  const [logoUrl, setLogoUrl] = useState<string | null>(proveedor?.logoUrl ?? null)
  const [uploadingLogo, setUploadingLogo] = useState(false)

  const handleLogoUpload = async (file: File) => {
    if (!proveedor) return
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("Formato no permitido (jpg, png, webp)")
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("El logo supera 2MB")
      return
    }
    setUploadingLogo(true)
    try {
      const base64 = await fileToBase64(file)
      const res = await fetch(`/api/proveedores/${proveedor.id}/logo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: base64, mime: file.type }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || "Error al subir logo")
        return
      }
      setLogoUrl(data.logoUrl)
      toast.success("Logo actualizado")
    } finally {
      setUploadingLogo(false)
    }
  }

  const handleLogoRemove = async () => {
    if (!proveedor) return
    if (!confirm("¿Eliminar logo?")) return
    const res = await fetch(`/api/proveedores/${proveedor.id}/logo`, { method: "DELETE" })
    if (res.ok) {
      setLogoUrl(null)
      toast.success("Logo eliminado")
    }
  }

  const addTag = (raw: string) => {
    const v = raw.trim().toLowerCase().slice(0, 40)
    if (!v) return
    if (tags.includes(v) || tags.length >= 20) return
    setTags([...tags, v])
  }
  const removeTag = (t: string) => setTags(tags.filter((x) => x !== t))

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
      leadTimeDias: proveedor?.leadTimeDias ?? undefined,
      pedidoMinimo: proveedor?.pedidoMinimo ?? undefined,
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
        leadTimeDias: typeof data.leadTimeDias === "number" && !isNaN(data.leadTimeDias) ? data.leadTimeDias : null,
        pedidoMinimo: typeof data.pedidoMinimo === "number" && !isNaN(data.pedidoMinimo) ? data.pedidoMinimo : null,
        rating,
        tags,
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const error = await res.json()
        await showError(error.error || "Error al guardar proveedor")
        return
      }

      onSuccess()
    } catch (error) {
      console.error("Error saving proveedor:", error)
      await showError("Error al guardar proveedor")
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
          {proveedor && (
            <div className="flex items-center gap-3 pb-2 border-b">
              <div className="h-16 w-16 rounded-md border bg-muted/30 flex items-center justify-center overflow-hidden shrink-0">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt={proveedor.nombre} className="h-full w-full object-contain" />
                ) : (
                  <ImageIcon className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <Label className="text-sm">Logo del proveedor</Label>
                <p className="text-xs text-muted-foreground">JPG / PNG / WebP. Máx 2MB.</p>
                <div className="flex gap-2 mt-1">
                  <label
                    className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded border hover:bg-muted cursor-pointer ${uploadingLogo ? "opacity-50 pointer-events-none" : ""}`}
                  >
                    {uploadingLogo ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                    {logoUrl ? "Cambiar" : "Subir"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      disabled={uploadingLogo}
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) handleLogoUpload(f)
                        e.target.value = ""
                      }}
                    />
                  </label>
                  {logoUrl && (
                    <button
                      type="button"
                      onClick={handleLogoRemove}
                      className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border hover:bg-muted text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                      Quitar
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
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
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                {...register("telefono")}
                placeholder="+54 11 1234-5678"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="whatsapp">WhatsApp (sin +)</Label>
              <Input
                id="whatsapp"
                inputMode="numeric"
                {...register("whatsapp", {
                  setValueAs: (v: string) => (v ?? "").replace(/\D/g, ""),
                })}
                placeholder="5491112345678"
              />
              {errors.whatsapp ? (
                <p className="text-sm text-destructive">{errors.whatsapp.message}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Sólo dígitos (10-15). Sin +, espacios ni guiones.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
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

          {/* Operativa y clasificación */}
          <div className="space-y-3 pt-2 border-t">
            <h4 className="text-sm font-semibold text-muted-foreground">
              Operativa y clasificación
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="leadTimeDias">Lead time (días entrega)</Label>
                <Input
                  id="leadTimeDias"
                  type="number"
                  min={0}
                  max={365}
                  {...register("leadTimeDias", { valueAsNumber: true })}
                  placeholder="Ej: 7"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pedidoMinimo">Pedido mínimo ($)</Label>
                <Input
                  id="pedidoMinimo"
                  type="number"
                  min={0}
                  step="0.01"
                  {...register("pedidoMinimo", { valueAsNumber: true })}
                  placeholder="Ej: 10000"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Rating interno</Label>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(rating === n ? null : n)}
                    className="p-0.5"
                    title={`${n} estrella${n === 1 ? "" : "s"}`}
                  >
                    <Star
                      className={`h-6 w-6 transition-colors ${
                        rating != null && n <= rating
                          ? "fill-yellow-400 text-yellow-400"
                          : "text-muted-foreground/30"
                      }`}
                    />
                  </button>
                ))}
                {rating != null && (
                  <button
                    type="button"
                    onClick={() => setRating(null)}
                    className="ml-2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Limpiar
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Tags / etiquetas</Label>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <Badge key={t} variant="secondary" className="gap-1 pr-1">
                    {t}
                    <button
                      type="button"
                      onClick={() => removeTag(t)}
                      className="hover:text-destructive"
                      aria-label={`Quitar ${t}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault()
                    if (tagInput) {
                      addTag(tagInput)
                      setTagInput("")
                    }
                  }
                }}
                onBlur={() => {
                  if (tagInput) {
                    addTag(tagInput)
                    setTagInput("")
                  }
                }}
                placeholder="Ej: repuestos, mayorista, accesorios (Enter para agregar)"
              />
              <p className="text-xs text-muted-foreground">
                Hasta 20 etiquetas. Usá Enter o coma para agregar.
              </p>
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

          <FormActionBar>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Guardando..." : "Guardar"}
            </Button>
          </FormActionBar>
        </form>
      </CardContent>
    </Card>
  )
}
