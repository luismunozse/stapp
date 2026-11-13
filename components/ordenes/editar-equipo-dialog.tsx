"use client"

import { useState } from "react"
import { Lock, X } from "lucide-react"
import { toast } from "sonner"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useTiposDispositivo } from "@/hooks/use-tipos-dispositivo"
import { useTipoDispositivoConfig } from "@/hooks/use-tipo-dispositivo-config"
import { isValidImei, sanitizeImei } from "@/lib/imei"
import { CamposExtraFields } from "./campos-extra-fields"
import { CodigoAccesoModal, resumenCodigoAcceso } from "./codigo-acceso-modal"
import type { CampoExtra, OrdenServicio } from "@/types"

type CamposEquipo = Pick<
  OrdenServicio,
  "marca" | "dispositivo" | "color" | "imei" | "codigoAccesoDispositivo" | "metadata"
>

interface EditarEquipoDialogProps {
  orden: OrdenServicio
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the saved values once the server accepted them. */
  onSaved: (patch: Partial<CamposEquipo>) => void
}

/**
 * Corrige los datos del equipo de una orden ya creada: marca, modelo, color,
 * serie/IMEI, código de acceso y los campos extra del rubro. Los campos que se
 * muestran siguen la configuración del tipo de la orden, igual que en el alta.
 *
 * El tipo no se cambia: define el prefijo del código de la orden y qué campos
 * extra existen, así que cambiarlo dejaría una orden "CEL-0012" que es una notebook.
 */
