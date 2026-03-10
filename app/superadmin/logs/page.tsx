"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { DataTable, Column } from "@/components/ui/data-table"
import { FileText, ChevronDown, ChevronUp } from "lucide-react"
import { formatDateTime } from "@/lib/utils"
import { useSuperadminFetch } from "@/hooks/use-superadmin-fetch"
import { useLastUpdated } from "@/hooks/use-last-updated"
import { LastUpdated } from "@/components/superadmin/last-updated"
import type { AuditLogWithRelations } from "@/types/superadmin"

const ACTION_VARIANTS: Record<string, "default" | "secondary" | "destructive"> = {
  CREATE: "default",
  UPDATE: "secondary",
  DELETE: "destructive",
}

const PAGE_SIZE = 50

export default function LogsPage() {
  const [entityFilter, setEntityFilter] = useState("")
  const [actionFilter, setActionFilter] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [logs, setLogs] = useState<AuditLogWithRelations[]>([])
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  const { loading, fetchData } = useSuperadminFetch<{
    logs: AuditLogWithRelations[]
    total: number
  }>()
  const { formattedLastUpdated, markUpdated } = useLastUpdated()

  const fetchLogs = useCallback(async () => {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: PAGE_SIZE.toString(),
      ...(entityFilter && { entity: entityFilter }),
      ...(actionFilter && { action: actionFilter }),
      ...(dateFrom && { dateFrom }),
      ...(dateTo && { dateTo }),
    })

    const result = await fetchData(`/api/superadmin/audit-logs?${params}`)
    if (result) {
      setLogs(result.logs || [])
      setTotal(result.total || 0)
      markUpdated()
    }
  }, [page, entityFilter, actionFilter, dateFrom, dateTo, fetchData])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
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
      hideOnMobile: true,
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
      hideOnMobile: true,
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
        <Badge variant={ACTION_VARIANTS[log.action] || "secondary"}>
          {log.action}
        </Badge>
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

  const hasFilters = dateFrom || dateTo || actionFilter || entityFilter

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
        <LastUpdated
          formattedLastUpdated={formattedLastUpdated}
          onRefresh={fetchLogs}
          loading={loading}
        />
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
            {hasFilters && (
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
          <DataTable
            data={logs}
            columns={columns}
            keyExtractor={(log) => log.id}
            loading={loading}
            emptyMessage="No se encontraron logs"
            pagination={{
              page,
              pageSize: PAGE_SIZE,
              total,
              onPageChange: setPage,
            }}
          />

          {/* Expanded row details */}
          {logs
            .filter((log) => expandedRows.has(log.id) && log.changes)
            .map((log) => (
              <div
                key={`${log.id}-detail`}
                className="mt-2 p-3 bg-muted/30 rounded-lg border"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    Cambios - {log.entity} ({log.action}) -{" "}
                    {formatDateTime(log.created_at)}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => toggleRow(log.id)}
                  >
                    <ChevronUp className="h-3 w-3" />
                  </Button>
                </div>
                <pre className="text-xs overflow-x-auto p-2 bg-muted rounded">
                  {JSON.stringify(log.changes, null, 2)}
                </pre>
              </div>
            ))}
        </CardContent>
      </Card>
    </div>
  )
}
