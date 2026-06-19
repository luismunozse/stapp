"use client"

import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DataTable, DataTablePagination, type Column } from "@/components/ui/data-table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Plus, Search, Phone, Mail, Edit, Trash2, User, Building2, Upload, PiggyBank, DollarSign, MoreHorizontal, Users, Wrench, Receipt } from "lucide-react"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"
import { ClienteForm } from "./cliente-form"
import { CuentaCorrienteDialog } from "@/components/clientes/cuenta-corriente-dialog"
import { CobrarMultipleDialog } from "@/components/ordenes/cobrar-multiple-dialog"
import { ImportModal } from "@/components/import/import-modal"
import { ExportButton } from "@/components/export/export-button"
import { ClienteMobileCard } from "./cliente-mobile-card"
import { ClienteWhatsAppDialog } from "./cliente-whatsapp-dialog"
import { Card, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { Cliente } from "@/types"
import { useModal } from "@/contexts/modal-context"
import { useCurrency } from "@/contexts/currency-context"

const fetcher = (url: string) => fetch(url).then(res => res.json())

interface ClientesListProps {
  allowImport?: boolean
}

export function ClientesList({ allowImport = true }: ClientesListProps) {
  const router = useRouter()
  const { confirm, showError } = useModal()
  const { formatDate, formatPrice } = useCurrency()
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editingCliente, setEditingCliente] = useState<Cliente | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [cuentaCorrienteCliente, setCuentaCorrienteCliente] = useState<Cliente | null>(null)
  const [cobrarCliente, setCobrarCliente] = useState<Cliente | null>(null)
  const [whatsappCliente, setWhatsappCliente] = useState<Cliente | null>(null)

  // Filters
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [tipoCliente, setTipoCliente] = useState<string>("")
  const [conDeuda, setConDeuda] = useState(false)
  const [aceptaWhatsapp, setAceptaWhatsapp] = useState<string>("")
  const [fechaDesde, setFechaDesde] = useState<string>("")
  const [fechaHasta, setFechaHasta] = useState<string>("")

  // Sorting
  const [sortKey, setSortKey] = useState<string>("createdAt")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc")

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

  const onFilterChange = (fn: () => void) => { fn(); setPage(1) }

  // Build API URL for SWR
  const apiUrl = useMemo(() => {
    const params = new URLSearchParams()
    if (debouncedSearch) params.append("search", debouncedSearch)
    params.append("page", page.toString())
    params.append("limit", pageSize.toString())
    params.append("sortBy", sortKey)
    params.append("sortOrder", sortDirection)
    if (tipoCliente) params.append("tipoCliente", tipoCliente)
    if (conDeuda) params.append("conDeuda", "true")
    if (aceptaWhatsapp) params.append("aceptaWhatsapp", aceptaWhatsapp)
    if (fechaDesde) params.append("fechaDesde", fechaDesde)
    if (fechaHasta) params.append("fechaHasta", fechaHasta)
    return `/api/clientes?${params.toString()}`
  }, [debouncedSearch, page, pageSize, sortKey, sortDirection, tipoCliente, conDeuda, aceptaWhatsapp, fechaDesde, fechaHasta])

  // SWR for fetching with cache
  const { data, isLoading, mutate } = useSWR(apiUrl, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 5000,
    keepPreviousData: true,
  })

  // Fetch org name for WhatsApp dialog
  const { data: configData } = useSWR("/api/configuracion", fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60000,
  })
  const organizationName: string = configData?.nombreEmpresa || ""

  // Extract data from response
  const clientes: Cliente[] = data?.data || (Array.isArray(data) ? data : [])
  const total = data?.total || (Array.isArray(data) ? data.length : 0)
  const totalDeuda: number = data?.totalDeuda || 0

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
    } else {
      setSortKey(key)
      setSortDirection("asc")
    }
  }

  const handleEdit = (e: React.MouseEvent, cliente: Cliente) => {
    e.stopPropagation()
    setEditingCliente(cliente)
    setShowForm(true)
  }

  const handleDelete = async (e: React.MouseEvent, cliente: Cliente) => {
    e.stopPropagation()
    const confirmed = await confirm({
      title: "Eliminar Cliente",
      description: `¿Estás seguro de eliminar a "${cliente.nombre}"? Esta acción no se puede deshacer.`,
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      variant: "danger",
    })

    if (!confirmed) return

    setDeleting(cliente.id)
    try {
      const res = await fetch(`/api/clientes/${cliente.id}`, { method: "DELETE" })
      if (!res.ok) {
        const error = await res.json()
        await showError(error.error || "Error al eliminar el cliente")
        return
      }
      mutate()
    } catch (error) {
      console.error("Error deleting cliente:", error)
      await showError("Error al eliminar el cliente")
    } finally {
      setDeleting(null)
    }
  }

  const columns: Column<Cliente>[] = [
    {
      key: "nombre",
      header: "Cliente",
      sortable: true,
      render: (cliente) => (
        <div className="flex items-center gap-3">
          <div className={`h-9 w-9 rounded-full flex items-center justify-center ${
            cliente.tipoCliente === "EMPRESA" ? "bg-warning/10" : "bg-primary/10"
          }`}>
            {cliente.tipoCliente === "EMPRESA" ? (
              <Building2 className="h-4 w-4 text-warning-600" />
            ) : (
              <User className="h-4 w-4 text-primary" />
            )}
          </div>
          <div>
            <div className="font-medium flex items-center gap-2">
              {cliente.nombre}
              {cliente.tipoCliente === "EMPRESA" && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-warning/10 text-warning-700">
                  Empresa
                </span>
              )}
            </div>
            {cliente.razonSocial && (
              <div className="text-xs text-muted-foreground">{cliente.razonSocial}</div>
            )}
            {!cliente.razonSocial && cliente.dni && (
              <div className="text-xs text-muted-foreground">DNI: {cliente.dni}</div>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "telefono",
      header: "Teléfono",
      sortable: true,
      render: (cliente) => (
        <div className="flex items-center gap-2">
          <Phone className="h-4 w-4 text-muted-foreground" />
          <span>{cliente.telefono}</span>
        </div>
      ),
    },
    {
      key: "email",
      header: "Email",
      sortable: true,
      hideOnMobile: true,
      render: (cliente) =>
        cliente.email ? (
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <span className="truncate max-w-[200px]">{cliente.email}</span>
          </div>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: "direccion",
      header: "Dirección",
      sortable: false,
      hideOnTablet: true,
      render: (cliente) =>
        cliente.direccion ? (
          <span className="truncate max-w-[200px]">{cliente.direccion}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: "createdAt",
      header: "Registrado",
      sortable: true,
      hideOnMobile: true,
      render: (cliente) => formatDate(cliente.createdAt),
    },
    {
      key: "saldoCuenta",
      header: "Crédito",
      sortable: false,
      hideOnMobile: true,
      render: (cliente) => {
        const saldo = cliente.saldoCuenta || 0
        if (saldo <= 0) return <span className="text-muted-foreground">-</span>
        return (
          <button
            type="button"
            className="flex items-center gap-1 text-info-600 hover:text-info-700 font-medium text-sm"
            onClick={(e) => { e.stopPropagation(); setCuentaCorrienteCliente(cliente) }}
          >
            <PiggyBank className="h-3.5 w-3.5" />
            {formatPrice(saldo)}
          </button>
        )
      },
    },
    {
      key: "deudaPendiente",
      header: "Deuda",
      sortable: true,
      hideOnTablet: true,
      render: (cliente) => {
        const d = cliente.deudaPendiente || 0
        if (d <= 0) return <span className="text-muted-foreground">-</span>
        return <span className="font-medium text-destructive tabular-nums">{formatPrice(d)}</span>
      },
    },
    {
      key: "ordenes",
      header: "Órdenes",
      sortable: true,
      hideOnMobile: true,
      render: (cliente) => <span className="tabular-nums">{cliente.ordenesCount ?? 0}</span>,
    },
    {
      key: "ultimaVisita",
      header: "Última visita",
      sortable: true,
      hideOnMobile: true,
      render: (cliente) => cliente.ultimaVisita ? formatDate(cliente.ultimaVisita) : <span className="text-muted-foreground">-</span>,
    },
    {
      key: "actions",
      header: "",
      className: "w-auto sm:w-[80px]",
      render: (cliente) => (
        <div role="group" className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => handleEdit(e, cliente)}
            title="Editar"
            aria-label="Editar"
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground"
                onClick={(e) => e.stopPropagation()}
                title="Más acciones"
                aria-label="Más acciones"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-48 p-1">
              <button
                type="button"
                className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors"
                onClick={(e) => { e.stopPropagation(); router.push(`/ordenes?clienteId=${cliente.id}`) }}
              >
                <Wrench className="h-4 w-4" />
                Nueva orden
              </button>
              <button
                type="button"
                className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors"
                onClick={(e) => { e.stopPropagation(); router.push(`/cotizaciones?clienteId=${cliente.id}`) }}
              >
                <Receipt className="h-4 w-4" />
                Nueva cotización
              </button>
              <div className="h-px bg-border my-1" />
              <button
                type="button"
                className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors"
                onClick={(e) => { e.stopPropagation(); setWhatsappCliente(cliente) }}
              >
                <WhatsAppIcon className="h-4 w-4 text-success-600" />
                Enviar WhatsApp
              </button>
              <button
                type="button"
                className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors"
                onClick={(e) => { e.stopPropagation(); setCobrarCliente(cliente) }}
              >
                <DollarSign className="h-4 w-4 text-success-600" />
                Cobrar órdenes
              </button>
              <button
                type="button"
                className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors"
                onClick={(e) => { e.stopPropagation(); setCuentaCorrienteCliente(cliente) }}
              >
                <PiggyBank className="h-4 w-4 text-info-600" />
                Cuenta corriente
              </button>
              <div className="h-px bg-border my-1" />
              <button
                type="button"
                className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-md hover:bg-destructive/10 text-destructive transition-colors"
                onClick={(e) => handleDelete(e, cliente)}
                disabled={deleting === cliente.id}
              >
                <Trash2 className="h-4 w-4" />
                Eliminar
              </button>
            </PopoverContent>
          </Popover>
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
              placeholder="Buscar por nombre, teléfono, DNI o sector..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-10 w-full sm:max-w-sm"
            />
          </div>
        </div>
        <div className="grid grid-cols-3 sm:flex sm:items-center gap-2 w-full sm:w-auto">
          <ExportButton
            entity="clientes"
            filters={{ ...(search && { search }) }}
            variant="outline"
            size="sm"
            label="Exportar"
          />
          {allowImport && (
            <Button onClick={() => setShowImport(true)} variant="outline" size="sm" className="gap-1.5">
              <Upload className="h-4 w-4" />
              <span className="hidden sm:inline">Importar CSV</span>
              <span className="sm:hidden">Importar</span>
            </Button>
          )}
          <Button onClick={() => setShowForm(true)} size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            Nuevo
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-2">
        <Select value={tipoCliente || "TODOS"} onValueChange={(v) => onFilterChange(() => setTipoCliente(v === "TODOS" ? "" : v))}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="TODOS">Todos los tipos</SelectItem>
            <SelectItem value="INDIVIDUAL">Individual</SelectItem>
            <SelectItem value="EMPRESA">Empresa</SelectItem>
          </SelectContent>
        </Select>

        <Select value={aceptaWhatsapp || "TODOS"} onValueChange={(v) => onFilterChange(() => setAceptaWhatsapp(v === "TODOS" ? "" : v))}>
          <SelectTrigger className="w-[170px]"><SelectValue placeholder="WhatsApp" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="TODOS">WhatsApp: todos</SelectItem>
            <SelectItem value="true">Acepta WhatsApp</SelectItem>
            <SelectItem value="false">No acepta</SelectItem>
          </SelectContent>
        </Select>

        <input
          type="date"
          value={fechaDesde}
          onChange={(e) => onFilterChange(() => setFechaDesde(e.target.value))}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          aria-label="Fecha desde"
        />
        <input
          type="date"
          value={fechaHasta}
          onChange={(e) => onFilterChange(() => setFechaHasta(e.target.value))}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          aria-label="Fecha hasta"
        />

        <label className="flex items-center gap-2 text-sm">
          <Switch checked={conDeuda} onCheckedChange={(v) => onFilterChange(() => setConDeuda(!!v))} />
          Solo con deuda
        </label>

        {(tipoCliente || conDeuda || aceptaWhatsapp || fechaDesde || fechaHasta) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onFilterChange(() => {
              setTipoCliente("")
              setConDeuda(false)
              setAceptaWhatsapp("")
              setFechaDesde("")
              setFechaHasta("")
            })}
          >
            Limpiar
          </Button>
        )}
      </div>

      {/* Form Modal */}
      <ClienteForm
        open={showForm}
        cliente={editingCliente}
        onClose={() => {
          setShowForm(false)
          setEditingCliente(null)
        }}
        onSuccess={() => {
          setShowForm(false)
          setEditingCliente(null)
          mutate()
        }}
      />

      {/* Import Modal */}
      {showImport && (
        <ImportModal
          entityType="CLIENTES"
          onClose={() => setShowImport(false)}
          onSuccess={() => {
            setShowImport(false)
            mutate()
          }}
        />
      )}

      {/* Cuenta Corriente Dialog */}
      {cuentaCorrienteCliente && (
        <CuentaCorrienteDialog
          open={!!cuentaCorrienteCliente}
          onOpenChange={(open) => !open && setCuentaCorrienteCliente(null)}
          cliente={cuentaCorrienteCliente}
          onDeposito={() => mutate()}
        />
      )}

      {/* Cobrar Múltiple Dialog */}
      {cobrarCliente && (
        <CobrarMultipleDialog
          open={!!cobrarCliente}
          onOpenChange={(open) => !open && setCobrarCliente(null)}
          clienteId={cobrarCliente.id}
          clienteNombre={cobrarCliente.nombre}
          onSuccess={() => {
            setCobrarCliente(null)
            mutate()
          }}
        />
      )}

      {/* WhatsApp Dialog */}
      {whatsappCliente && (
        <ClienteWhatsAppDialog
          open={!!whatsappCliente}
          onOpenChange={(open) => !open && setWhatsappCliente(null)}
          cliente={whatsappCliente}
          organizationName={organizationName}
        />
      )}

      {/* Total adeudado bar */}
      {conDeuda && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm">
          <span className="text-muted-foreground">Total adeudado:</span>
          <span className="font-semibold text-destructive tabular-nums">{formatPrice(totalDeuda)}</span>
        </div>
      )}

      {/* Desktop: Data Table */}
      <div className="hidden sm:block">
        <DataTable
          data={clientes}
          columns={columns}
          keyExtractor={(cliente) => cliente.id}
          loading={isLoading}
          emptyMessage="No hay clientes registrados"
          sortKey={sortKey}
          sortDirection={sortDirection}
          onSort={handleSort}
          onRowClick={(cliente) => router.push(`/clientes/${cliente.id}`)}
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
        ) : clientes.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No hay clientes registrados"
            variant="search"
            action={{ label: "Nuevo cliente", onClick: () => setShowForm(true) }}
          />
        ) : (
          <>
            <div className="space-y-3">
              {clientes.map((cliente) => (
                <ClienteMobileCard
                  key={cliente.id}
                  cliente={cliente}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onWhatsApp={(e, c) => { e.stopPropagation(); setWhatsappCliente(c) }}
                  onCuentaCorriente={(e, c) => { e.stopPropagation(); setCuentaCorrienteCliente(c) }}
                  onCobrar={(e, c) => { e.stopPropagation(); setCobrarCliente(c) }}
                  deleting={deleting === cliente.id}
                />
              ))}
            </div>
            {total > pageSize && (
              <div className="mt-4">
                <DataTablePagination
                  page={page}
                  pageSize={pageSize}
                  total={total}
                  dataLength={clientes.length}
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
