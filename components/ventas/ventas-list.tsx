"use client"

import { useTelefonoClienteOculto } from "@/hooks/use-telefono-cliente-oculto"
import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DatePicker } from "@/components/ui/date-picker"
import { DataTable, DataTablePagination, type Column } from "@/components/ui/data-table"
import { CobroResumen } from "@/components/ui/cobro-resumen"
import { VentaEstadoBadge } from "@/components/ventas/venta-estado-badge"
import { EmptyState } from "@/components/ui/empty-state"
import {
  Search,
  Eye,
  FileText,
  Filter,
  X,
  ShoppingCart,
  Monitor,
  MoreHorizontal,
  ShieldCheck,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useModal } from "@/contexts/modal-context"
import { ExportButton } from "@/components/export/export-button"
import { VentaMobileCard } from "./venta-mobile-card"
import { Card, CardContent } from "@/components/ui/card"
import { useCurrency } from "@/contexts/currency-context"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

const fetcher = (url: string) => fetch(url).then(res => res.json())

interface VentaListItem {
  id: string
  numeroVenta: number
  clienteNombre: string
  clienteTelefono?: string | null
  vendedor?: { nombre: string } | null
  items: Array<{ descripcion: string; cantidad: number }>
  total: number
  montoAbonado: number
  /** Lo que falta cobrar (total − cobrado − lo que descontaron las devoluciones). */
  saldoPendiente?: number
  estadoPago: string
  metodoPago: string
  estado: string
  garantias: Array<{ id: string }>
  createdAt: string
}

const estadoOptions = [
  { value: "COMPLETADA", label: "Completada" },
  { value: "ANULADA", label: "Anulada" },
]

const metodoPagoLabels: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  TARJETA: "Tarjeta",
  TARJETA_DEBITO: "T. Débito",
  TARJETA_CREDITO: "T. Crédito",
  MERCADOPAGO: "MercadoPago",
  OTRO: "Otro",
}

