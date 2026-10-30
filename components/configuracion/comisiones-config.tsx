"use client"

import { useEffect, useState } from "react"
import useSWR from "swr"
import { toast } from "sonner"
import { Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  BASE_OPTIONS,
  ORDER_ACCRUAL_OPTIONS,
  commissionConfigSchema,
  type CommissionConfig,
} from "@/lib/commissions/config"
import type { CommissionBaseKind } from "@/lib/commissions/types"

const CONFIG_URL = "/api/comisiones/config"
const SAVE_ERROR = "No se pudieron guardar las reglas"
const RATE_ERROR = "Ingrese un porcentaje entre 0 y 100."

// The raw text of a number input is "" when the browser rejects what was typed (a comma, letters).
function parseRate(text: string): number | null {
  if (text.trim() === "") return null
  const value = Number(text)
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null
}

const OPTION_CLASS =
  "flex items-start gap-3 p-3 rounded-lg border transition-colors duration-150 ease-out has-[:checked]:border-primary has-[:checked]:bg-accent/40 has-[:disabled]:opacity-60"
const OPTION_ENABLED_CLASS = "cursor-pointer hover:bg-accent/40"
const INPUT_CLASS = "mt-1 h-4 w-4 border-border text-primary focus:ring-primary"

// Resolves to the parsed rule set, or null when the route answered an error or an unexpected shape.
async function fetchConfig(url: string): Promise<CommissionConfig | null> {
  const res = await fetch(url)
  if (!res.ok) return null
  const parsed = commissionConfigSchema.safeParse(await res.json())
  return parsed.success ? parsed.data : null
}

interface ChoiceGroupProps<T extends string> {
  legend: string
  name: string
  value: T
  options: ReadonlyArray<{ value: T; label: string; implica: string }>
  disabled: boolean
  onChange: (value: T) => void
}

function ChoiceGroup<T extends string>({ legend, name, value, options, disabled, onChange }: ChoiceGroupProps<T>) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium mb-2">{legend}</legend>
      {options.map((option) => (
        <label key={option.value} className={`${OPTION_CLASS} ${disabled ? "" : OPTION_ENABLED_CLASS}`}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            disabled={disabled}
            className={INPUT_CLASS}
          />
          <span className="flex-1">
            <span className="block text-sm font-medium">{option.label}</span>
            <span className="block text-xs text-muted-foreground mt-0.5">{option.implica}</span>
          </span>
        </label>
      ))}
    </fieldset>
  )
}

interface FlagProps {
  label: string
  help: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}

