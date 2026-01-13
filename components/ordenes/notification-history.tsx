"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Mail,
  Clock,
  CheckCircle,
  XCircle,
  Bell,
} from "lucide-react"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"

interface NotificationLog {
  id: string
  tipo: string
  canal: string
  estado: string
  destinatario: string
  asunto?: string
  createdAt: string
  cliente: { nombre: string }
  orden?: { numeroOrden: number; codigoOrden?: string }
}

interface NotificationHistoryProps {
  ordenId: string
}

const tipoLabels: Record<string, string> = {
  CAMBIO_ESTADO: "Cambio de estado",
  PRESUPUESTO_DEFINIDO: "Presupuesto",
  GARANTIA_CREADA: "Garantia",
  RECORDATORIO_RETIRO: "Recordatorio",
}

function formatDateTime(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function NotificationHistory({ ordenId }: NotificationHistoryProps) {
  const [logs, setLogs] = useState<NotificationLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchLogs()
  }, [ordenId])

  const fetchLogs = async () => {
    try {
      const res = await fetch(`/api/notificaciones?ordenId=${ordenId}`)
      if (res.ok) {
        const data = await res.json()
        setLogs(data)
      }
    } catch (error) {
      console.error("Error fetching notification logs:", error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Historial de Notificaciones
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Cargando...</div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Historial de Notificaciones
        </CardTitle>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center">
            No hay notificaciones enviadas para esta orden
          </div>
        ) : (
          <div className="space-y-2">
            {logs.map((log) => (
              <div
                key={log.id}
                className="flex items-center gap-3 p-3 border rounded-lg"
              >
                <div className="flex-shrink-0">
                  {log.canal === "EMAIL" ? (
                    <Mail className="h-4 w-4 text-blue-600" />
                  ) : (
                    <WhatsAppIcon className="h-4 w-4 text-green-600" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">
                      {tipoLabels[log.tipo] || log.tipo}
                    </span>
                    <Badge
                      variant="outline"
                      className={
                        log.estado === "ENVIADO"
                          ? "text-green-700 border-green-300 bg-green-50"
                          : "text-red-700 border-red-300 bg-red-50"
                      }
                    >
                      {log.estado === "ENVIADO" ? (
                        <CheckCircle className="h-3 w-3 mr-1" />
                      ) : (
                        <XCircle className="h-3 w-3 mr-1" />
                      )}
                      {log.estado}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {log.destinatario}
                  </div>
                </div>

                <div className="text-xs text-muted-foreground flex items-center gap-1 whitespace-nowrap">
                  <Clock className="h-3 w-3" />
                  {formatDateTime(log.createdAt)}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
