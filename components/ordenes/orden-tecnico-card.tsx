"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Wrench } from "lucide-react"
import type { User } from "@/types"

interface OrdenTecnicoCardProps {
  tecnicoId: string | null | undefined
  /** The technicians of the branch that handles the order. */
  tecnicos: User[]
  /**
   * Who has the order now. Added to the options when they are not in `tecnicos`, so an
   * assignee from another branch (legacy) still shows instead of "Sin asignar".
   */
  tecnicoActual?: { id: string; nombre: string } | null
  updating: boolean
  onAsignarTecnico: (tecnicoId: string | null) => void
  readOnly?: boolean
  /** A TECNICO may take this unassigned order (opt-in org permission). */
  puedeTomar?: boolean
  onTomar?: () => void
}

export function OrdenTecnicoCard({
  tecnicoId,
  tecnicos,
  tecnicoActual,
  updating,
  onAsignarTecnico,
  readOnly,
  puedeTomar,
  onTomar,
}: OrdenTecnicoCardProps) {
  const asignadoFueraDeLista = !!tecnicoActual && tecnicoActual.id === tecnicoId && !tecnicos.some(t => t.id === tecnicoId)
  const opciones: Array<{ id: string; nombre: string }> = asignadoFueraDeLista ? [...tecnicos, tecnicoActual] : tecnicos
  // Marked, so that choosing "Sin asignar" or another technician later is not a surprise.
  const etiqueta = (t: { id: string; nombre: string }) => (asignadoFueraDeLista && t.id === tecnicoId ? `${t.nombre} · otra sucursal` : t.nombre)
  const tecnicoAsignado = opciones.find(t => t.id === tecnicoId)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Wrench className="h-4 w-4" />
          Técnico Asignado
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {puedeTomar && onTomar && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Esta orden no tiene técnico asignado.
            </p>
            <Button size="sm" onClick={onTomar} disabled={updating}>
              Tomar orden
            </Button>
          </div>
        )}
        {readOnly ? (
          <p className="text-sm text-foreground">
            {tecnicoAsignado ? etiqueta(tecnicoAsignado) : "Sin asignar"}
          </p>
        ) : (
          <Select
            value={tecnicoId || "none"}
            onValueChange={(value) => onAsignarTecnico(value === "none" ? null : value)}
            disabled={updating}
          >
            <SelectTrigger>
              <SelectValue placeholder="Sin asignar" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Sin asignar</SelectItem>
              {opciones.map((tecnico) => (
                <SelectItem key={tecnico.id} value={tecnico.id}>
                  {etiqueta(tecnico)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </CardContent>
    </Card>
  )
}
