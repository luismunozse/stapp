"use client"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { formatDistanceToNow } from "date-fns"
import { es } from "date-fns/locale"
import { CheckCircle2, XCircle, Edit, Plus } from "lucide-react"
import type { PlanAudit } from "@/types/superadmin"

interface AuditTimelineProps {
  auditLogs: PlanAudit[]
}

export function AuditTimeline({ auditLogs }: AuditTimelineProps) {
  const getActionIcon = (action: string) => {
    switch (action) {
      case "CREATE":
        return <Plus className="h-5 w-5 text-green-600" />
      case "UPDATE":
        return <Edit className="h-5 w-5 text-blue-600" />
      case "ENABLE":
        return <CheckCircle2 className="h-5 w-5 text-green-600" />
      case "DISABLE":
        return <XCircle className="h-5 w-5 text-red-600" />
      default:
        return <Edit className="h-5 w-5 text-gray-600" />
    }
  }

  const getActionLabel = (action: string) => {
    switch (action) {
      case "CREATE":
        return "Creación"
      case "UPDATE":
        return "Actualización"
      case "ENABLE":
        return "Activación"
      case "DISABLE":
        return "Desactivación"
      default:
        return action
    }
  }

  const getActionColor = (action: string) => {
    switch (action) {
      case "CREATE":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300"
      case "UPDATE":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300"
      case "ENABLE":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300"
      case "DISABLE":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300"
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300"
    }
  }

  const getChanges = (log: PlanAudit) => {
    if (!log.before_data || !log.after_data) return []

    const before = log.before_data as Record<string, any>
    const after = log.after_data as Record<string, any>
    const changes: Array<{ field: string; from: any; to: any }> = []

    // Campos relevantes para mostrar
    const relevantFields = [
      "nombre",
      "descripcion",
      "precio_mensual",
      "precio_anual",
      "limite_ordenes",
      "limite_tecnicos",
      "limite_clientes",
      "limite_storage_mb",
      "features",
      "activo",
    ]

    relevantFields.forEach((field) => {
      if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) {
        changes.push({
          field,
          from: before[field],
          to: after[field],
        })
      }
    })

    return changes
  }

  const formatFieldName = (field: string) => {
    const names: Record<string, string> = {
      nombre: "Nombre",
      descripcion: "Descripción",
      precio_mensual: "Precio Mensual",
      precio_anual: "Precio Anual",
      limite_ordenes: "Límite Órdenes",
      limite_tecnicos: "Límite Técnicos",
      limite_clientes: "Límite Clientes",
      limite_storage_mb: "Límite Storage",
      features: "Características",
      activo: "Estado",
    }
    return names[field] || field
  }

  const formatValue = (field: string, value: any) => {
    if (value === null) return "Sin límite"
    if (typeof value === "boolean") return value ? "Activo" : "Inactivo"
    if (field === "precio_mensual" || field === "precio_anual") {
      return `$${value.toLocaleString("es-AR")}`
    }
    if (Array.isArray(value)) {
      return value.length > 0 ? value.join(", ") : "Sin características"
    }
    return value
  }

  if (auditLogs.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <p className="text-muted-foreground">No hay historial de cambios</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {auditLogs.map((log, index) => {
        const changes = getChanges(log)

        return (
          <Card key={log.id}>
            <CardContent className="pt-6">
              <div className="flex items-start gap-4">
                {/* Icon */}
                <div className="flex-shrink-0 mt-1">
                  {getActionIcon(log.action)}
                </div>

                {/* Content */}
                <div className="flex-1 space-y-3">
                  {/* Header */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className={getActionColor(log.action)}>
                      {getActionLabel(log.action)}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      por <span className="font-medium">{log.changed_by_email}</span>
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {formatDistanceToNow(new Date(log.created_at), {
                        addSuffix: true,
                        locale: es,
                      })}
                    </span>
                  </div>

                  {/* Changes */}
                  {changes.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Cambios:</div>
                      <div className="space-y-1.5">
                        {changes.map((change, idx) => (
                          <div
                            key={idx}
                            className="text-sm bg-muted p-2 rounded"
                          >
                            <span className="font-medium">
                              {formatFieldName(change.field)}:
                            </span>{" "}
                            <span className="text-muted-foreground line-through">
                              {formatValue(change.field, change.from)}
                            </span>{" "}
                            →{" "}
                            <span className="text-foreground font-medium">
                              {formatValue(change.field, change.to)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Timestamp */}
                  <div className="text-xs text-muted-foreground">
                    {new Date(log.created_at).toLocaleString("es-AR", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
