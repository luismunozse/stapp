"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  TrendingUp,
  Mail,
  ShoppingCart,
  CheckCircle,
  Plus,
  Edit,
  Trash2,
  Eye,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import { VendedorForm } from "./vendedor-form"
import { useModal } from "@/contexts/modal-context"

interface Vendedor {
  id: string
  nombre: string
  email: string
  telefono: string | null
  activo: boolean
  porcentajeComision: number
  created_at: string
  ventasCompletadas: number
  ventasTotal: number
}

interface VendedoresResponse {
  data: Vendedor[]
  total: number
  page: number
  limit: number
  totalPages: number
}

type ActivoFilter = "all" | "true" | "false"

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export function VendedoresList() {
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === "ADMIN"
  const { confirm, showError, showWarning } = useModal()

  const [formOpen, setFormOpen] = useState(false)
  const [editingVendedor, setEditingVendedor] = useState<Vendedor | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [activoFilter, setActivoFilter] = useState<ActivoFilter>("all")
  const [page, setPage] = useState(1)
  const pageSize = 20

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value)
    setPage(1)
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => setDebouncedSearch(value), 300)
  }, [])
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [])

  const apiUrl = useMemo(() => {
    const params = new URLSearchParams()
    if (debouncedSearch) params.set("search", debouncedSearch)
    if (activoFilter !== "all") params.set("activo", activoFilter)
    params.set("page", page.toString())
    params.set("limit", pageSize.toString())
    return `/api/vendedores?${params.toString()}`
  }, [debouncedSearch, activoFilter, page, pageSize])

  const { data, isLoading: loading, mutate } = useSWR<VendedoresResponse>(
    apiUrl,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 5000, keepPreviousData: true }
  )

  const vendedores = data?.data ?? []
  const total = data?.total ?? 0
  const totalPages = data?.totalPages ?? 1
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEnd = Math.min(page * pageSize, total)

  const handleEdit = (vendedor: Vendedor, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setEditingVendedor(vendedor)
    setFormOpen(true)
  }

  const handleDelete = async (vendedor: Vendedor, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (vendedor.ventasTotal > 0) {
      await showWarning(`No se puede eliminar un vendedor con ${vendedor.ventasTotal} venta(s) asociada(s)`)
      return
    }

    const confirmed = await confirm({
      title: "Eliminar Vendedor",
      description: "¿Estás seguro de eliminar este vendedor? Esta acción no se puede deshacer.",
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      variant: "danger",
    })

    if (!confirmed) return

    setDeletingId(vendedor.id)
    try {
      const res = await fetch(`/api/vendedores/${vendedor.id}`, { method: "DELETE" })
      if (res.ok) {
        mutate()
      } else {
        const data = await res.json()
        await showError(data.error || "Error al eliminar")
      }
    } catch (error) {
      console.error("Error deleting vendedor:", error)
      await showError("Error al eliminar vendedor")
    } finally {
      setDeletingId(null)
    }
  }

  const handleFormSuccess = () => {
    mutate()
    setEditingVendedor(null)
  }

  const handleFormClose = (open: boolean) => {
    setFormOpen(open)
    if (!open) setEditingVendedor(null)
  }

  const isInitialLoading = loading && !data

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div className="flex flex-1 flex-col sm:flex-row gap-2 sm:items-center">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Buscar por nombre, email o teléfono…"
              className="pl-8"
            />
          </div>
          <div className="flex gap-1">
            {(["all", "true", "false"] as ActivoFilter[]).map((opt) => (
              <Button
                key={opt}
                type="button"
                size="sm"
                variant={activoFilter === opt ? "default" : "outline"}
                onClick={() => {
                  setActivoFilter(opt)
                  setPage(1)
                }}
              >
                {opt === "all" ? "Todos" : opt === "true" ? "Activos" : "Inactivos"}
              </Button>
            ))}
          </div>
        </div>
        {isAdmin && (
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Nuevo Vendedor
          </Button>
        )}
      </div>

      {isInitialLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : vendedores.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            {debouncedSearch || activoFilter !== "all"
              ? "No se encontraron vendedores con esos filtros"
              : "No hay vendedores registrados"}
            {isAdmin && !debouncedSearch && activoFilter === "all" && (
              <div className="mt-4">
                <Button onClick={() => setFormOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Agregar primer vendedor
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {vendedores.map((vendedor) => (
            <Link key={vendedor.id} href={`/vendedores/${vendedor.id}`}>
              <Card className={`hover:shadow-md transition-shadow cursor-pointer h-full ${!vendedor.activo ? "opacity-60" : ""}`}>
                <CardHeader className="p-3 sm:p-6">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                      <div className="p-1.5 sm:p-2 bg-primary/10 rounded-lg shrink-0">
                        <TrendingUp className="h-4 w-4 sm:h-6 sm:w-6 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <CardTitle className="text-sm sm:text-lg truncate">{vendedor.nombre}</CardTitle>
                          {!vendedor.activo && (
                            <Badge variant="outline" className="text-[9px] sm:text-[10px] border-muted-foreground/30 text-muted-foreground">
                              Inactivo
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1">
                          <Mail className="h-3 w-3 sm:h-4 sm:w-4 shrink-0" />
                          <span className="truncate">{vendedor.email}</span>
                        </div>
                      </div>
                    </div>
                    {isAdmin && (
                      <div className="flex gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 sm:h-8 sm:w-8"
                          onClick={(e) => handleEdit(vendedor, e)}
                        >
                          <Edit className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 sm:h-8 sm:w-8 text-destructive hover:text-destructive"
                          onClick={(e) => handleDelete(vendedor, e)}
                          disabled={deletingId === vendedor.id}
                        >
                          <Trash2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="p-3 sm:p-6 pt-0 space-y-2 sm:space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ShoppingCart className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
                      <span className="text-xs sm:text-sm">Ventas</span>
                    </div>
                    <Badge variant="secondary" className="text-[10px] sm:text-xs">{vendedor.ventasTotal}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
                      <span className="text-xs sm:text-sm">Completadas</span>
                    </div>
                    <Badge className="bg-green-100 text-green-800 hover:bg-green-100 text-[10px] sm:text-xs">
                      {vendedor.ventasCompletadas}
                    </Badge>
                  </div>
                  {vendedor.porcentajeComision > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs sm:text-sm text-muted-foreground">Comisión</span>
                      <Badge variant="secondary" className="text-[10px] sm:text-xs">
                        {vendedor.porcentajeComision}%
                      </Badge>
                    </div>
                  )}
                  <div className="pt-2 border-t">
                    <div className="flex items-center gap-2 text-xs sm:text-sm text-primary">
                      <Eye className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      Ver detalle
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {!isInitialLoading && total > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 text-sm">
          <div className="text-muted-foreground">
            Mostrando {rangeStart}-{rangeEnd} de {total}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(p - 1, 1))}
                disabled={page <= 1 || loading}
              >
                <ChevronLeft className="h-4 w-4" />
                Anterior
              </Button>
              <span className="text-xs text-muted-foreground">
                Página {page} de {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                disabled={page >= totalPages || loading}
              >
                Siguiente
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      <VendedorForm
        open={formOpen}
        onOpenChange={handleFormClose}
        vendedor={editingVendedor}
        onSuccess={handleFormSuccess}
      />
    </>
  )
}
