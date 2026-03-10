"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { DataTablePagination } from "@/components/ui/data-table"
import {
  Plus,
  Search,
  Edit,
  Trash2,
  AlertCircle,
  Package,
  Upload,
  History,
} from "lucide-react"
import { InventarioForm } from "./inventario-form"
import { MovimientosHistorial } from "./movimientos-historial"
import { ImportModal } from "@/components/import/import-modal"
import { ExportButton } from "@/components/export/export-button"
import { useCurrency } from "@/contexts/currency-context"
import type { Inventario, TipoDispositivo, TipoDispositivoCustom } from "@/types"
import { useModal } from "@/contexts/modal-context"
import { useTiposDispositivo } from "@/hooks/use-tipos-dispositivo"

const fetcher = (url: string) => fetch(url).then(res => res.json())

const todasLasCategorias = [
  "Baterías",
  "Pantallas",
  "Carcasas",
  "Teclados",
  "Memoria",
  "Procesadores",
  "Otros",
]

const categoriasPorTipo: Record<string, string[]> = {
  "": todasLasCategorias,
  "CELULAR": ["Baterías", "Pantallas", "Carcasas", "Memoria", "Otros"],
  "COMPUTADORA": todasLasCategorias,
  "TABLET": ["Baterías", "Pantallas", "Carcasas", "Memoria", "Otros"],
  "CONSOLA": ["Baterías", "Pantallas", "Carcasas", "Memoria", "Procesadores", "Otros"],
  "SMARTWATCH": ["Baterías", "Pantallas", "Carcasas", "Otros"],
  "ACCESORIOS": todasLasCategorias,
  "TODOS": todasLasCategorias,
}

interface InventarioListProps {
  allowImport?: boolean
}