function Flag({ label, help, checked, disabled, onChange }: FlagProps) {
  return (
    <label className={`${OPTION_CLASS} ${disabled ? "" : OPTION_ENABLED_CLASS}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className={`${INPUT_CLASS} rounded`}
      />
      <span className="flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground mt-0.5">{help}</span>
      </span>
    </label>
  )
}

export function ComisionesConfig({ allowEdit }: { allowEdit: boolean }) {
  const { data, isLoading, mutate } = useSWR(CONFIG_URL, fetchConfig, { revalidateOnFocus: false })
  const [draft, setDraft] = useState<CommissionConfig | null>(null)
  // Raw text of the number input, so a half-typed value ("", "1.") is not rewritten under the cursor.
  const [rateText, setRateText] = useState("")
  const [saving, setSaving] = useState(false)

  // Seed the editable copy once the server rules arrive; later revalidations never overwrite edits.
  useEffect(() => {
    if (data && !draft) {
      setDraft(data)
      setRateText(String(data.recepcionPorcentajeDefault))
    }
  }, [data, draft])

  if (isLoading || (data && !draft)) {
    return (
      <Card>
        <CardContent className="p-4 sm:p-6 text-sm text-muted-foreground" role="status">
          Cargando...
        </CardContent>
      </Card>
    )
  }

  if (!data || !draft) {
    return (
      <Card>
        <CardContent className="p-4 sm:p-6 text-sm text-destructive" role="alert">
          No se pudieron cargar las reglas de comisiones.
        </CardContent>
      </Card>
    )
  }

  const disabled = !allowEdit || saving
  const rateInvalid = parseRate(rateText) === null
  const patch = (changes: Partial<CommissionConfig>) => setDraft({ ...draft, ...changes })

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch(CONFIG_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(typeof body?.error === "string" && body.error ? body.error : SAVE_ERROR)
        return
      }
      const saved = commissionConfigSchema.safeParse(body)
      if (saved.success) {
        setDraft(saved.data)
        setRateText(String(saved.data.recepcionPorcentajeDefault))
      }
      toast.success("Reglas de comisiones guardadas")
    } catch {
      toast.error(SAVE_ERROR)
      return
    } finally {
      setSaving(false)
    }
    // The rules are already saved: a failed revalidation must not look like a failed save.
    await mutate().catch(() => undefined)
  }

  return (
    <Card>
      <CardHeader className="p-4 sm:p-6">
        <CardTitle className="text-base sm:text-lg">Comisiones de reparaciones</CardTitle>
        <CardDescription className="text-xs sm:text-sm">
          Estas reglas definen cuándo y sobre qué monto ganan comisión el técnico y la persona que recibió el equipo. Un
          cambio recalcula las comisiones pendientes; las ya pagadas no cambian.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4 sm:p-6 pt-0 space-y-6">
        <div className="space-y-2">
          <ChoiceGroup<CommissionConfig["ordenDevengo"]>
            legend="Cuándo se genera la comisión"
            name="comision-orden-devengo"
            value={draft.ordenDevengo}
            options={ORDER_ACCRUAL_OPTIONS}
            disabled={disabled}
            onChange={(ordenDevengo) => patch({ ordenDevengo })}
          />
          <p className="text-xs text-muted-foreground">
            Las reparaciones fiadas y las exprés todavía no quedan cobradas por completo: con una regla que pide cobro,
            no generan comisión.
          </p>
        </div>

        <div className="space-y-2">
          <ChoiceGroup<CommissionBaseKind>
            legend="Base del técnico"
            name="comision-tecnico-base"
            value={draft.tecnicoBase}
            options={BASE_OPTIONS}
            disabled={disabled}
            onChange={(tecnicoBase) => patch({ tecnicoBase })}
          />
        </div>

        <div className="space-y-2">
          <ChoiceGroup<CommissionBaseKind>
            legend="Base de recepción"
            name="comision-recepcion-base"
            value={draft.recepcionBase}
            options={BASE_OPTIONS}
            disabled={disabled}
            onChange={(recepcionBase) => patch({ recepcionBase })}
          />
          <p className="text-xs text-muted-foreground">
            Monto de la orden: costo final menos descuentos y notas de crédito. No incluye el recargo por pago con
            tarjeta.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="comision-recepcion-porcentaje">Porcentaje de recepción por defecto</Label>
          <div className="flex items-center gap-2">
            <Input
              id="comision-recepcion-porcentaje"
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step="0.01"
              value={rateText}
              onChange={(e) => {
                setRateText(e.target.value)
                const rate = parseRate(e.target.value)
                if (rate !== null) patch({ recepcionPorcentajeDefault: rate })
              }}
              aria-invalid={rateInvalid}
              aria-describedby={rateInvalid ? "comision-recepcion-ayuda comision-recepcion-error" : "comision-recepcion-ayuda"}
              disabled={disabled}
              className="w-24"
            />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
          {rateInvalid && (
            <p id="comision-recepcion-error" className="text-xs text-destructive" role="alert">
              {RATE_ERROR}
            </p>
          )}
          <p id="comision-recepcion-ayuda" className="text-xs text-muted-foreground">
            Se aplica a quien recibe un equipo y no tiene un porcentaje de recepción propio. Con 0, la recepción no
            genera comisión. Cada orden guarda el porcentaje vigente al recibirla: un cambio no modifica órdenes ya
            recibidas. También se aplica a los administradores que reciben equipos.
          </p>
        </div>

        <div className="space-y-2">
          <Flag
            label="Los reingresos por garantía generan comisión"
            help="Incluye las órdenes creadas desde un reclamo de garantía. Un reingreso no tiene comisión de recepción."
            checked={draft.reingresoComisiona}
            disabled={disabled}
            onChange={(reingresoComisiona) => patch({ reingresoComisiona })}
          />
          <Flag
            label="Las órdenes entregadas sin reparar generan comisión"
            help="Vale para el técnico y para la persona que recibió el equipo."
            checked={draft.sinReparacionComisiona}
            disabled={disabled}
            onChange={(sinReparacionComisiona) => patch({ sinReparacionComisiona })}
          />
        </div>

        <Button
          onClick={handleSave}
          disabled={disabled || rateInvalid}
          className="w-full sm:w-auto transition-transform duration-150 ease-out active:scale-[0.97]"
        >
          <Save className="mr-2 h-4 w-4" />
          Guardar reglas
        </Button>
      </CardContent>
    </Card>
  )
}