export function EditarEquipoDialog({ orden, open, onOpenChange, onSaved }: EditarEquipoDialogProps) {
  const [saving, setSaving] = useState(false)
  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <ResponsiveDialogContent className="sm:max-w-lg">
        {/* The content unmounts on close, so each opening starts from what the order has now. */}
        <EditarEquipoForm
          orden={orden}
          saving={saving}
          setSaving={setSaving}
          onCancel={() => onOpenChange(false)}
          onSaved={(patch) => {
            onSaved(patch)
            onOpenChange(false)
          }}
        />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

function EditarEquipoForm({
  orden,
  saving,
  setSaving,
  onCancel,
  onSaved,
}: {
  orden: OrdenServicio
  saving: boolean
  setSaving: (saving: boolean) => void
  onCancel: () => void
  onSaved: (patch: Partial<CamposEquipo>) => void
}) {
  const { tipos } = useTiposDispositivo()
  const { config, marcasDisponibles, camposExtra, showImei, showPassword, showColor, showMarca } =
    useTipoDispositivoConfig(tipos, orden.tipoDispositivo)

  const [marca, setMarca] = useState(orden.marca ?? "")
  const [dispositivo, setDispositivo] = useState(orden.dispositivo ?? "")
  const [color, setColor] = useState(orden.color ?? "")
  const [imei, setImei] = useState(orden.imei ?? "")
  const [codigoAcceso, setCodigoAcceso] = useState(orden.codigoAccesoDispositivo ?? "")
  const [camposExtraValues, setCamposExtraValues] = useState<Record<string, any>>(() => ({ ...(orden.metadata ?? {}) }))
  const [codigoModalOpen, setCodigoModalOpen] = useState(false)
  const [imeiError, setImeiError] = useState("")

  const nombreTipo = tipos.find((t) => t.codigo === orden.tipoDispositivo)?.nombre ?? orden.tipoDispositivo
  const imeiLabel = config.campos?.imei?.label || "Número de serie"
  const imeiEsImei = config.campos?.imei?.validacion === "imei"
  const campoDispositivo = camposExtra.find((c) => c.usarComoDispositivo)

  // Same behavior as the create form: a field can stand in for the model, and
  // some fields suggest the brand from their value.
  const handleCampoExtraChange = (campo: CampoExtra, value: any) => {
    setCamposExtraValues((prev) => ({ ...prev, [campo.key]: value }))
    if (campo.usarComoDispositivo && typeof value === "string") setDispositivo(value)
    if (campo.autoMarca && typeof value === "string") {
      for (const [keyword, brand] of Object.entries(campo.autoMarca)) {
        if (value.includes(keyword)) {
          setMarca(brand)
          break
        }
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const imeiLimpio = imei.trim()
    if (imeiEsImei && imeiLimpio && imeiLimpio !== (orden.imei ?? "") && !isValidImei(imeiLimpio)) {
      setImeiError("El IMEI debe tener exactamente 15 dígitos")
      return
    }

    // Keys that are not fields of the type any more are kept: they are data the order already had.
    const metadata: Record<string, any> = {}
    for (const [key, val] of Object.entries(camposExtraValues)) {
      if (val !== "" && val !== undefined && val !== null) metadata[key] = val
    }

    const patch: Partial<CamposEquipo> = {
      dispositivo: dispositivo.trim(),
      marca: marca.trim() || null,
      color: color.trim() || null,
      imei: imeiLimpio || null,
      codigoAccesoDispositivo: codigoAcceso || null,
      metadata,
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/ordenes/${orden.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || "No pudimos guardar los datos del equipo")
        return
      }
      toast.success("Datos del equipo actualizados")
      onSaved(patch)
    } catch {
      toast.error("Error de conexión. Revisá tu internet e intentá de nuevo.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>Editar equipo</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          Tipo: {nombreTipo}. El tipo no se puede cambiar porque define el código de la orden.
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {showMarca && (
          <div className="space-y-1.5">
            <Label htmlFor="editar-marca">Marca</Label>
            <Input
              id="editar-marca"
              value={marca}
              onChange={(e) => setMarca(e.target.value)}
              placeholder="Ej: Apple, Samsung"
              list={marcasDisponibles.length > 0 ? "editar-marca-opciones" : undefined}
            />
            {marcasDisponibles.length > 0 && (
              <datalist id="editar-marca-opciones">
                {marcasDisponibles.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="editar-dispositivo">
            {campoDispositivo ? campoDispositivo.label : "Modelo / dispositivo"} *
          </Label>
          {campoDispositivo ? (
            <Select value={dispositivo} onValueChange={(v) => handleCampoExtraChange(campoDispositivo, v)}>
              <SelectTrigger id="editar-dispositivo">
                <SelectValue placeholder="Seleccionar..." />
              </SelectTrigger>
              <SelectContent>
                {/* An order created before the option list changed still shows its value. */}
                {Array.from(new Set([...(campoDispositivo.opciones || []), dispositivo].filter(Boolean))).map((op) => (
                  <SelectItem key={op} value={op}>
                    {op}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id="editar-dispositivo"
              value={dispositivo}
              onChange={(e) => setDispositivo(e.target.value)}
              placeholder="Modelo o descripción del equipo"
              required
            />
          )}
        </div>
      </div>

      <CamposExtraFields
        campos={camposExtra}
        values={camposExtraValues}
        config={config}
        onChange={handleCampoExtraChange}
      />

      {(showColor || showImei) && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {showColor && (
            <div className="space-y-1.5">
              <Label htmlFor="editar-color">Color</Label>
              <Input
                id="editar-color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="Ej: Negro, Azul"
              />
            </div>
          )}
          {showImei && (
            <div className="space-y-1.5">
              <Label htmlFor="editar-imei">{imeiLabel}</Label>
              <Input
                id="editar-imei"
                value={imei}
                onChange={(e) => {
                  setImei(imeiEsImei ? sanitizeImei(e.target.value) : e.target.value)
                  setImeiError("")
                }}
                placeholder={config.campos?.imei?.placeholder || "S/N del equipo"}
                maxLength={imeiEsImei ? 15 : config.campos?.imei?.maxLength}
                inputMode={imeiEsImei ? "numeric" : undefined}
                aria-invalid={!!imeiError || undefined}
                aria-describedby={imeiError ? "editar-imei-error" : undefined}
              />
              {imeiError && (
                <p id="editar-imei-error" className="text-sm text-destructive-text">
                  {imeiError}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* An order that already has a code shows it even if the type stopped asking for one. */}
      {(showPassword || codigoAcceso) && (
        <div className="space-y-1.5">
          <Label>Código de acceso</Label>
          {codigoAcceso ? (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCodigoModalOpen(true)}
                className="flex-1 justify-start font-normal"
                aria-label="Editar código de acceso"
              >
                <Lock className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{resumenCodigoAcceso(codigoAcceso)}</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setCodigoAcceso("")}
                aria-label="Quitar código de acceso"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => setCodigoModalOpen(true)}
              className="w-full justify-start font-normal text-muted-foreground"
            >
              <Lock className="mr-2 h-4 w-4" />
              Agregar código de acceso
            </Button>
          )}
          <CodigoAccesoModal
            open={codigoModalOpen}
            onOpenChange={setCodigoModalOpen}
            value={codigoAcceso}
            onChange={setCodigoAcceso}
          />
        </div>
      )}

      <ResponsiveDialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!dispositivo.trim()} loading={saving}>
          Guardar
        </Button>
      </ResponsiveDialogFooter>
    </form>
  )
}
