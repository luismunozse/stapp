"use client"

import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import useSWR from "swr"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DatePicker } from "@/components/ui/date-picker"
import { DataTable, DataTablePagination, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { Search, Filter, X, Wrench, Calendar, User } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"

const fetcher = (url: string) => fetch(url).then(res => res.json())

interface CobroReparacion {
  id: string
  monto: number
  metodoPago: string
  referencia: string | null
  cuotas: number | null
  fecha: string
  anulado: boolean
  cobradoPor: string | null
  orden: {
    id: string
    codigo: string | null
    numeroOrden: number | null
    equipo: string | null
    clienteNombre: string | null
  }
}

const metodoPagoLabels: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  TARJETA: "Tarjeta",
  TARJETA_DEBITO: "T. Débito",
  TARJETA_CREDITO: "T. Crédito",
  MERCADOPAGO: "MercadoPago",
  CUENTA_CORRIENTE: "Cuenta corriente",
  OTRO: "Otro",
}

const metodoOptions = [
  "EFECTIVO", "TRANSFERENCIA", "TARJETA_DEBITO", "TARJETA_CREDITO",
  "MERCADOPAGO", "CUENTA_CORRIENTE", "OTRO",
]

function etiquetaOrden(orden: CobroReparacion["orden"]): string {
  if (orden.codigo) return orden.codigo
  if (orden.numeroOrden != null) return `#${String(orden.numeroOrden).padStart(4, "0")}`
  return "Orden"
}

/**
 * Cobros de órdenes de reparación. Un cobro de orden no es una venta del POS
 * (vive en otra tabla), así que tiene su propia pestaña en Ventas en vez de
 * mezclarse con la numeración y los totales de las ventas.
 */