export function VentasList() {
  const telefonoOculto = useTelefonoClienteOculto()
  const router = useRouter()
  const { formatPrice, formatDate } = useCurrency()
  const { showError } = useModal()

  // Filters
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [estado, setEstado] = useState<string>("")
  const [fechaDesde, setFechaDesde] = useState("")
  const [fechaHasta, setFechaHasta] = useState("")
  const [showFilters, setShowFilters] = useState(false)

  // Pagination
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  // Debounce search
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

  // Build API URL for SWR
  const apiUrl = useMemo(() => {
    const params = new URLSearchParams()
    if (debouncedSearch) params.append("search", debouncedSearch)
    if (estado) params.append("estado", estado)
    if (fechaDesde) params.append("fechaDesde", fechaDesde)
    if (fechaHasta) params.append("fechaHasta", fechaHasta)
    params.append("page", page.toString())
    params.append("limit", pageSize.toString())
    return `/api/ventas?${params.toString()}`
  }, [debouncedSearch, estado, fechaDesde, fechaHasta, page, pageSize])

  // SWR for fetching with cache
  const { data, isLoading, mutate } = useSWR(apiUrl, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 5000,
    keepPreviousData: true,
  })

  // Extract data from response
  const ventas: VentaListItem[] = data?.data || (Array.isArray(data) ? data : [])
  const total = data?.total || (Array.isArray(data) ? data.length : 0)

  const clearFilters = () => {
    setSearch("")
    setDebouncedSearch("")
    setEstado("")
    setFechaDesde("")
    setFechaHasta("")
    setPage(1)
  }

  const hasActiveFilters = search || estado || fechaDesde || fechaHasta

  const columns: Column<VentaListItem>[] = [
    {
      key: "numeroVenta",
      header: "# Venta",
      sortable: true,
      render: (venta) => (
        <span className="font-mono font-medium text-primary">
          V{String(venta.numeroVenta).padStart(4, "0")}
        </span>
      ),
    },
    {
      key: "createdAt",
      header: "Fecha",
      sortable: true,
      hideOnMobile: true,
      render: (venta) => formatDate(venta.createdAt),
    },
    {
      key: "clienteNombre",
      header: "Cliente",
      sortable: true,
      render: (venta) => (
        <div>
          <div className="font-medium">{venta.clienteNombre}</div>
          {venta.clienteTelefono && (
            <div className="text-xs text-muted-foreground">{venta.clienteTelefono}</div>
          )}
        </div>
      ),
    },
    {
      key: "items",
      header: "Items",
      hideOnMobile: true,
      render: (venta) => (
        <div className="text-sm">
          {venta.items.length} producto{venta.items.length !== 1 ? "s" : ""}
        </div>
      ),
    },
    {
      key: "total",
      header: "Total",
      sortable: true,
      render: (venta) => (
        <span className="font-medium">{formatPrice(venta.total)}</span>
      ),
    },
    {
      key: "metodoPago",
      header: "Pago",
      hideOnTablet: true,
      render: (venta) => (
        <span className="text-sm">{metodoPagoLabels[venta.metodoPago] || venta.metodoPago}</span>
      ),
    },
    {
      key: "estadoPago",
      header: "Cobro",
      render: (venta) => (
        <CobroResumen
          estadoPago={venta.estadoPago}
          // Una venta anulada no le debe nada a nadie.
          saldoPendiente={venta.estado === "ANULADA" ? 0 : venta.saldoPendiente}
        />
      ),
    },
    {
      key: "estado",
      header: "Estado",
      render: (venta) => (
        <VentaEstadoBadge estado={venta.estado} />
      ),
    },
    {
      key: "garantias",
      header: "Garantías",
      hideOnMobile: true,
      render: (venta) => (
        <span className={venta.garantias.length > 0 ? "text-success-text font-medium" : "text-muted-foreground"}>
          {venta.garantias.length > 0 ? `${venta.garantias.length} cert.` : "-"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (venta) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation()
              router.push(`/ventas/${venta.id}`)
            }}
            title="Ver detalle"
          >
            <Eye className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={async (e) => {
              e.stopPropagation()
              window.open(`/api/ventas/${venta.id}/pdf`, "_blank")
            }}
            title="Descargar comprobante"
          >
            <FileText className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      {/* Header (desktop only: on phones the page title and the tab already say "Ventas") */}
      <div className="hidden gap-4 sm:flex sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-6 w-6 text-primary" />
          <h2 className="text-xl font-semibold">Ventas</h2>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton
            entity="ventas"
            filters={{
              ...(estado && { estado }),
              ...(fechaDesde && { desde: fechaDesde }),
              ...(fechaHasta && { hasta: fechaHasta }),
            }}
            variant="outline"
            size="default"
          />
          <Link href="/pos">
            <Button>
              <Monitor className="mr-2 h-4 w-4" />
              Ir al POS
            </Button>
          </Link>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-row items-center gap-2 sm:gap-4">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={telefonoOculto ? "Buscar por cliente, nro de venta..." : "Buscar por cliente, teléfono, nro de venta..."}
            className="pl-9"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>
        {/* Mobile: search, filters, POS and an overflow menu share one row */}
        <div className="flex shrink-0 items-center gap-1.5 sm:hidden">
          <Button
            variant={showFilters ? "secondary" : "outline"}
            size="icon"
            className="relative"
            onClick={() => setShowFilters(!showFilters)}
            aria-label="Filtros"
            aria-expanded={showFilters}
          >
            <Filter className="h-4 w-4" />
            {hasActiveFilters && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary" aria-hidden />}
          </Button>
          <Button asChild size="icon" title="Ir al POS">
            <Link href="/pos" aria-label="Ir al POS">
              <Monitor className="h-4 w-4" />
            </Link>
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Más opciones" title="Más opciones">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-1 space-y-1">
              <ExportButton
                entity="ventas"
                filters={{
                  ...(estado && { estado }),
                  ...(fechaDesde && { desde: fechaDesde }),
                  ...(fechaHasta && { hasta: fechaHasta }),
                }}
                variant="ghost"
                label="Exportar"
                className="w-full justify-start"
              />
              <Button asChild variant="ghost" className="w-full justify-start">
                <Link href="/garantias?origen=VENTA">
                  <ShieldCheck className="h-4 w-4 mr-2" aria-hidden="true" />
                  Garantías de ventas
                </Link>
              </Button>
            </PopoverContent>
          </Popover>
        </div>
        <Button
          variant="outline"
          onClick={() => setShowFilters(!showFilters)}
          className={cn("hidden sm:inline-flex", showFilters && "bg-muted")}
        >
          <Filter className="mr-2 h-4 w-4" />
          Filtros
          {hasActiveFilters && (
            <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
              {[search, estado, fechaDesde, fechaHasta].filter(Boolean).length}
            </span>
          )}
        </Button>
      </div>

      {/* Expanded Filters */}
      {showFilters && (
        <div className="rounded-lg border bg-card p-3 sm:p-4">
          <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
            <div className="col-span-2 sm:col-span-1">
              <label htmlFor="venta-filter-estado" className="mb-1.5 block text-sm font-medium">Estado</label>
              <Select
                value={estado || "all"}
                onValueChange={(value) => setEstado(value === "all" ? "" : value)}
              >
                <SelectTrigger id="venta-filter-estado">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {estadoOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label htmlFor="venta-filter-desde" className="mb-1.5 block text-sm font-medium">Desde</label>
              <DatePicker
                id="venta-filter-desde"
                value={fechaDesde}
                onChange={(date) => setFechaDesde(date || "")}
              />
            </div>
            <div>
              <label htmlFor="venta-filter-hasta" className="mb-1.5 block text-sm font-medium">Hasta</label>
              <DatePicker
                id="venta-filter-hasta"
                value={fechaHasta}
                onChange={(date) => setFechaHasta(date || "")}
              />
            </div>
            <div className={cn("col-span-2 flex items-end sm:col-span-1", !hasActiveFilters && "max-sm:hidden")}>
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

      {/* Desktop: Data Table */}
      <div className="hidden sm:block">
        <DataTable
          data={ventas}
          columns={columns}
          loading={isLoading}
          emptyMessage="No hay ventas registradas"
          keyExtractor={(venta) => venta.id}
          onRowClick={(venta) => router.push(`/ventas/${venta.id}`)}
          pagination={{
            page,
            pageSize,
            total,
            onPageChange: setPage,
            onPageSizeChange: setPageSize,
          }}
        />
      </div>

      {/* Mobile: Cards */}
      <div className="sm:hidden">
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <Card key={`skeleton-${i}`}>
                <CardContent className="p-3">
                  <div className="h-4 bg-muted animate-pulse rounded w-1/3 mb-3" />
                  <div className="h-3 bg-muted animate-pulse rounded w-2/3 mb-2" />
                  <div className="h-3 bg-muted animate-pulse rounded w-1/2" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : ventas.length === 0 ? (
          <EmptyState icon={ShoppingCart} title="Sin ventas" description="No hay ventas registradas todavía" variant="search" />
        ) : (
          <>
            <div className="space-y-2">
              {ventas.map((venta) => (
                <VentaMobileCard
                  key={venta.id}
                  venta={venta}
                  onClick={() => router.push(`/ventas/${venta.id}`)}
                />
              ))}
            </div>
            {total > pageSize && (
              <div className="mt-4">
                <DataTablePagination
                  page={page}
                  pageSize={pageSize}
                  total={total}
                  dataLength={ventas.length}
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
