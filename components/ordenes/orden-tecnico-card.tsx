"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Wrench } from "lucide-react"
import type { User } from "@/types"

interface OrdenTecnicoCardProps {
  tecnicoId: string | null | undefined
  tecnicos: User[]
  updating: boolean
  onAsignarTecnico: (tecnicoId: string | null) => void
  readOnly?: boolean
}

export function OrdenTecnicoCard({
  tecnicoId,
  tecnicos,
  updating,
  onAsignarTecnico,
  readOnly,
}: OrdenTecnicoCardProps) {
  const tecnicoAsignado = tecnicos.find(t => t.id === tecnicoId)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Wrench className="h-4 w-4" />
          Técnico Asignado
        </CardTitle>
      </CardHeader>
      <CardContent>
        {readOnly ? (
          <p className="text-sm text-foreground">
            {tecnicoAsignado?.nombre || "Sin asignar"}
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
              {tecnicos.map((tecnico) => (
                <SelectItem key={tecnico.id} value={tecnico.id}>
                  {tecnico.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </CardContent>
    </Card>
  )
}
