import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { OrderStatusBadge } from "@/components/ui/badge"
import { Clock, ArrowRight } from "lucide-react"

interface OrdenReciente {
  id: string
  numeroOrden: number
  codigoOrden?: string | null
  cliente: string
  dispositivo: string
  estado: string
  fechaIngreso: string
}

interface OrdenesRecientesProps {
  ordenes: OrdenReciente[]
}

export function OrdenesRecientes({ ordenes }: OrdenesRecientesProps) {
  const formatFecha = (fecha: string) => {
    const date = new Date(fecha)
    const ahora = new Date()
    const diffMs = ahora.getTime() - date.getTime()
    const diffHoras = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDias = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffHoras < 1) return "Hace menos de 1 hora"
    if (diffHoras < 24) return `Hace ${diffHoras} hora${diffHoras !== 1 ? "s" : ""}`
    if (diffDias < 7) return `Hace ${diffDias} día${diffDias !== 1 ? "s" : ""}`
    return date.toLocaleDateString("es-AR", { day: "numeric", month: "short" })
  }

  if (ordenes.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Órdenes Recientes</CardTitle>
          <CardDescription>Últimas órdenes de servicio</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            No hay órdenes registradas
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Órdenes Recientes</CardTitle>
            <CardDescription>Últimas órdenes de servicio</CardDescription>
          </div>
          <Link
            href="/ordenes"
            className="text-sm text-primary hover:underline flex items-center gap-1"
          >
            Ver todas
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {ordenes.map((orden) => (
          <Link
            key={orden.id}
            href={`/ordenes/${orden.id}`}
            className="block p-3 rounded-lg border hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">
                    #{orden.codigoOrden || orden.numeroOrden}
                  </span>
                  <OrderStatusBadge status={orden.estado} showIcon={false} />
                </div>
                <p className="text-sm text-muted-foreground truncate mt-1">
                  {orden.cliente}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {orden.dispositivo}
                </p>
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                <Clock className="h-3 w-3" />
                {formatFecha(orden.fechaIngreso)}
              </div>
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}
