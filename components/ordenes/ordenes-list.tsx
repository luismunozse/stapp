"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { DataTable, type Column } from "@/components/ui/data-table"
import { OrderStatusBadge } from "@/components/ui/badge"
import {
  Plus,
  Search,
  Eye,
  Trash2,
  Filter,
  X,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { OrdenForm } from "./orden-form"
import { useModal } from "@/contexts/modal-context"
import { formatDate, formatCurrency } from "@/lib/utils"
import type { OrdenServicio, EstadoOrden } from "@/types"

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
  const [ordenes, setOrdenes] = useState<OrdenServicio[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const { confirm, showError } = useModal()

  // Filters
  const [search, setSearch] = useState("")
  const [estado, setEstado] = useState<EstadoOrden | "">("")
  const [fechaDesde, setFechaDesde] = useState("")
  const [fechaHasta, setFechaHasta] = useState("")
  const [showFilters, setShowFilters] = useState(false)

  // Sorting
  const [sortKey, setSortKey] = useState<string>("fechaIngreso")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc")

  // Pagination
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [total, setTotal] = useState(0)

  const fetchOrdenes = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.append("search", search)
      if (estado) params.append("estado", estado)
      if (fechaDesde) params.append("fechaDesde", fechaDesde)
      if (fechaHasta) params.append("fechaHasta", fechaHasta)
      params.append("page", page.toString())
      params.append("limit", pageSize.toString())
      params.append("sortBy", sortKey)
      params.append("sortOrder", sortDirection)

      const res = await fetch(`/api/ordenes?${params.toString()}`)
      const data = await res.json()

      if (Array.isArray(data)) {
        setOrdenes(data)
        setTotal(data.length)
      } else if (data.data) {
        setOrdenes(data.data)
        setTotal(data.total || data.data.length)
      }
    } catch (error) {
      console.error("Error fetching ordenes:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const debounce = setTimeout(() => {
      fetchOrdenes()
    }, 300)
    return () => clearTimeout(debounce)
  }, [search, estado, fechaDesde, fechaHasta, page, pageSize, sortKey, sortDirection])

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
    } else {
      setSortKey(key)
      setSortDirection("asc")
    }
  }

  const handleDelete = async (e: React.MouseEvent, orden: OrdenServicio) => {
    e.stopPropagation()
    const confirmed = await confirm({
      title: "Eliminar Orden",
      description: `¿Estás seguro de eliminar la Orden #${orden.numeroOrden}? Esta acción no se puede deshacer.`,
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

      fetchOrdenes()
    } catch (error) {
      console.error("Error deleting orden:", error)
      await showError("Error al eliminar la orden")
    } finally {
      setDeleting(null)
    }
  }

  const clearFilters = () => {
    setSearch("")
    setEstado("")
    setFechaDesde("")
    setFechaHasta("")
    setPage(1)
  }

  const hasActiveFilters = search || estado || fechaDesde || fechaHasta

  const columns: Column<OrdenServicio>[] = [
    {
      key: "numeroOrden",
      header: "# Orden",
      sortable: true,
      className: "font-medium",
      render: (orden) => (
        <span className="text-primary font-semibold">#{orden.numeroOrden}</span>
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
      render: (orden) => orden.tecnico?.nombre || "-",
    },
    {
      key: "fechaIngreso",
      header: "Fecha Ingreso",
      sortable: true,
      render: (orden) => formatDate(orden.fechaIngreso),
    },
    {
      key: "presupuesto",
      header: "Presupuesto",
      sortable: true,
      headerClassName: "text-right",
      className: "text-right",
      render: (orden) =>
        orden.presupuesto ? (
          <span className="font-medium">{formatCurrency(orden.presupuesto)}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: "actions",
      header: "",
      className: "w-[100px]",
      render: (orden) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Link href={`/ordenes/${orden.id}`}>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <Eye className="h-4 w-4" />
            </Button>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={(e) => handleDelete(e, orden)}
            disabled={deleting === orden.id}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex-1 w-full sm:w-auto">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por número, dispositivo o cliente..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              className="pl-10 w-full sm:w-[350px]"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
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
          <Button onClick={() => setShowForm(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Nueva Orden
          </Button>
        </div>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="flex flex-wrap items-center gap-3 p-4 bg-muted/30 rounded-lg border">
          <Select
            value={estado}
            onChange={(e) => {
              setEstado(e.target.value as EstadoOrden | "")
              setPage(1)
            }}
            className="w-[180px]"
          >
            <option value="">Todos los estados</option>
            {estadoOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Desde:</span>
            <input
              type="date"
              value={fechaDesde}
              onChange={(e) => {
                setFechaDesde(e.target.value)
                setPage(1)
              }}
              className="h-9 px-3 rounded-md border border-input bg-background text-sm"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Hasta:</span>
            <input
              type="date"
              value={fechaHasta}
              onChange={(e) => {
                setFechaHasta(e.target.value)
                setPage(1)
              }}
              className="h-9 px-3 rounded-md border border-input bg-background text-sm"
            />
          </div>

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="gap-1 text-muted-foreground"
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
            fetchOrdenes()
          }}
        />
      )}

      {/* Data Table */}
      <DataTable
        data={ordenes}
        columns={columns}
        keyExtractor={(orden) => orden.id}
        loading={loading}
        emptyMessage="No hay órdenes registradas"
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
  )
}
