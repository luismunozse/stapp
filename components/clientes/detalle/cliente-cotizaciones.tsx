"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { estadoConfig } from "@/components/cotizaciones/estado-config"
import { DataTable, type Column } from "@/components/ui/data-table"
import { useCurrency } from "@/contexts/currency-context"

function EstadoBadge({ estado }: { estado: string }) {
  const config = estadoConfig[estado]
  if (!config) return <Badge variant="outline">{estado}</Badge>
  const Icon = config.icon
  return (
    <Badge className={config.color}>
      <Icon className="mr-1 h-3 w-3" />
      {config.label}
    </Badge>
  )
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface CotizacionRow {
  id: string
  numeroCotizacion: number
  estado: string
  total: number
  createdAt: string
}

interface Props {
  clienteId: string
}

export function ClienteCotizaciones({ clienteId }: Props) {
  const router = useRouter()
  const { formatDate, formatPrice } = useCurrency()
  const [page, setPage] = useState(1)
  const pageSize = 10

  const apiUrl = `/api/cotizaciones?clienteId=${clienteId}&page=${page}&limit=${pageSize}`
  const { data, isLoading } = useSWR<{ data: CotizacionRow[]; total: number }>(
    apiUrl,
    fetcher,
    { revalidateOnFocus: false, keepPreviousData: true }
  )

  const cotizaciones = data?.data || []
  const total = data?.total || 0

  const columns: Column<CotizacionRow>[] = [
    {
      key: "numeroCotizacion",
      header: "N°",
      render: (c) => <span className="font-medium">#{c.numeroCotizacion}</span>,
    },
    {
      key: "estado",
      header: "Estado",
      render: (c) => <EstadoBadge estado={c.estado} />,
    },
    {
      key: "total",
      header: "Total",
      hideOnMobile: true,
      render: (c) => formatPrice(c.total),
    },
    {
      key: "createdAt",
      header: "Fecha",
      hideOnMobile: true,
      render: (c) => formatDate(c.createdAt),
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cotizaciones</CardTitle>
      </CardHeader>
      <CardContent className="p-0 sm:p-6 sm:pt-0">
        <DataTable
          data={cotizaciones}
          columns={columns}
          keyExtractor={(c) => c.id}
          loading={isLoading}
          emptyMessage="Sin cotizaciones registradas"
          onRowClick={(c) => router.push(`/cotizaciones/${c.id}`)}
          renderMobileCard={(c) => (
            <div className="space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="font-medium text-sm">#{c.numeroCotizacion}</div>
                <EstadoBadge estado={c.estado} />
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{formatDate(c.createdAt)}</span>
                <span className="tabular-nums font-medium text-foreground">{formatPrice(c.total)}</span>
              </div>
            </div>
          )}
          pagination={{
            page,
            pageSize,
            total,
            onPageChange: setPage,
            onPageSizeChange: () => {},
          }}
        />
      </CardContent>
    </Card>
  )
}
