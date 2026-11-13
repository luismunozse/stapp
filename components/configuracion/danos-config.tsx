"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

interface DanosConfigProps {
  obligatorio: boolean
  onChange: (obligatorio: boolean) => void
  allowEdit: boolean
}

/**
 * Exigir el estado físico del equipo al crear una orden (migración 408).
 * Controlado: lo guarda la barra de guardado de Configuración, contra
 * /api/configuracion/danos.
 */
export function DanosConfig({ obligatorio, onChange, allowEdit }: DanosConfigProps) {
  return (
    <Card>
      <CardHeader className="p-4 sm:p-6">
        <CardTitle className="text-base sm:text-lg">Estado físico en la recepción</CardTitle>
        <CardDescription className="text-xs sm:text-sm">
          Registro de golpes, rayas y otros daños del equipo al recibirlo.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4 sm:p-6 pt-0">
        <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div className="space-y-0.5">
            <Label htmlFor="danosRecepcionObligatorio" className="text-sm font-medium">
              Exigir estado físico al recibir un equipo
            </Label>
            <p className="text-xs text-muted-foreground">
              Si está activo, no se puede crear una orden sin marcar los daños o indicar «Sin daños visibles».
            </p>
          </div>
          <Switch
            id="danosRecepcionObligatorio"
            checked={obligatorio}
            onCheckedChange={onChange}
            disabled={!allowEdit}
            className="mt-1"
          />
        </div>
      </CardContent>
    </Card>
  )
}