export function InventarioList({ allowImport = true }: InventarioListProps) {
  const { confirm } = useModal()
  const { formatPrice } = useCurrency()
  const { tipos: tiposDispositivo, loading: tiposLoading } = useTiposDispositivo()
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [categoria, setCategoria] = useState("")
  const [tipoDispositivo, setTipoDispositivo] = useState<TipoDispositivo | "">("")
  const [bajoStock, setBajoStock] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editingItem, setEditingItem] = useState<Inventario | null>(null)
  const [movimientosItem, setMovimientosItem] = useState<{ id: string; nombre: string } | null>(null)

  // Pagination
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [umbralStockBajo, setUmbralStockBajo] = useState(5)

  // Fetch configurable stock threshold
  useEffect(() => {
    fetch("/api/configuracion", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data.umbralStockBajo != null) setUmbralStockBajo(data.umbralStockBajo)
      })
      .catch(() => {})
  }, [])

  const categoriasDisponibles = categoriasPorTipo[tipoDispositivo] || todasLasCategorias

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  const handleTipoChange = (nuevoTipo: TipoDispositivo | "") => {
    setTipoDispositivo(nuevoTipo)
    setPage(1)
    const nuevasCategorias = categoriasPorTipo[nuevoTipo] || todasLasCategorias
    if (categoria && !nuevasCategorias.includes(categoria)) {
      setCategoria("")
    }
  }

  // Build API URL for SWR
  const apiUrl = useMemo(() => {
    const params = new URLSearchParams()
    if (debouncedSearch) params.append("search", debouncedSearch)
    if (categoria) params.append("categoria", categoria)
    if (tipoDispositivo) params.append("tipoDispositivo", tipoDispositivo)
    if (bajoStock) params.append("bajoStock", "true")
    params.append("page", page.toString())
    params.append("limit", pageSize.toString())
    return `/api/inventario?${params.toString()}`
  }, [debouncedSearch, categoria, tipoDispositivo, bajoStock, page, pageSize])

  // SWR for fetching with cache
  const { data, isLoading, mutate } = useSWR(apiUrl, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 5000,
    keepPreviousData: true,
  })

  // Extract data from response
  const items: Inventario[] = data?.data || (Array.isArray(data) ? data : [])
  const total = data?.total || (Array.isArray(data) ? data.length : 0)

  const handleDelete = async (id: string) => {
    const confirmed = await confirm({
      title: "Eliminar Item",
      description: "¿Estás seguro de eliminar este item del inventario?",
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      variant: "danger",
    })

    if (!confirmed) return

    try {
      const res = await fetch(`/api/inventario/${id}`, { method: "DELETE" })
      if (res.ok) {
        mutate()
      }
    } catch (error) {
      console.error("Error deleting item:", error)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <div className="relative sm:col-span-2 lg:col-span-2">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Buscar por nombre, código, descripción o proveedor..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select
            value={categoria || "all"}
            onValueChange={(value) => setCategoria(value === "all" ? "" : value)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Todas las categorías" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las categorías</SelectItem>
              {categoriasDisponibles.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={tipoDispositivo || "all"}
            onValueChange={(value) => handleTipoChange(value === "all" ? "" : value as TipoDispositivo | "")}
            disabled={tiposLoading}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Todos los tipos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los tipos</SelectItem>
              {tiposDispositivo
                .filter((t) => t.codigo !== "TODOS")
                .map((tipo) => (
                  <SelectItem key={tipo.id} value={tipo.codigo}>
                    {tipo.nombre}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={bajoStock ? "default" : "outline"}
            size="sm"
            className="gap-1.5"
            onClick={() => { setBajoStock(!bajoStock); setPage(1) }}
          >
            <AlertCircle className="h-4 w-4" />
            Bajo Stock
          </Button>
          <ExportButton
            entity="inventario"
            filters={{
              ...(categoria && { categoria }),
              ...(tipoDispositivo && { tipo_dispositivo: tipoDispositivo }),
              ...(bajoStock && { bajo_stock: "true" }),
            }}
            variant="outline"
          />
          {allowImport && (
            <Button onClick={() => setShowImport(true)} variant="outline" className="gap-2">
              <Upload className="h-4 w-4" />
              <span className="hidden sm:inline">Importar CSV</span>
              <span className="sm:hidden">Importar</span>
            </Button>
          )}
          <Button onClick={() => setShowForm(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Nuevo Item
          </Button>
        </div>
      </div>

      {showForm && (
        <InventarioForm
          item={editingItem}
          onClose={() => {
            setShowForm(false)
            setEditingItem(null)
          }}
          onSuccess={() => {
            setShowForm(false)
            setEditingItem(null)
            mutate()
          }}
        />
      )}

      {showImport && (
        <ImportModal
          entityType="INVENTARIO"
          onClose={() => setShowImport(false)}
          onSuccess={() => {
            setShowImport(false)
            mutate()
          }}
        />
      )}

      {movimientosItem && (
        <MovimientosHistorial
          open={!!movimientosItem}
          onOpenChange={(open) => { if (!open) setMovimientosItem(null) }}
          inventarioId={movimientosItem.id}
          inventarioNombre={movimientosItem.nombre}
        />
      )}

      {isLoading ? (
        <div className="text-center py-8">Cargando...</div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No hay items en el inventario
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => {
              const esStockBajo = item.stock <= umbralStockBajo
              const sinStock = item.stock === 0
              const margen = item.precioVenta - item.precioCompra
              const tipoNombre = tiposDispositivo.find((t) => t.codigo === item.tipoDispositivo)?.nombre || item.tipoDispositivo

              return (
                <Card key={item.id} className={sinStock ? "border-destructive/30 bg-destructive/5" : ""}>
                  <CardContent className="p-4">
                    {/* Row 1: Name + Actions */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-sm leading-tight truncate">{item.nombre}</div>
                        <div className="text-xs text-muted-foreground">{item.codigo}</div>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => {
                            setEditingItem(item)
                            setShowForm(true)
                          }}
                        >
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDelete(item.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* Row 2: Badges */}
                    <div className="flex items-center gap-1.5 mb-3">
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5">
                        {tipoNombre}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5">
                        {item.categoria}
                      </Badge>
                      {item.proveedor && (
                        <span className="text-[10px] text-muted-foreground truncate">{item.proveedor}</span>
                      )}
                    </div>

                    {/* Row 3: Stock + Price grid */}
                    <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/50 p-2.5">
                      {/* Stock */}
                      <div className="text-center">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Stock</div>
                        <div className={`text-lg font-bold leading-none ${
                          sinStock ? "text-destructive" : esStockBajo ? "text-amber-600" : "text-foreground"
                        }`}>
                          {item.stock}
                        </div>
                        {esStockBajo && (
                          <div className="flex items-center justify-center gap-0.5 mt-0.5">
                            <AlertCircle className="h-2.5 w-2.5 text-amber-600" />
                            <span className="text-[9px] text-amber-600 font-medium">
                              {sinStock ? "Sin stock" : "Bajo"}
                            </span>
                          </div>
                        )}
                      </div>
                      {/* Costo */}
                      <div className="text-center border-x border-border/50">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Costo</div>
                        <div className="text-sm font-medium leading-none text-muted-foreground">
                          {formatPrice(item.precioCompra)}
                        </div>
                      </div>
                      {/* Venta */}
                      <div className="text-center">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Venta</div>
                        <div className="text-sm font-bold leading-none">
                          {formatPrice(item.precioVenta)}
                        </div>
                        {margen > 0 && (
                          <div className="text-[9px] text-emerald-600 font-medium mt-0.5">
                            +{formatPrice(margen)}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Row 4: Movimientos link */}
                    <div className="flex justify-end mt-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[11px] px-2 text-muted-foreground hover:text-foreground"
                        onClick={() => setMovimientosItem({ id: item.id, nombre: item.nombre })}
                      >
                        <History className="mr-1 h-3 w-3" />
                        Movimientos
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
          {total > pageSize && (
            <div className="mt-4">
              <DataTablePagination
                page={page}
                pageSize={pageSize}
                total={total}
                dataLength={items.length}
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
  )
}
