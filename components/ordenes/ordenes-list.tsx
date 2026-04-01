"use client"

import { useState, useCallback, useMemo, useRef, useEffect } from "react"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DatePicker } from "@/components/ui/date-picker"
import { DataTable, DataTablePagination, type Column } from "@/components/ui/data-table"
import { OrderStatusBadge } from "@/components/ui/badge"
import {
  Plus,
  Search,
  Eye,
  Trash2,
  Filter,
  X,
  CheckSquare,
  Printer,
} from "lucide-react"
import { toast } from "sonner"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { OrdenForm } from "./orden-form"
import { useModal } from "@/contexts/modal-context"
import { ExportButton } from "@/components/export/export-button"
import { OrdenMobileCard } from "./orden-mobile-card"
import { Card, CardContent } from "@/components/ui/card"
import { useCurrency } from "@/contexts/currency-context"
import type { OrdenServicio, EstadoOrden } from "@/types"
import { useSession } from "next-auth/react"

function isUrgente(orden: OrdenServicio): boolean {
  if (!orden.fechaPrometida) return false
  return new Date(orden.fechaPrometida) < new Date()
}

function isProximaAVencer(orden: OrdenServicio): boolean {
  if (!orden.fechaPrometida) return false
  const manana = new Date()
  manana.setDate(manana.getDate() + 1)
  return new Date(orden.fechaPrometida) >= new Date() && new Date(orden.fechaPrometida) <= manana
}

// Fetcher para SWR
const fetcher = (url: string) => fetch(url).then(res => res.json())

const ESTADO_LABELS_MAP: Record<string, string> = {
  RECIBIDO: "Recibido",
  EN_DIAGNOSTICO: "En Diagnóstico",
  PRESUPUESTADO: "Presupuestado",
  APROBADO: "Aprobado",
  EN_REPARACION: "En Reparación",
  ESPERANDO_REPUESTO: "Esperando Repuesto",
  REPARADO: "Reparado",
  ENTREGADO: "Entregado",
  CANCELADO: "Cancelado",
  SIN_REPARACION: "Sin Reparación",
}

const estadoOptions = [
  { value: "RECIBIDO", label: "Recibido" },
  { value: "EN_DIAGNOSTICO", label: "En Diagnóstico" },
  { value: "PRESUPUESTADO", label: "Presupuestado" },
  { value: "APROBADO", label: "Aprobado" },
  { value: "EN_REPARACION", label: "En Reparación" },
  { value: "ESPERANDO_REPUESTO", label: "Esperando Repuesto" },
  { value: "REPARADO", label: "Reparado" },
  { value: "ENTREGADO", label: "Entregado" },
  { value: "CANCELADO", label: "Cancelado" },
  { value: "SIN_REPARACION", label: "Sin Reparación" },
]

