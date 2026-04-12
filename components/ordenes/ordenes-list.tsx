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

const ESTADOS_FINALES = ["ENTREGADO", "ENTREGADO_SIN_REPARACION", "CANCELADO", "SIN_REPARACION"]

function isUrgente(orden: OrdenServicio): boolean {
  if (!orden.fechaPrometida || ESTADOS_FINALES.includes(orden.estado)) return false
  return new Date(orden.fechaPrometida) < new Date()
}

function isProximaAVencer(orden: OrdenServicio): boolean {
  if (!orden.fechaPrometida || ESTADOS_FINALES.includes(orden.estado)) return false
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
  ENTREGADO_SIN_REPARACION: "Retirado sin Reparación",
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
  { value: "ENTREGADO_SIN_REPARACION", label: "Retirado sin Reparación" },
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
  const [tecnicoIdFilter, setTecnicoIdFilter] = useState("")
  const [tipoDispositivoFilter, setTipoDispositivoFilter] = useState("")
  const [marcaFilter, setMarcaFilter] = useState("")
  const [estadoCobroFilter, setEstadoCobroFilter] = useState("")
  const [conPresupuestoFilter, setConPresupuestoFilter] = useState("")
  const [conSenaFilter, setConSenaFilter] = useState("")
  const [fechaPrometidaDesde, setFechaPrometidaDesde] = useState("")
  const [fechaPrometidaHasta, setFechaPrometidaHasta] = useState("")
  const [showFilters, setShowFilters] = useState(false)

  // Quick filter for vencimiento (separate from estado quick filters)
  const [quickFilterActive, setQuickFilterActive] = useState("")

  // Fetch técnicos for filter dropdown
  const { data: tecnicosData } = useSWR(!isTecnico ? "/api/tecnicos" : null, fetcher)
  const tecnicos: { id: string; nombre: string }[] = tecnicosData || []

  // Fetch tipos de dispositivo for filter dropdown
  const { data: tiposData } = useSWR("/api/tipos-dispositivo", fetcher)
  const tiposDispositivo: { id: string; nombre: string; codigo: string }[] = tiposData || []

  const tecnicoQuickFilters = isTecnico ? [
    { label: "Sin diagnóstico", value: "RECIBIDO" as EstadoOrden },
    { label: "En reparación", value: "EN_REPARACION" as EstadoOrden },
    { label: "Esperando repuesto", value: "ESPERANDO_REPUESTO" as EstadoOrden },
    { label: "Listo para entregar", value: "REPARADO" as EstadoOrden },
  ] : []

  type QuickFilterKey = "vencidas" | "venceHoy" | "pendientesCobro" | "sinTecnico"
  const generalQuickFilters: { label: string; value: QuickFilterKey }[] = [
    { label: "Vencidas", value: "vencidas" },
    { label: "Vence hoy", value: "venceHoy" },
    { label: "Pendientes de cobro", value: "pendientesCobro" },
    ...(!isTecnico ? [{ label: "Sin técnico", value: "sinTecnico" as QuickFilterKey }] : []),
  ]

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
    if (tecnicoIdFilter) params.append("tecnicoId", tecnicoIdFilter)
    if (tipoDispositivoFilter) params.append("tipoDispositivo", tipoDispositivoFilter)
    if (marcaFilter) params.append("marca", marcaFilter)
    if (estadoCobroFilter) params.append("estadoCobro", estadoCobroFilter)
    if (conPresupuestoFilter) params.append("conPresupuesto", conPresupuestoFilter)
    if (conSenaFilter) params.append("conSena", conSenaFilter)
    if (fechaPrometidaDesde) params.append("fechaPrometidaDesde", fechaPrometidaDesde)
    if (fechaPrometidaHasta) params.append("fechaPrometidaHasta", fechaPrometidaHasta)
    // Quick filters that map to backend params
    if (quickFilterActive === "vencidas") params.append("vencimiento", "vencidas")
    if (quickFilterActive === "venceHoy") params.append("vencimiento", "venceHoy")
    if (quickFilterActive === "pendientesCobro") params.append("estadoCobro", "PENDIENTE")
    if (quickFilterActive === "sinTecnico") params.append("sinTecnico", "true")
    params.append("page", page.toString())
    params.append("limit", pageSize.toString())
    params.append("sortBy", sortKey)
    params.append("sortOrder", sortDirection)
    return `/api/ordenes?${params.toString()}`
  }, [debouncedSearch, estado, fechaDesde, fechaHasta, tecnicoIdFilter, tipoDispositivoFilter, marcaFilter, estadoCobroFilter, conPresupuestoFilter, conSenaFilter, fechaPrometidaDesde, fechaPrometidaHasta, quickFilterActive, page, pageSize, sortKey, sortDirection])

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
    setTecnicoIdFilter("")
    setTipoDispositivoFilter("")
    setMarcaFilter("")
    setEstadoCobroFilter("")
    setConPresupuestoFilter("")
    setConSenaFilter("")
    setFechaPrometidaDesde("")
    setFechaPrometidaHasta("")
    setQuickFilterActive("")
    setPage(1)
  }

  const applyQuickFilter = (value: EstadoOrden) => {
    setEstado(estado === value ? "" : value)
    setPage(1)
  }

  const applyGeneralQuickFilter = (value: QuickFilterKey) => {
    setQuickFilterActive(quickFilterActive === value ? "" : value)
    setPage(1)
  }

  const hasActiveFilters = search || estado || fechaDesde || fechaHasta || tecnicoIdFilter || tipoDispositivoFilter || marcaFilter || estadoCobroFilter || conPresupuestoFilter || conSenaFilter || fechaPrometidaDesde || fechaPrometidaHasta || quickFilterActive

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
        <span className="text-primary font-semibold">
          {orden.codigoOrden || `#${orden.numeroOrden}`}
        </span>
      ),
    },
    {
      key: "estado",
      header: "Estado",
      sortable: true,
      render: (orden) => (
        <div className="flex flex-col gap-0.5">
          <OrderStatusBadge status={orden.estado} showIcon />
          {isUrgente(orden) && (
            <span className="text-[10px] font-medium text-red-600 dark:text-red-400">Vencida</span>
          )}
          {isProximaAVencer(orden) && (
            <span className="text-[10px] font-medium text-orange-600 dark:text-orange-400">Vence hoy</span>
          )}
        </div>
      ),
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
          {!isTecnico && (
            <ExportButton
              entity="ordenes"
              filters={{
                ...(estado && { estado }),
                ...(fechaDesde && { desde: fechaDesde }),
                ...(fechaHasta && { hasta: fechaHasta }),
                ...(tecnicoIdFilter && { tecnicoId: tecnicoIdFilter }),
                ...(tipoDispositivoFilter && { tipoDispositivo: tipoDispositivoFilter }),
                ...(marcaFilter && { marca: marcaFilter }),
                ...(estadoCobroFilter && { estadoCobro: estadoCobroFilter }),
              }}
              variant="outline"
              size="sm"
            />
          )}
          <Button onClick={() => setShowForm(true)} size="sm" className="gap-1.5 ml-auto">
            <Plus className="h-4 w-4" />
            Nueva
          </Button>
        </div>
      </div>

      {/* Quick filter chips */}
      <div className="flex flex-wrap gap-2">
        {/* Estado quick filters for tecnico */}
        {isTecnico && tecnicoQuickFilters.map((qf) => (
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
        {/* General quick filters for all roles */}
        {generalQuickFilters.map((qf) => (
          <button
            key={qf.value}
            onClick={() => applyGeneralQuickFilter(qf.value)}
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-colors border ${
              quickFilterActive === qf.value
                ? qf.value === "vencidas" ? "bg-red-500 text-white border-red-500"
                  : qf.value === "venceHoy" ? "bg-orange-500 text-white border-orange-500"
                  : "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
            }`}
          >
            {qf.label}
          </button>
        ))}
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="space-y-3 p-4 bg-muted/30 rounded-lg border">
          {/* Row 1: Estado, Técnico, Tipo dispositivo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <Select
              value={estado || "all"}
              onValueChange={(value) => {
                setEstado(value === "all" ? "" : value as EstadoOrden)
                setPage(1)
              }}
            >
              <SelectTrigger>
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

            {!isTecnico && (
              <Select
                value={tecnicoIdFilter || "all"}
                onValueChange={(value) => {
                  setTecnicoIdFilter(value === "all" ? "" : value)
                  setPage(1)
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todos los técnicos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los técnicos</SelectItem>
                  {tecnicos.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Select
              value={tipoDispositivoFilter || "all"}
              onValueChange={(value) => {
                setTipoDispositivoFilter(value === "all" ? "" : value)
                setPage(1)
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Todos los tipos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los tipos</SelectItem>
                {tiposDispositivo.map((t) => (
                  <SelectItem key={t.id || t.codigo} value={t.codigo}>
                    {t.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              placeholder="Filtrar por marca..."
              value={marcaFilter}
              onChange={(e) => {
                setMarcaFilter(e.target.value)
                setPage(1)
              }}
              className="h-9"
            />
          </div>

          {/* Row 2: Estado cobro, Presupuesto, Seña, Fechas ingreso */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <Select
              value={estadoCobroFilter || "all"}
              onValueChange={(value) => {
                setEstadoCobroFilter(value === "all" ? "" : value)
                setPage(1)
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Estado de cobro" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los cobros</SelectItem>
                <SelectItem value="PENDIENTE">Pendiente</SelectItem>
                <SelectItem value="PARCIAL">Parcial</SelectItem>
                <SelectItem value="COBRADO">Cobrado</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={conPresupuestoFilter || "all"}
              onValueChange={(value) => {
                setConPresupuestoFilter(value === "all" ? "" : value)
                setPage(1)
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Presupuesto" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Con/sin presupuesto</SelectItem>
                <SelectItem value="si">Con presupuesto</SelectItem>
                <SelectItem value="no">Sin presupuesto</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={conSenaFilter || "all"}
              onValueChange={(value) => {
                setConSenaFilter(value === "all" ? "" : value)
                setPage(1)
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seña" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Con/sin seña</SelectItem>
                <SelectItem value="si">Con seña</SelectItem>
                <SelectItem value="no">Sin seña</SelectItem>
              </SelectContent>
            </Select>

            <DatePicker
              placeholder="Ingreso desde"
              value={fechaDesde}
              onChange={(value) => {
                setFechaDesde(value)
                setPage(1)
              }}
            />
          </div>

          {/* Row 3: Fechas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <DatePicker
              placeholder="Ingreso hasta"
              value={fechaHasta}
              onChange={(value) => {
                setFechaHasta(value)
                setPage(1)
              }}
            />

            <DatePicker
              placeholder="Prometida desde"
              value={fechaPrometidaDesde}
              onChange={(value) => {
                setFechaPrometidaDesde(value)
                setPage(1)
              }}
            />

            <DatePicker
              placeholder="Prometida hasta"
              value={fechaPrometidaHasta}
              onChange={(value) => {
                setFechaPrometidaHasta(value)
                setPage(1)
              }}
            />

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="gap-1 text-muted-foreground h-9"
              >
                <X className="h-4 w-4" />
                Limpiar filtros
              </Button>
            )}
          </div>
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
                  <SelectTrigger className="h-8 w-full sm:w-auto sm:min-w-[180px] text-xs">
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
          rowClassName={(orden) =>
            isUrgente(orden)
              ? "border-l-3 border-l-red-400 dark:border-l-red-500 bg-red-50/30 dark:bg-red-950/10"
              : isProximaAVencer(orden)
                ? "border-l-3 border-l-orange-400 dark:border-l-orange-500 bg-orange-50/30 dark:bg-orange-950/10"
                : ""
          }
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
                  hideDelete={isTecnico}
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
