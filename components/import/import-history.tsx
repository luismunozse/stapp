"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Badge } from "@/components/ui/badge"
import { FileText, CheckCircle2, AlertCircle, Clock } from "lucide-react"
import { formatDate } from "@/lib/utils"
import type { Importacion, EntityImportType } from "@/types"

interface ImportHistoryProps {
  entityType?: EntityImportType
}

export function ImportHistory({ entityType }: ImportHistoryProps) {
  const [importaciones, setImportaciones] = useState<Importacion[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchHistory()
  }, [entityType])

  const fetchHistory = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (entityType) params.append('entityType', entityType)

      const res = await fetch(`/api/import/history?${params.toString()}`)
      const data = await res.json()

      if (Array.isArray(data)) {
        setImportaciones(data)
      }
    } catch (error) {
      console.error('Error fetching import history:', error)
    } finally {
      setLoading(false)
    }
  }

  const columns: Column<Importacion>[] = [
    {
      key: 'filename',
      header: 'Archivo',
      render: (imp) => (
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <div>
            <div className="font-medium">{imp.filename}</div>
            <div className="text-xs text-muted-foreground">
              {(imp.fileSize / 1024).toFixed(2)} KB
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'entityType',
      header: 'Tipo',
      render: (imp) => (
        <Badge variant="outline">
          {imp.entityType === 'CLIENTES' ? 'Clientes' : 'Inventario'}
        </Badge>
      ),
    },
    {
      key: 'totalRows',
      header: 'Total',
      render: (imp) => imp.totalRows,
    },
    {
      key: 'successCount',
      header: 'Exitosos',
      render: (imp) => (
        <span className="text-green-600 flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" />
          {imp.successCount}
        </span>
      ),
    },
    {
      key: 'skippedCount',
      header: 'Omitidos',
      render: (imp) => (
        <span className="text-yellow-600 flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {imp.skippedCount}
        </span>
      ),
    },
    {
      key: 'errorCount',
      header: 'Errores',
      render: (imp) => (
        <span className="text-red-600 flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          {imp.errorCount}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Fecha',
      sortable: true,
      render: (imp) => formatDate(imp.createdAt),
    },
    {
      key: 'user',
      header: 'Usuario',
      render: (imp) => imp.user?.nombre || '-',
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Historial de Importaciones</CardTitle>
      </CardHeader>
      <CardContent>
        <DataTable
          data={importaciones}
          columns={columns}
          keyExtractor={(imp) => imp.id}
          loading={loading}
          emptyMessage="No hay importaciones registradas"
        />
      </CardContent>
    </Card>
  )
}
