"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DataTable, DataTablePagination, type Column } from "@/components/ui/data-table"
import { Plus, Search, Phone, Mail, Edit, Trash2, User, Upload } from "lucide-react"
import { ClienteForm } from "./cliente-form"
import { ImportModal } from "@/components/import/import-modal"
import { ExportButton } from "@/components/export/export-button"
import { ClienteMobileCard } from "./cliente-mobile-card"
import { Card, CardContent } from "@/components/ui/card"
import { formatDate } from "@/lib/utils"
import type { Cliente } from "@/types"
import { useModal } from "@/contexts/modal-context"

interface ClientesListProps {
  allowImport?: boolean
}

export function ClientesList({ allowImport = true }: ClientesListProps) {
  const { confirm, showError } = useModal()
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editingCliente, setEditingCliente] = useState<Cliente | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  // Filters
  const [search, setSearch] = useState("")

  // Sorting
  const [sortKey, setSortKey] = useState<string>("createdAt")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc")

  // Pagination
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [total, setTotal] = useState(0)

  const fetchClientes = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.append("search", search)
      params.append("page", page.toString())
      params.append("limit", pageSize.toString())
      params.append("sortBy", sortKey)
      params.append("sortOrder", sortDirection)

      const res = await fetch(`/api/clientes?${params.toString()}`)
      const data = await res.json()

      if (Array.isArray(data)) {
        setClientes(data)
        setTotal(data.length)
      } else if (data.data) {
        setClientes(data.data)
        setTotal(data.total || data.data.length)
      }
    } catch (error) {
      console.error("Error fetching clientes:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const debounce = setTimeout(() => {
      fetchClientes()
    }, 300)
    return () => clearTimeout(debounce)
  }, [search, page, pageSize, sortKey, sortDirection])

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
      fetchClientes()
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
          <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
            <User className="h-4 w-4 text-primary" />
          </div>
          <div>
            <div className="font-medium">{cliente.nombre}</div>
            {cliente.dni && (
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
      key: "actions",
      header: "",
      className: "w-auto sm:w-[100px]",
      render: (cliente) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={(e) => handleEdit(e, cliente)}
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={(e) => handleDelete(e, cliente)}
            disabled={deleting === cliente.id}
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
              placeholder="Buscar por nombre, teléfono o DNI..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
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

      {/* Form Modal */}
      {showForm && (
        <ClienteForm
          cliente={editingCliente}
          onClose={() => {
            setShowForm(false)
            setEditingCliente(null)
          }}
          onSuccess={() => {
            setShowForm(false)
            setEditingCliente(null)
            fetchClientes()
          }}
        />
      )}

      {/* Import Modal */}
      {showImport && (
        <ImportModal
          entityType="CLIENTES"
          onClose={() => setShowImport(false)}
          onSuccess={() => {
            setShowImport(false)
            fetchClientes()
          }}
        />
      )}

      {/* Desktop: Data Table */}
      <div className="hidden sm:block">
        <DataTable
          data={clientes}
          columns={columns}
          keyExtractor={(cliente) => cliente.id}
          loading={loading}
          emptyMessage="No hay clientes registrados"
          sortKey={sortKey}
          sortDirection={sortDirection}
          onSort={handleSort}
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
        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <div className="h-4 bg-muted animate-pulse rounded w-1/3 mb-3" />
                  <div className="h-3 bg-muted animate-pulse rounded w-2/3 mb-2" />
                  <div className="h-3 bg-muted animate-pulse rounded w-1/2" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : clientes.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No hay clientes registrados
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="space-y-3">
              {clientes.map((cliente) => (
                <ClienteMobileCard
                  key={cliente.id}
                  cliente={cliente}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
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
