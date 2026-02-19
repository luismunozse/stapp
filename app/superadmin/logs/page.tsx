"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { DataTable, Column } from "@/components/ui/data-table"
import { FileText, ChevronDown, ChevronUp } from "lucide-react"
import { formatDateTime } from "@/lib/utils"
import type { AuditLogWithRelations } from "@/types/superadmin"
import { cn } from "@/lib/utils"

export default function LogsPage() {
  const [logs, setLogs] = useState<AuditLogWithRelations[]>([])
  const [loading, setLoading] = useState(true)
  const [entityFilter, setEntityFilter] = useState("")
  const [actionFilter, setActionFilter] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: "50",
        ...(entityFilter && { entity: entityFilter }),
        ...(actionFilter && { action: actionFilter }),
        ...(dateFrom && { dateFrom }),
        ...(dateTo && { dateTo }),
      })

      const res = await fetch(`/api/superadmin/audit-logs?${params}`)
      if (!res.ok) throw new Error("Error fetching logs")

      const data = await res.json()
      setLogs(data.logs || [])
      setTotal(data.total || 0)
    } catch (error) {
      console.error("Error:", error)
    } finally {
      setLoading(false)
    }
  }, [page, entityFilter, actionFilter, dateFrom, dateTo])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  const toggleRow = (id: string) => {
    const newExpanded = new Set(expandedRows)
    if (newExpanded.has(id)) {
      newExpanded.delete(id)
    } else {
      newExpanded.add(id)
    }
    setExpandedRows(newExpanded)
  }

  const getActionVariant = (action: string) => {
    switch (action) {
      case "CREATE":
        return "default"
      case "UPDATE":
        return "secondary"
      case "DELETE":
        return "destructive"
      default:
        return "secondary"
    }
  }

  const columns: Column<AuditLogWithRelations>[] = [
    {
      key: "created_at",
      header: "Fecha",
      render: (log) => (
        <span className="text-sm">{formatDateTime(log.created_at)}</span>
      ),
    },
    {
      key: "organizations",
      header: "Organización",
      render: (log) => (
        <div>
          <div className="font-medium text-sm">
            {log.organizations?.nombre || "-"}
          </div>
          <div className="text-xs text-muted-foreground">
            {log.organizations?.slug}
          </div>
        </div>
      ),
    },
    {
      key: "users",
      header: "Usuario",
      render: (log) =>
        log.users ? (
          <div>
            <div className="font-medium text-sm">{log.users.nombre}</div>
            <div className="text-xs text-muted-foreground">{log.users.email}</div>
          </div>
        ) : (
          <span className="text-muted-foreground text-sm">Sistema</span>
        ),
    },
    {
      key: "action",
      header: "Acción",
      render: (log) => (
        <Badge variant={getActionVariant(log.action)}>{log.action}</Badge>
      ),
    },
    {
      key: "entity",
      header: "Entidad",
      render: (log) => <span className="text-sm">{log.entity}</span>,
    },
    {
      key: "changes",
      header: "Detalles",
      render: (log) =>
        log.changes ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation()
              toggleRow(log.id)
            }}
          >
            {expandedRows.has(log.id) ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        ) : (
          "-"
        ),
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <FileText className="h-8 w-8" />
          Logs de Auditoría
        </h1>
        <p className="text-muted-foreground">
          Registro de todas las acciones en el sistema
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col lg:flex-row gap-4">
            <Select
              value={actionFilter || "all"}
              onValueChange={(value) => {
                setActionFilter(value === "all" ? "" : value)
                setPage(1)
              }}
            >
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Todas las acciones" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las acciones</SelectItem>
                <SelectItem value="create">Crear</SelectItem>
                <SelectItem value="update">Actualizar</SelectItem>
                <SelectItem value="delete">Eliminar</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={entityFilter || "all"}
              onValueChange={(value) => {
                setEntityFilter(value === "all" ? "" : value)
                setPage(1)
              }}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Todas las entidades" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las entidades</SelectItem>
                <SelectItem value="organizations">Organizaciones</SelectItem>
                <SelectItem value="users">Usuarios</SelectItem>
                <SelectItem value="ordenes_servicio">Órdenes</SelectItem>
                <SelectItem value="clientes">Clientes</SelectItem>
                <SelectItem value="inventario">Inventario</SelectItem>
                <SelectItem value="subscriptions">Suscripciones</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Desde:</span>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value)
                  setPage(1)
                }}
                className="w-[160px]"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Hasta:</span>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value)
                  setPage(1)
                }}
                className="w-[160px]"
              />
            </div>
            {(dateFrom || dateTo || actionFilter || entityFilter) && (
              <Button
                variant="ghost"
                onClick={() => {
                  setDateFrom("")
                  setDateTo("")
                  setActionFilter("")
                  setEntityFilter("")
                  setPage(1)
                }}
              >
                Limpiar filtros
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="rounded-lg border bg-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      {columns.map((column) => (
                        <th
                          key={column.key}
                          className={cn(
                            "px-4 py-3 text-left font-medium text-muted-foreground",
                            column.headerClassName
                          )}
                        >
                          {column.header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td
                          colSpan={columns.length}
                          className="px-4 py-8 text-center text-muted-foreground"
                        >
                          <div className="flex items-center justify-center gap-2">
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                            Cargando...
                          </div>
                        </td>
                      </tr>
                    ) : logs.length === 0 ? (
                      <tr>
                        <td
                          colSpan={columns.length}
                          className="px-4 py-8 text-center text-muted-foreground"
                        >
                          No se encontraron logs
                        </td>
                      </tr>
                    ) : (
                      logs.map((log) => (
                        <>
                          <tr
                            key={log.id}
                            className="border-b last:border-0 transition-colors hover:bg-muted/50"
                          >
                            {columns.map((column) => (
                              <td
                                key={column.key}
                                className={cn("px-4 py-3", column.className)}
                              >
                                {column.render
                                  ? column.render(log)
                                  : (log as any)[column.key]}
                              </td>
                            ))}
                          </tr>
                          {expandedRows.has(log.id) && log.changes && (
                            <tr key={`${log.id}-expanded`}>
                              <td
                                colSpan={columns.length}
                                className="px-4 py-3 bg-muted/30"
                              >
                                <pre className="text-xs overflow-x-auto p-2 bg-muted rounded">
                                  {JSON.stringify(log.changes, null, 2)}
                                </pre>
                              </td>
                            </tr>
                          )}
                        </>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pagination */}
            {total > 0 && (
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  Mostrando {(page - 1) * 50 + 1} -{" "}
                  {Math.min(page * 50, total)} de {total}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(prev => prev - 1)}
                    disabled={page === 1}
                  >
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(prev => prev + 1)}
                    disabled={page * 50 >= total}
                  >
                    Siguiente
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
