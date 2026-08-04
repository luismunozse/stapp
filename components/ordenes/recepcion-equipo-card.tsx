"use client"

import { z } from "zod"
import type { UseFormRegister, FieldErrors } from "react-hook-form"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Trash2 } from "lucide-react"
import { useTipoDispositivoConfig } from "@/hooks/use-tipo-dispositivo-config"
import { TipoDispositivoPicker } from "./tipo-dispositivo-picker"
import { CamposExtraFields } from "./campos-extra-fields"
import { AccesoriosPicker } from "./accesorios-picker"
import { FotosIngreso, type FotoPreview } from "./fotos-ingreso"
import type { CampoExtra, TipoDispositivoCustom } from "@/types"

/**
 * Schema y tipo de un equipo individual dentro de la recepcion multiple.
 * Vive aca (no en recepcion-form.tsx) porque es el modelo propio de esta
 * card; recepcion-form.tsx lo importa para armar el array `equipos`.
 */
export const equipoFormSchema = z.object({
  dispositivo: z.string().min(1, "Requerido"),
  tipoDispositivo: z.string().min(1, "Elegi el tipo"),
  marca: z.string().optional(),
  color: z.string().optional(),
  imei: z.string().optional(),
  problemaReportado: z.string().min(1, "Requerido"),
  codigoAccesoDispositivo: z.string().optional(),
})

export type EquipoFormValues = z.infer<typeof equipoFormSchema>

interface RecepcionEquipoCardProps {
  index: number
  tipos: TipoDispositivoCustom[]
  tiposLoading: boolean
  tipoSeleccionado: string
  onTipoChange: (codigo: string) => void
  register: UseFormRegister<any>
  errors?: FieldErrors<EquipoFormValues>
  puedeQuitar: boolean
  onQuitar: () => void
  accesoriosSeleccionados: string[]
  onToggleAccesorio: (id: string) => void
  otroAccesorio: string
  onOtroAccesorioChange: (value: string) => void
  onOtroAccesorioAdd: () => void
  camposExtraValues: Record<string, any>
  onCampoExtraChange: (campo: CampoExtra, value: any) => void
  onProblemaQuickSelect: (texto: string) => void
  fotos: FotoPreview[]
  comprimiendo: boolean
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onRemoveFoto: (id: string) => void
  onFotoDescripcionChange: (id: string, value: string) => void
  labelFotos: string
}

/**
 * Card de un equipo dentro de la recepcion multiple. Es su propio componente
 * (no un fragmento inline dentro de un .map()) porque necesita llamar a
 * useTipoDispositivoConfig con el tipo propio de este equipo, y la cantidad
 * de cards cambia cuando el mostrador agrega o quita un equipo. Un hook
 * llamado dentro de un .map() rompe las reglas de hooks de React porque la
 * cantidad de llamadas variaria entre renders.
 */
export function RecepcionEquipoCard(props: RecepcionEquipoCardProps) {
  const cfg = useTipoDispositivoConfig(props.tipos, props.tipoSeleccionado)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Equipo {props.index + 1}</CardTitle>
        {props.puedeQuitar && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={props.onQuitar}
            aria-label={`Quitar equipo ${props.index + 1}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <TipoDispositivoPicker
          tipos={props.tipos}
          value={props.tipoSeleccionado}
          onChange={props.onTipoChange}
          loading={props.tiposLoading}
          error={props.errors?.tipoDispositivo?.message}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label>Equipo *</Label>
            <Input {...props.register(`equipos.${props.index}.dispositivo`)} placeholder="Ej: iPhone 13" />
            {props.errors?.dispositivo && (
              <p className="text-sm text-destructive mt-1">{props.errors.dispositivo.message}</p>
            )}
          </div>
          {cfg.showMarca && (
            <div>
              <Label>Marca</Label>
              <Input {...props.register(`equipos.${props.index}.marca`)} placeholder="Ej: Apple" />
            </div>
          )}
          {cfg.showColor && (
            <div>
              <Label>Color</Label>
              <Input {...props.register(`equipos.${props.index}.color`)} />
            </div>
          )}
          {cfg.showImei && (
            <div>
              <Label>{cfg.config.campos?.imei?.label || "IMEI / Serie"}</Label>
              <Input
                {...props.register(`equipos.${props.index}.imei`)}
                placeholder={cfg.config.campos?.imei?.placeholder}
              />
            </div>
          )}
          {cfg.showPassword && (
            <div>
              <Label>Codigo de acceso</Label>
              <Input {...props.register(`equipos.${props.index}.codigoAccesoDispositivo`)} />
            </div>
          )}
        </div>

        <CamposExtraFields
          campos={cfg.camposExtra}
          values={props.camposExtraValues}
          config={cfg.config}
          onChange={props.onCampoExtraChange}
        />

        <div>
          <Label>Falla reportada *</Label>
          <Textarea {...props.register(`equipos.${props.index}.problemaReportado`)} rows={2} />
          {props.errors?.problemaReportado && (
            <p className="text-sm text-destructive mt-1">{props.errors.problemaReportado.message}</p>
          )}
          {cfg.problemasComunes.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {cfg.problemasComunes.slice(0, 6).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => props.onProblemaQuickSelect(p)}
                  className="px-2 py-0.5 text-xs rounded border hover:bg-muted"
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>

        <AccesoriosPicker
          disponibles={cfg.accesoriosDisponibles}
          seleccionados={props.accesoriosSeleccionados}
          onToggle={props.onToggleAccesorio}
          otro={props.otroAccesorio}
          onOtroChange={props.onOtroAccesorioChange}
          onOtroAdd={props.onOtroAccesorioAdd}
        />

        <FotosIngreso
          label={props.labelFotos}
          fotos={props.fotos}
          comprimiendo={props.comprimiendo}
          onFileChange={props.onFileChange}
          onRemove={props.onRemoveFoto}
          onDescripcionChange={props.onFotoDescripcionChange}
        />
      </CardContent>
    </Card>
  )
}
