"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useMoneda } from "@/hooks/use-moneda"
import { formatCurrencyValue } from "@/lib/currency"
import { fuentesPara, type ConfigMoneda, type FuenteTipoCambio } from "@/lib/currency/config-moneda"
import type { MonedaExtranjera } from "@/lib/currency/convert"
import type { ResultadoTipoCambio } from "@/lib/currency/tipo-cambio"

const CONFIG_URL = "/api/configuracion/moneda"
const SAVE_ERROR = "No se pudo guardar la configuración de moneda"

const FUENTE_LABEL: Record<FuenteTipoCambio, string> = {
  MANUAL: "Manual",
  OFICIAL: "Oficial",
  BLUE: "Blue",
  MEP: "MEP",
}
const MONEDAS: ReadonlyArray<{ value: MonedaExtranjera; label: string }> = [
  { value: "USD", label: "US$ Dólar (USD)" },
  { value: "EUR", label: "€ Euro (EUR)" },
]
const REDONDEOS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: "Sin redondeo" },
  { value: 1, label: "Al entero" },
  { value: 10, label: "A la decena" },
  { value: 100, label: "A la centena" },
]

const SELECT_CLASS =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"

interface Draft {
  habilitada: boolean
  monedaExtranjera: MonedaExtranjera
  fuente: FuenteTipoCambio
  tipoCambioManual: string
  redondeoConversion: number
}

function draftDe(config: ConfigMoneda): Draft {
  return {
    habilitada: config.habilitada,
    monedaExtranjera: config.monedaExtranjera,
    fuente: config.fuente,
    tipoCambioManual: config.tipoCambioManual == null ? "" : String(config.tipoCambioManual).replace(".", ","),
    redondeoConversion: config.redondeoConversion,
  }
}

/** Una org argentina es la que ofrece fuentes distintas de la manual. */
function opcionesDeFuente(config: ConfigMoneda, moneda: MonedaExtranjera): FuenteTipoCambio[] {
  const esAR = config.fuentesDisponibles.some((f) => f === "BLUE" || f === "OFICIAL")
  return fuentesPara(esAR ? "AR" : null, moneda)
}

function hace(en: string): string {
  const minutos = Math.max(0, Math.floor((Date.now() - new Date(en).getTime()) / 60_000))
  if (minutos < 1) return "instantes"
  if (minutos < 60) return `${minutos} min`
  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `${horas} h`
  return `${Math.floor(horas / 24)} d`
}

function CotizacionVigente({ tipoCambio, config }: { tipoCambio: ResultadoTipoCambio | undefined; config: ConfigMoneda }) {
  if (!tipoCambio || (!tipoCambio.disponible && tipoCambio.motivo === "DESHABILITADA")) return null
  if (!tipoCambio.disponible) {
    return (
      <p className="text-sm text-warning-700" role="status">
        No hay cotización disponible: cargá una manual.
      </p>
    )
  }
  if (tipoCambio.estado === "referencia") {
    return (
      <p className="text-sm text-warning-700" role="status">
        Cotización de hace {hace(tipoCambio.en)}
      </p>
    )
  }
  return (
    <p className="text-sm text-muted-foreground" role="status">
      {FUENTE_LABEL[tipoCambio.fuente]} · {formatCurrencyValue(tipoCambio.valor, config.monedaLocal)} · hace{" "}
      {hace(tipoCambio.en)}
    </p>
  )
}

