import { Building2, Mail, Phone, User } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import type { SectorCliente } from "@/types"

interface Props {
  sectores: SectorCliente[]
}

export function ClienteSectores({ sectores }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sectores</CardTitle>
      </CardHeader>
      <CardContent>
        {sectores.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="Sin sectores"
            description="Esta empresa no tiene sectores registrados."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {sectores.map((sector) => (
              <div
                key={sector.id}
                className="rounded-lg border bg-muted/30 p-4 space-y-2"
              >
                <p className="font-medium text-sm">{sector.nombre}</p>
                {sector.contactoNombre && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <User className="h-3.5 w-3.5 shrink-0" />
                    <span>{sector.contactoNombre}</span>
                  </div>
                )}
                {sector.contactoTelefono && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="h-3.5 w-3.5 shrink-0" />
                    <span>{sector.contactoTelefono}</span>
                  </div>
                )}
                {sector.contactoEmail && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Mail className="h-3.5 w-3.5 shrink-0" />
                    <span>{sector.contactoEmail}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