export function CobrosReparacionesList() {
  const router = useRouter()
  const { formatPrice, formatDateTime } = useCurrency()

  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [metodo, setMetodo] = useState("")
  const [fechaDesde, setFechaDesde] = useState("")
  const [fechaHasta, setFechaHasta] = useState("")
  const [showFilters, setShowFilters] = useState(false)

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value)
    setPage(1)
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => setDebouncedSearch(value), 300)
  }, [])
  useEffect(() => {
    return () => { if (debounceTimer.current) clearTimeout(debounceTimer.current) }
  }, [])

  const apiUrl = useMemo(() => {
    const params = new URLSearchParams()
    if (debouncedSearch) params.append("search", debouncedSearch)
    if (metodo) params.append("metodo", metodo)
    if (fechaDesde) params.append("fechaDesde", fechaDesde)
    if (fechaHasta) params.append("fechaHasta", fechaHasta)
    params.append("page", page.toString())
    params.append("limit", pageSize.toString())
    return `/api/ventas/cobros-reparaciones?${params.toString()}`
  }, [debouncedSearch, metodo, fechaDesde, fechaHasta, page, pageSize])

  const { data, isLoading } = useSWR(apiUrl, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 5000,
    keepPreviousData: true,
  })

  const cobros: CobroReparacion[] = Array.isArray(data?.data) ? data.data : []
  const total: number = data?.total || 0

  const clearFilters = () => {
    setSearch("")
    setDebouncedSearch("")
    setMetodo("")
    setFechaDesde("")
    setFechaHasta("")
    setPage(1)
  }

  const hasActiveFilters = search || metodo || fechaDesde || fechaHasta
  const irALaOrden = (cobro: CobroReparacion) => router.push(`/ordenes/${cobro.orden.id}`)

  const columns: Column<CobroReparacion>[] = [
    {
      key: "fecha",
      header: "Fecha",
      render: (cobro) => <span className="whitespace-nowrap">{formatDateTime(cobro.fecha)}</span>,
    },
    {
      key: "orden",
      header: "Orden",
      render: (cobro) => (
        <div>
          <span className="font-mono font-medium text-primary">{etiquetaOrden(cobro.orden)}</span>
          {cobro.orden.equipo && (
            <div className="text-xs text-muted-foreground">{cobro.orden.equipo}</div>
          )}
        </div>
      ),
    },
    {
      key: "cliente",
      header: "Cliente",
      render: (cobro) => (
        <span className="font-medium">{cobro.orden.clienteNombre || "Sin cliente"}</span>
      ),
    },
    {
      key: "metodoPago",
      header: "Pago",
      hideOnMobile: true,
      render: (cobro) => (
        <div className="text-sm">
          {metodoPagoLabels[cobro.metodoPago] || cobro.metodoPago}
          {cobro.cuotas && cobro.cuotas > 1 ? ` · ${cobro.cuotas} cuotas` : ""}
          {cobro.referencia && (
            <div className="text-xs text-muted-foreground">Ref: {cobro.referencia}</div>
          )}
        </div>
      ),
    },
    {
      key: "cobradoPor",
      header: "Cobró",
      hideOnTablet: true,
      render: (cobro) => <span className="text-sm">{cobro.cobradoPor || "-"}</span>,
    },
    {
      key: "monto",
      header: "Monto",
      render: (cobro) => (
        <span className={cobro.anulado ? "font-medium line-through text-muted-foreground" : "font-medium"}>
          {formatPrice(cobro.monto)}
        </span>
      ),
    },
    {
      key: "estado",
      header: "Estado",
      render: (cobro) =>
        cobro.anulado
          ? <Badge variant="destructive">Anulado</Badge>
          : <Badge variant="success">Cobrado</Badge>,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Wrench className="h-6 w-6 text-primary" />
        <div>
          <h2 className="text-xl font-semibold">Cobros de reparaciones</h2>
          <p className="text-sm text-muted-foreground">
            Lo que se cobró en órdenes de servicio. Tocá un cobro para abrir su orden.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por cliente o nro de orden..."
            className="pl-9"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>
        <Button
          variant="outline"
          onClick={() => setShowFilters(!showFilters)}
          className={showFilters ? "bg-muted" : ""}
        >
          <Filter className="mr-2 h-4 w-4" />
          Filtros
          {hasActiveFilters && (
            <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
              {[search, metodo, fechaDesde, fechaHasta].filter(Boolean).length}
            </span>
          )}
        </Button>
      </div>

      {showFilters && (
        <div className="rounded-lg border bg-card p-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="cobro-filter-metodo" className="mb-1.5 block text-sm font-medium">Método de pago</label>
              <Select
                value={metodo || "all"}
                onValueChange={(value) => { setMetodo(value === "all" ? "" : value); setPage(1) }}
              >
                <SelectTrigger id="cobro-filter-metodo">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {metodoOptions.map((m) => (
                    <SelectItem key={m} value={m}>{metodoPagoLabels[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label htmlFor="cobro-filter-desde" className="mb-1.5 block text-sm font-medium">Desde</label>
              <DatePicker
                id="cobro-filter-desde"
                value={fechaDesde}
                onChange={(date) => { setFechaDesde(date || ""); setPage(1) }}
              />
            </div>
            <div>
              <label htmlFor="cobro-filter-hasta" className="mb-1.5 block text-sm font-medium">Hasta</label>
              <DatePicker
                id="cobro-filter-hasta"
                value={fechaHasta}
                onChange={(date) => { setFechaHasta(date || ""); setPage(1) }}
              />
            </div>
            <div className="flex items-end">
              {hasActiveFilters && (
                <Button variant="ghost" onClick={clearFilters} className="w-full">
                  <X className="mr-2 h-4 w-4" />
                  Limpiar filtros
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Desktop */}
      <div className="hidden sm:block">
        <DataTable
          data={cobros}
          columns={columns}
          loading={isLoading}
          emptyMessage={hasActiveFilters ? "Ningún cobro coincide con los filtros" : "Todavía no hay cobros de reparaciones"}
          keyExtractor={(cobro) => cobro.id}
          onRowClick={irALaOrden}
          pagination={{
            page,
            pageSize,
            total,
            onPageChange: setPage,
            onPageSizeChange: setPageSize,
          }}
        />
      </div>

      {/* Mobile */}
      <div className="sm:hidden">
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <Card key={`skeleton-${i}`}>
                <CardContent className="p-4">
                  <div className="h-4 bg-muted animate-pulse rounded w-1/3 mb-3" />
                  <div className="h-3 bg-muted animate-pulse rounded w-2/3 mb-2" />
                  <div className="h-3 bg-muted animate-pulse rounded w-1/2" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : cobros.length === 0 ? (
          <EmptyState
            icon={Wrench}
            title="Sin cobros"
            description={hasActiveFilters ? "Ningún cobro coincide con los filtros" : "Todavía no hay cobros de reparaciones"}
            variant="search"
          />
        ) : (
          <>
            <div className="space-y-3">
              {cobros.map((cobro) => (
                <Card
                  key={cobro.id}
                  className="cursor-pointer active:bg-muted/50 transition-colors"
                  onClick={() => irALaOrden(cobro)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono font-medium text-primary text-sm">
                        {etiquetaOrden(cobro.orden)}
                      </span>
                      {cobro.anulado
                        ? <Badge variant="destructive" className="text-xs">Anulado</Badge>
                        : <Badge variant="success" className="text-xs">Cobrado</Badge>}
                    </div>
                    <div className="font-medium text-sm">{cobro.orden.clienteNombre || "Sin cliente"}</div>
                    {cobro.orden.equipo && (
                      <div className="text-xs text-muted-foreground">{cobro.orden.equipo}</div>
                    )}
                    <div className="flex items-center justify-between text-xs text-muted-foreground mt-2">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatDateTime(cobro.fecha)}
                      </span>
                      {cobro.cobradoPor && (
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {cobro.cobradoPor}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between pt-2">
                      <span className="text-xs text-muted-foreground">
                        {metodoPagoLabels[cobro.metodoPago] || cobro.metodoPago}
                      </span>
                      <span className={cobro.anulado ? "font-semibold line-through text-muted-foreground" : "font-semibold"}>
                        {formatPrice(cobro.monto)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            {total > pageSize && (
              <div className="mt-4">
                <DataTablePagination
                  page={page}
                  pageSize={pageSize}
                  total={total}
                  dataLength={cobros.length}
                  onPageChange={setPage}
                  onPageSizeChange={setPageSize}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
