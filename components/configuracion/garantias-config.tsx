"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { GARANTIA_TERMINOS_MAX, VENTANA_CONFIG_MIN } from "@/lib/garantias/config"
import { VENTANA_POR_VENCER_MAX } from "@/lib/garantias/estado"

export interface GarantiasConfigValor {
  terminos: string
  /** Texto del input: se valida al guardar. */
  ventanaPorVencer: string
  avisoVencimiento: boolean
}

interface GarantiasConfigProps {
  valor: GarantiasConfigValor
  onChange: (valor: GarantiasConfigValor) => void
  allowEdit: boolean
}

/**
 * Términos de garantía, ventana "por vencer" y aviso al cliente (migración
 * 402). Controlado: lo guarda la barra de guardado de Configuración junto con
 * el resto del formulario, contra /api/configuracion/garantias.
 */
export function GarantiasConfig({ valor, onChange, allowEdit }: GarantiasConfigProps) {
  const set = (parcial: Partial<GarantiasConfigValor>) => onChange({ ...valor, ...parcial })
  const ventana = valor.ventanaPorVencer.trim() || "7"

  return (
    <Card>
      <CardHeader className="p-4 sm:p-6">
        <CardTitle className="text-base sm:text-lg">Garantías</CardTitle>
        <CardDescription className="text-xs sm:text-sm">
          Términos que se imprimen en el comprobante de entrega y en el certificado de garantía, y cuándo una garantía
          pasa a estar por vencer.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4 sm:p-6 pt-0 space-y-4">
        <div>
          <Label htmlFor="garantiaTerminos" className="text-sm">
            Términos de garantía
          </Label>
          <Textarea
            id="garantiaTerminos"
            value={valor.terminos}
            onChange={(e) => set({ terminos: e.target.value.slice(0, GARANTIA_TERMINOS_MAX) })}
            placeholder={
              "Ej: La garantía cubre la falla reparada y el repuesto colocado. No cubre golpes, humedad ni equipos abiertos por terceros. Para reclamarla, traé el equipo con este comprobante."
            }
            rows={5}
            maxLength={GARANTIA_TERMINOS_MAX}
            disabled={!allowEdit}
          />
          <div className="mt-1 flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-4">
            <p className="text-xs sm:text-sm text-muted-foreground">
              Se suman a las condiciones que escribís en cada entrega, no las reemplazan. Si lo dejás vacío, el
              comprobante solo lleva las condiciones de la entrega.
            </p>
            <p className="text-xs text-muted-foreground tabular-nums shrink-0">
              {valor.terminos.length}/{GARANTIA_TERMINOS_MAX}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t">
          <div>
            <Label htmlFor="garantiaVentanaPorVencer" className="text-sm">
              Ventana &quot;por vencer&quot; (días)
            </Label>
            <Input
              id="garantiaVentanaPorVencer"
              type="number"
              inputMode="numeric"
              min={VENTANA_CONFIG_MIN}
              max={VENTANA_POR_VENCER_MAX}
              value={valor.ventanaPorVencer}
              onChange={(e) => set({ ventanaPorVencer: e.target.value })}
              placeholder="7"
              disabled={!allowEdit}
            />
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground sm:col-span-2 sm:self-end">
            Una garantía que vence en los próximos {ventana} días aparece en la pestaña Por vencer de Garantías y en
            la tarjeta del inicio.
          </p>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div className="space-y-0.5">
            <Label htmlFor="garantiaAvisoVencimiento" className="text-sm font-medium">
              Avisarle al cliente antes de que venza
            </Label>
            <p className="text-xs text-muted-foreground">
              Le mandamos un aviso por email o WhatsApp (según tus avisos) una sola vez, cuando la garantía entra en la
              ventana de {ventana} días. No se avisa por garantías anuladas, vencidas ni con un reclamo abierto.
            </p>
          </div>
          <Switch
            id="garantiaAvisoVencimiento"
            checked={valor.avisoVencimiento}
            onCheckedChange={(v) => set({ avisoVencimiento: v })}
            disabled={!allowEdit}
            className="mt-1"
          />
        </div>
      </CardContent>
    </Card>
  )
}