export function MonedaConfig({ allowEdit }: { allowEdit: boolean }) {
  const { config, tipoCambio, itemsEnDivisa, isLoading, mutate } = useMoneda()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState(false)

  // Seed the editable copy once; later revalidations never overwrite edits.
  useEffect(() => {
    if (config && !draft) setDraft(draftDe(config))
  }, [config, draft])

  if (isLoading || (config && !draft)) {
    return (
      <Card>
        <CardContent className="p-4 sm:p-6 text-sm text-muted-foreground" role="status">
          Cargando...
        </CardContent>
      </Card>
    )
  }

  if (!config || !draft) {
    return (
      <Card>
        <CardContent className="p-4 sm:p-6 text-sm text-destructive-text" role="alert">
          No se pudo cargar la configuración de moneda.
        </CardContent>
      </Card>
    )
  }

  const disabled = !allowEdit || saving
  const patch = (changes: Partial<Draft>) => setDraft({ ...draft, ...changes })
  const opciones = opcionesDeFuente(config, draft.monedaExtranjera)
  const preciosEnDivisa = itemsEnDivisa ? itemsEnDivisa.inventario + itemsEnDivisa.servicios : 0
  const apagando = config.habilitada && !draft.habilitada && preciosEnDivisa > 0

  const cambiarMoneda = (monedaExtranjera: MonedaExtranjera) => {
    const nuevas = opcionesDeFuente(config, monedaExtranjera)
    const fuente = nuevas.includes(draft.fuente) ? draft.fuente : (nuevas.find((f) => f !== "MANUAL") ?? "MANUAL")
    patch({ monedaExtranjera, fuente })
  }

  const guardar = async () => {
    setConfirmando(false)
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(CONFIG_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          habilitada: draft.habilitada,
          monedaExtranjera: draft.monedaExtranjera,
          fuente: draft.fuente,
          tipoCambioManual: draft.fuente === "MANUAL" && draft.tipoCambioManual.trim() !== "" ? draft.tipoCambioManual.trim() : null,
          redondeoConversion: draft.redondeoConversion,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const mensaje = typeof body?.error === "string" && body.error ? body.error : SAVE_ERROR
        setError(mensaje)
        toast.error(mensaje)
        return
      }
      if (body?.config) setDraft(draftDe(body.config as ConfigMoneda))
      toast.success("Configuración de moneda guardada")
    } catch {
      setError(SAVE_ERROR)
      toast.error(SAVE_ERROR)
      return
    } finally {
      setSaving(false)
    }
    // Already saved: a failed revalidation must not look like a failed save.
    await mutate().catch(() => undefined)
  }

  const onGuardar = () => (apagando ? setConfirmando(true) : void guardar())
  const errorManual = error && draft.habilitada && draft.fuente === "MANUAL"

  return (
    <Card>
      <CardHeader className="p-4 sm:p-6">
        <CardTitle className="text-base sm:text-lg">Moneda extranjera</CardTitle>
        <CardDescription className="text-xs sm:text-sm">
          Permite poner precios y cobrar en una segunda moneda. La cotización convierte esos precios a {config.monedaLocal}.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4 sm:p-6 pt-0 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="moneda-habilitada">Habilitar moneda extranjera</Label>
          <Switch
            id="moneda-habilitada"
            checked={draft.habilitada}
            onCheckedChange={(habilitada) => patch({ habilitada })}
            disabled={disabled}
          />
        </div>

        {draft.habilitada && (
          <>
            <div className="space-y-2">
              <Label htmlFor="moneda-extranjera">Moneda extranjera</Label>
              <select
                id="moneda-extranjera"
                className={SELECT_CLASS}
                value={draft.monedaExtranjera}
                onChange={(e) => cambiarMoneda(e.target.value as MonedaExtranjera)}
                disabled={disabled}
              >
                {MONEDAS.map((m) => (
                  <option key={m.value} value={m.value} disabled={m.value === config.monedaLocal}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="moneda-fuente">Fuente de la cotización</Label>
              <select
                id="moneda-fuente"
                className={SELECT_CLASS}
                value={draft.fuente}
                onChange={(e) => patch({ fuente: e.target.value as FuenteTipoCambio })}
                disabled={disabled}
              >
                {opciones.map((f) => (
                  <option key={f} value={f}>
                    {FUENTE_LABEL[f]}
                  </option>
                ))}
              </select>
            </div>

            {draft.fuente === "MANUAL" && (
              <div className="space-y-2">
                <Label htmlFor="moneda-manual">Cotización manual</Label>
                <Input
                  id="moneda-manual"
                  inputMode="decimal"
                  value={draft.tipoCambioManual}
                  onChange={(e) => patch({ tipoCambioManual: e.target.value })}
                  aria-invalid={errorManual ? true : undefined}
                  aria-describedby={errorManual ? "moneda-error" : undefined}
                  disabled={disabled}
                  className="w-40"
                />
                {errorManual && (
                  <p id="moneda-error" className="text-xs text-destructive-text" role="alert">
                    {error}
                  </p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="moneda-redondeo">Redondeo de la conversión</Label>
              <select
                id="moneda-redondeo"
                className={SELECT_CLASS}
                value={draft.redondeoConversion}
                onChange={(e) => patch({ redondeoConversion: Number(e.target.value) })}
                disabled={disabled}
              >
                {REDONDEOS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            {config.habilitada && <CotizacionVigente tipoCambio={tipoCambio} config={config} />}
          </>
        )}

        {error && !errorManual && (
          <p className="text-xs text-destructive-text" role="alert">
            {error}
          </p>
        )}

        {allowEdit && (
          <Button
            onClick={onGuardar}
            disabled={saving}
            className="w-full sm:w-auto transition-transform duration-150 ease-out active:scale-[0.97]"
          >
            <Save className="mr-2 h-4 w-4" />
            Guardar
          </Button>
        )}
      </CardContent>

      <ConfirmDialog
        open={confirmando}
        onOpenChange={setConfirmando}
        title="¿Apagar la moneda extranjera?"
        description={`${itemsEnDivisa?.inventario ?? 0} productos y ${itemsEnDivisa?.servicios ?? 0} servicios tienen precio en ${config.monedaExtranjera}. Si la apagás, esos precios dejan de convertirse.`}
        variant="warning"
        confirmText="Confirmar"
        onConfirm={() => void guardar()}
      />
    </Card>
  )
}
