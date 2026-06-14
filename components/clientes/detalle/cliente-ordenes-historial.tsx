"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { DataTable, type Column } from "@/components/ui/data-table"
import { useCurrency } from "@/contexts/currency-context"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface OrdenRow {
  id: string
  numeroOrden: number
  dispositivo: string
  estado: string
  fechaIngreso: string
  costoFinal: number
}

interface Props {
  clienteId: string
}

export function ClienteOrdenesHistorial({ clienteId }: Props) {
  const router = useRouter()
  const { formatDate, formatPrice } = useCurrency()
  const [page, setPage] = useState(1)
  const pageSize = 10

  const apiUrl = `/api/ordenes?clienteId=${clienteId}&page=${page}&limit=${pageSize}&sortBy=fecha_ingreso&sortOrder=desc`
  const { data, isLoading } = useSWR<{ data: OrdenRow[]; total: number }>(
    apiUrl,
    fetcher,
    { revalidateOnFocus: false, keepPreviousData: true }
  )

  const ordenes = data?.data || []
  const total = data?.total || 0

  const columns: Column<OrdenRow>[] = [
    {
      key: "numeroOrden",
      header: "Orden",
      render: (o) => <span className="font-medium">#{o.numeroOrden}</span>,
    },
    {
      key: "dispositivo",
      header: "Dispositivo",
    },
    {
      key: "estado",
      header: "Estado",
      render: (o) => <Badge variant="outline">{o.estado}</Badge>,
    },
    {
      key: "fechaIngreso",
      header: "Ingreso",
      hideOnMobile: true,
      render: (o) => formatDate(o.fechaIngreso),
    },
    {
      key: "costoFinal",
      header: "Total",
      hideOnMobile: true,
      render: (o) => formatPrice(o.costoFinal),
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Historial de órdenes</CardTitle>
      </CardHeader>
      <CardContent className="p-0 sm:p-6 sm:pt-0">
        <DataTable
          data={ordenes}
          columns={columns}
          keyExtractor={(o) => o.id}
          loading={isLoading}
          emptyMessage="Sin órdenes registradas"
          onRowClick={(o) => router.push(`/ordenes/${o.id}`)}
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