export function OrdenesList() {
  const router = useRouter()
  const { formatPrice, formatDate } = useCurrency()
  const { data: session } = useSession()
  const isTecnico = session?.user?.role === "TECNICO"
  const [showForm, setShowForm] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const { confirm, showError } = useModal()

  // Bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkUpdating, setBulkUpdating] = useState(false)

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === ordenes.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(ordenes.map((o) => o.id)))
    }
  }

  const handleBulkEstado = async (nuevoEstado: EstadoOrden) => {
    if (selectedIds.size === 0) return
    setBulkUpdating(true)
    try {
      const promises = Array.from(selectedIds).map((id) =>
        fetch(`/api/ordenes/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ estado: nuevoEstado }),
        })
      )
      const results = await Promise.all(promises)
      const successCount = results.filter((r) => r.ok).length
      toast.success(`${successCount} órdenes actualizadas a ${ESTADO_LABELS_MAP[nuevoEstado]}`)
      setSelectedIds(new Set())
      mutate()
    } catch (error) {
      toast.error("Error al actualizar órdenes")
    } finally {
      setBulkUpdating(false)
    }
  }

  // Filters
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [estado, setEstado] = useState<EstadoOrden | "">("")
  const [fechaDesde, setFechaDesde] = useState("")
  const [fechaHasta, setFechaHasta] = useState("")
  const [showFilters, setShowFilters] = useState(false)

  const quickFilters = isTecnico ? [
    { label: "Sin diagnóstico", value: "RECIBIDO" as EstadoOrden },
    { label: "En reparación", value: "EN_REPARACION" as EstadoOrden },
    { label: "Esperando repuesto", value: "ESPERANDO_REPUESTO" as EstadoOrden },
    { label: "Listo para entregar", value: "REPARADO" as EstadoOrden },
  ] : []

  // Sorting
  const [sortKey, setSortKey] = useState<string>("fechaIngreso")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc")
  const [sortInitialized, setSortInitialized] = useState(false)

  useEffect(() => {
    if (!sortInitialized && session) {
      if (isTecnico) {
        setSortKey("fechaPrometida")
        setSortDirection("asc")
      }
      setSortInitialized(true)
    }
  }, [session, isTecnico, sortInitialized])

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

  // Construir URL con parámetros para SWR
  const apiUrl = useMemo(() => {
    const params = new URLSearchParams()
    if (debouncedSearch) params.append("search", debouncedSearch)
    if (estado) params.append("estado", estado)
    if (fechaDesde) params.append("fechaDesde", fechaDesde)
    if (fechaHasta) params.append("fechaHasta", fechaHasta)
    params.append("page", page.toString())
    params.append("limit", pageSize.toString())
    params.append("sortBy", sortKey)
    params.append("sortOrder", sortDirection)
    return `/api/ordenes?${params.toString()}`
  }, [debouncedSearch, estado, fechaDesde, fechaHasta, page, pageSize, sortKey, sortDirection])

  // SWR para fetching con caché
  const { data, error, isLoading, mutate } = useSWR(apiUrl, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 5000,
    keepPreviousData: true,
  })

  // Extraer datos de la respuesta
  const ordenes: OrdenServicio[] = data?.data || []
  const total = data?.total || 0

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
    } else {
      setSortKey(key)
      setSortDirection("asc")
    }
  }

  const handlePrint = async (e: React.MouseEvent, orden: OrdenServicio) => {
    e.stopPropagation()
    try {
      const res = await fetch(`/api/ordenes/${orden.id}/pdf`)
      if (!res.ok) throw new Error("Error al generar PDF")
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const printWindow = window.open(url, "_blank")
      if (printWindow) {
        printWindow.addEventListener("load", () => {
          printWindow.print()
        })
      }
    } catch (error) {
      toast.error("Error al imprimir la orden")
    }
  }

  const handleDelete = async (e: React.MouseEvent, orden: OrdenServicio) => {
    e.stopPropagation()
    const codigoDisplay = orden.codigoOrden || `#${orden.numeroOrden}`
    const confirmed = await confirm({
      title: "Eliminar Orden",
      description: `¿Estás seguro de eliminar la Orden ${codigoDisplay}? Esta acción no se puede deshacer.`,
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      variant: "danger",
    })

    if (!confirmed) return

    setDeleting(orden.id)
    try {
      const res = await fetch(`/api/ordenes/${orden.id}`, {
        method: "DELETE",
      })

      if (!res.ok) {
        const error = await res.json()
        await showError(error.error || "Error al eliminar la orden")
        return
      }

      mutate() // Revalidar datos con SWR
    } catch (error) {
      console.error("Error deleting orden:", error)
      await showError("Error al eliminar la orden")
    } finally {
      setDeleting(null)
    }
  }

  const clearFilters = () => {
    setSearch("")
    setDebouncedSearch("")
    setEstado("")
    setFechaDesde("")
    setFechaHasta("")
    setPage(1)
  }

  const applyQuickFilter = (value: EstadoOrden) => {
    setEstado(estado === value ? "" : value)
    setPage(1)
  }

  const hasActiveFilters = search || estado || fechaDesde || fechaHasta

  const columns: Column<OrdenServicio>[] = [
    {
      key: "select",
      header: "",
      className: "w-[40px]",
      render: (orden) => (
        <input
          type="checkbox"
          checked={selectedIds.has(orden.id)}
          onChange={(e) => {
            e.stopPropagation()
            toggleSelect(orden.id)
          }}
          onClick={(e) => e.stopPropagation()}
          className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
        />
      ),
    },
    {
      key: "numeroOrden",
      header: "# Orden",
      sortable: true,
      className: "font-medium",
      render: (orden) => (
        <div className="flex items-center gap-1.5">
          <span className="text-primary font-semibold">
            {orden.codigoOrden || `#${orden.numeroOrden}`}
          </span>
          {isUrgente(orden) && (
            <span className="inline-flex items-center rounded-full bg-red-100 dark:bg-red-900/40 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:text-red-400">
              Vencida
            </span>
          )}
          {isProximaAVencer(orden) && (
            <span className="inline-flex items-center rounded-full bg-orange-100 dark:bg-orange-900/40 px-1.5 py-0.5 text-[10px] font-medium text-orange-700 dark:text-orange-400">
              Hoy
            </span>
          )}
        </div>
      ),
    },
    {
      key: "estado",
      header: "Estado",
      sortable: true,
      render: (orden) => <OrderStatusBadge status={orden.estado} showIcon />,
    },
    {
      key: "cliente",
      header: "Cliente",
      sortable: false,
      render: (orden) => (
        <div>
          <div className="font-medium">{orden.cliente?.nombre || "-"}</div>
          <div className="text-xs text-muted-foreground">
            {orden.cliente?.telefono}
          </div>
        </div>
      ),
    },
    {
      key: "dispositivo",
      header: "Dispositivo",
      sortable: true,
      render: (orden) => (
        <div>
          <div>{orden.dispositivo}</div>
          <div className="text-xs text-muted-foreground">
            {orden.tipoDispositivo} {orden.marca && `• ${orden.marca}`}
          </div>
        </div>
      ),
    },
    {
      key: "tecnico",
      header: "Técnico",
      sortable: false,
      hideOnTablet: true,
      render: (orden) => orden.tecnico?.nombre || "-",
    },
    {
      key: "fechaIngreso",
      header: "Fecha Ingreso",
      sortable: true,
      hideOnMobile: true,
      render: (orden) => formatDate(orden.fechaIngreso),
    },
    {
      key: "presupuesto",
      header: "Presupuesto",
      sortable: true,
      headerClassName: "text-right",
      className: "text-right",
      hideOnMobile: true,
      render: (orden) =>
        orden.presupuesto ? (
          <span className="font-medium">{formatPrice(orden.presupuesto)}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: "actions",
      header: "",
      className: "w-auto sm:w-[130px]",
      render: (orden) => (
        <div role="group" className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <Link href={`/ordenes/${orden.id}`}>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <Eye className="h-4 w-4" />
            </Button>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-primary"
            onClick={(e) => handlePrint(e, orden)}
            title="Imprimir"
          >
            <Printer className="h-4 w-4" />
          </Button>
          {!isTecnico && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={(e) => handleDelete(e, orden)}
              disabled={deleting === orden.id}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ]

  const visibleColumns = isTecnico ? columns.filter(c => c.key !== "tecnico") : columns

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex-1 w-full sm:w-auto">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar orden, cliente, dispositivo..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-10 w-full sm:max-w-sm"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap sm:flex-nowrap">
          <Button
            variant={showFilters ? "secondary" : "outline"}
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="gap-2"
          >
            <Filter className="h-4 w-4" />
            Filtros
            {hasActiveFilters && (
              <span className="ml-1 rounded-full bg-primary text-primary-foreground text-xs px-1.5">
                !
              </span>
            )}
          </Button>
          <ExportButton
            entity="ordenes"
            filters={{
              ...(estado && { estado }),
              ...(fechaDesde && { desde: fechaDesde }),
              ...(fechaHasta && { hasta: fechaHasta }),
            }}
            variant="outline"
            size="sm"
          />
          <Button onClick={() => setShowForm(true)} size="sm" className="gap-1.5 ml-auto">
            <Plus className="h-4 w-4" />
            Nueva
          </Button>
        </div>
      </div>

      {/* Quick filter chips - only for tecnico */}
      {isTecnico && quickFilters.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {quickFilters.map((qf) => (
            <button
              key={qf.value}
              onClick={() => applyQuickFilter(qf.value)}
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-colors border ${
                estado === qf.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
              }`}
            >
              {qf.label}
            </button>
          ))}
        </div>
      )}

      {/* Filters Panel */}
      {showFilters && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:flex md:flex-wrap items-center gap-3 p-4 bg-muted/30 rounded-lg border">
          <Select
            value={estado || "all"}
            onValueChange={(value) => {
              setEstado(value === "all" ? "" : value as EstadoOrden)
              setPage(1)
            }}
          >
            <SelectTrigger className="w-full sm:w-auto sm:min-w-[180px]">
              <SelectValue placeholder="Todos los estados" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              {estadoOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <DatePicker
            placeholder="Desde"
            value={fechaDesde}
            onChange={(value) => {
              setFechaDesde(value)
              setPage(1)
            }}
          />

          <DatePicker
            placeholder="Hasta"
            value={fechaHasta}
            onChange={(value) => {
              setFechaHasta(value)
              setPage(1)
            }}
          />

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="gap-1 text-muted-foreground w-full sm:w-auto"
            >
              <X className="h-4 w-4" />
              Limpiar
            </Button>
          )}
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <OrdenForm
          onClose={() => setShowForm(false)}
          onSuccess={() => {
            setShowForm(false)
            mutate() // Revalidar datos con SWR
          }}
        />
      )}

      {/* Total count + bulk actions */}
      {!isLoading && total > 0 && (
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={toggleSelectAll}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <CheckSquare className="h-4 w-4" />
              {selectedIds.size > 0
                ? `${selectedIds.size} seleccionada${selectedIds.size > 1 ? "s" : ""}`
                : "Seleccionar"}
            </button>
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2">
                <Select
                  value=""
                  onValueChange={(value) => handleBulkEstado(value as EstadoOrden)}
                  disabled={bulkUpdating}
                >
                  <SelectTrigger className="h-8 w-auto min-w-[180px] text-xs">
                    <SelectValue placeholder="Cambiar estado a..." />
                  </SelectTrigger>
                  <SelectContent>
                    {estadoOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedIds(new Set())}
                  className="h-8 text-xs"
                >
                  Cancelar
                </Button>
              </div>
            )}
          </div>
          <div className="text-sm text-muted-foreground">
            Mostrando {ordenes.length} de {total} órdenes
            {hasActiveFilters && " (filtradas)"}
          </div>
        </div>
      )}

      {/* Desktop: Data Table */}
      <div className="hidden sm:block">
        <DataTable
          data={ordenes}
          columns={visibleColumns}
          keyExtractor={(orden) => orden.id}
          loading={isLoading}
          emptyMessage="No hay órdenes registradas. Crea tu primera orden con el botón + Nueva"
          sortKey={sortKey}
          sortDirection={sortDirection}
          onSort={handleSort}
          onRowClick={(orden) => router.push(`/ordenes/${orden.id}`)}
          pagination={{
            page,
            pageSize,
            total,
            onPageChange: setPage,
            onPageSizeChange: (size) => {
              setPageSize(size)
              setPage(1)
            },
          }}
        />
      </div>

      {/* Mobile: Cards */}
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
        ) : ordenes.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-sm text-muted-foreground mb-3">No hay órdenes registradas</p>
              <Button size="sm" onClick={() => setShowForm(true)} className="gap-1.5">
                <Plus className="h-4 w-4" />
                Crear primera orden
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="space-y-3">
              {ordenes.map((orden) => (
                <OrdenMobileCard
                  key={orden.id}
                  orden={orden}
                  onDelete={handleDelete}
                  onPrint={handlePrint}
                  deleting={deleting === orden.id}
                  onClick={() => router.push(`/ordenes/${orden.id}`)}
                />
              ))}
            </div>
            {total > pageSize && (
              <div className="mt-4">
                <DataTablePagination
                  page={page}
                  pageSize={pageSize}
                  total={total}
                  dataLength={ordenes.length}
                  onPageChange={setPage}
                  onPageSizeChange={(size) => {
                    setPageSize(size)
                    setPage(1)
                  }}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
