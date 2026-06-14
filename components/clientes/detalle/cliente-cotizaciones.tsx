"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { DataTable, type Column } from "@/components/ui/data-table"
import { useCurrency } from "@/contexts/currency-context"

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
      render: (c) => <Badge variant="outline">{c.estado}</Badge>,
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
