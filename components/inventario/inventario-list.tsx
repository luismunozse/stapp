"use client"

import { useState, useEffect, useCallback } from "react"
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

const todasLasCategorias = [
  "Baterías",
  "Pantallas",
  "Carcasas",
  "Teclados",
  "Memoria",
  "Procesadores",
  "Otros",
]

const categoriasPorTipo: Record<TipoDispositivo | "", string[]> = {
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
  const [items, setItems] = useState<Inventario[]>([])
  const [loading, setLoading] = useState(true)
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
  const [total, setTotal] = useState(0)
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

  const categoriasDisponibles = categoriasPorTipo[tipoDispositivo]

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
    const nuevasCategorias = categoriasPorTipo[nuevoTipo]
    if (categoria && !nuevasCategorias.includes(categoria)) {
      setCategoria("")
    }
  }

  const fetchItems = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (debouncedSearch) params.append("search", debouncedSearch)
      if (categoria) params.append("categoria", categoria)
      if (tipoDispositivo) params.append("tipoDispositivo", tipoDispositivo)
      if (bajoStock) params.append("bajoStock", "true")
      params.append("page", page.toString())
      params.append("limit", pageSize.toString())

      const res = await fetch(`/api/inventario?${params.toString()}`, { cache: "no-store" })
      const data = await res.json()

      if (data.data) {
        setItems(data.data)
        setTotal(data.total || 0)
      } else if (Array.isArray(data)) {
        setItems(data)
        setTotal(data.length)
      }
    } catch (error) {
      console.error("Error fetching inventario:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchItems()
  }, [debouncedSearch, categoria, tipoDispositivo, bajoStock, page, pageSize])

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
        fetchItems()
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
            fetchItems()
          }}
        />
      )}

      {showImport && (
        <ImportModal
          entityType="INVENTARIO"
          onClose={() => setShowImport(false)}
          onSuccess={() => {
            setShowImport(false)
            fetchItems()
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

      {loading ? (
        <div className="text-center py-8">Cargando...</div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No hay items en el inventario
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <Card key={item.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-lg">{item.nombre}</CardTitle>
                      <p className="text-sm text-muted-foreground mt-1">
                        {item.codigo}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setEditingItem(item)
                          setShowForm(true)
                        }}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(item.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2">
                    <Badge variant="outline">
                      {tiposDispositivo.find((t) => t.codigo === item.tipoDispositivo)?.nombre || item.tipoDispositivo}
                    </Badge>
                    <Badge variant="secondary">{item.categoria}</Badge>
                  </div>
                  {item.descripcion && (
                    <p className="text-sm text-muted-foreground">
                      {item.descripcion}
                    </p>
                  )}
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-muted-foreground">Stock</div>
                      <div className="flex items-center gap-2">
                        <Package className="h-4 w-4" />
                        <span className={`font-bold ${item.stock < umbralStockBajo ? "text-destructive" : ""}`}>
                          {item.stock}
                        </span>
                        {item.stock < umbralStockBajo && (
                          <AlertCircle className="h-4 w-4 text-destructive" />
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-muted-foreground">
                        Compra / Venta
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm text-muted-foreground">{formatPrice(item.precioCompra)}</span>
                        <span className="text-muted-foreground">/</span>
                        <span className="font-bold">{formatPrice(item.precioVenta)}</span>
                      </div>
                      {item.precioVenta > item.precioCompra && (
                        <div className="text-xs text-green-600">
                          Margen: {formatPrice(item.precioVenta - item.precioCompra)}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex justify-end pt-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-muted-foreground"
                      onClick={() => setMovimientosItem({ id: item.id, nombre: item.nombre })}
                    >
                      <History className="mr-1 h-3 w-3" />
                      Movimientos
                    </Button>
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

