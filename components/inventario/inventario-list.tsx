"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { DataTable, DataTablePagination, type Column } from "@/components/ui/data-table"
import {
  Plus,
  ListPlus,
  Search,
  Edit,
  Archive,
  AlertCircle,
  Package,
  Upload,
  History,
  ArchiveRestore,
  Settings2,
  LayoutGrid,
  LayoutList,
  TrendingUp,
  Truck,
  ScanLine,
  Tag,
  Trash2,
  X,
  MoreHorizontal,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { InventarioForm } from "./inventario-form"
import { InventarioBulkForm } from "./inventario-bulk-form"
import { InventarioProveedorStats } from "./inventario-proveedor-stats"
import { ConsolidateDuplicatesDialog } from "./consolidate-duplicates-dialog"
import { InventarioStats } from "./inventario-stats"
import { InventarioBulkBar } from "./inventario-bulk-bar"
import { QuickStockAdjust } from "./quick-stock-adjust"
import { MovimientosHistorial } from "./movimientos-historial"
import { InventarioAnalyticsModal } from "./inventario-analytics-modal"
import { BarcodeScanner } from "./barcode-scanner"
import { LabelsPrintDialog } from "./labels-print-dialog"
import { ImportModal } from "@/components/import/import-modal"
import { ExportButton } from "@/components/export/export-button"
import { useCurrency } from "@/contexts/currency-context"
import type { Inventario, TipoDispositivo, TipoDispositivoCustom } from "@/types"
import { useModal } from "@/contexts/modal-context"
import { useTiposDispositivo } from "@/hooks/use-tipos-dispositivo"

const fetcher = (url: string) => fetch(url, { cache: "no-store" }).then(res => res.json())

interface ProveedorLite {
  id: string
  nombre: string
  activo?: boolean
}

const proveedoresFetcher = (url: string): Promise<ProveedorLite[]> =>
  fetch(url).then((res) => res.json())

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
  const { data: proveedores = [] } = useSWR<ProveedorLite[]>(
    "/api/proveedores",
    proveedoresFetcher,
    { revalidateOnFocus: false }
  )
  const proveedoresActivos = useMemo(
    () => proveedores.filter((p) => p.activo !== false),
    [proveedores]
  )
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [categoria, setCategoria] = useState("")
  const [tipoDispositivo, setTipoDispositivo] = useState<TipoDispositivo | "">("")
  const [proveedorId, setProveedorId] = useState<string>("")
  const [bajoStock, setBajoStock] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [showBulkForm, setShowBulkForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editingItem, setEditingItem] = useState<Inventario | null>(null)
  const [movimientosItem, setMovimientosItem] = useState<{ id: string; nombre: string } | null>(null)
  const [analyticsItem, setAnalyticsItem] = useState<{ id: string; nombre: string } | null>(null)
  const [showScanner, setShowScanner] = useState(false)
  const [labelItems, setLabelItems] = useState<Inventario[] | null>(null)
  const [includeArchived, setIncludeArchived] = useState(false)
  // Default a "list": es la vista que escala con catálogos grandes.
  // La preferencia se persiste en localStorage.
  const [viewMode, setViewMode] = useState<"grid" | "list">("list")

  // Hidratar preferencia desde localStorage
  useEffect(() => {
    if (typeof window === "undefined") return
    const saved = localStorage.getItem("inventario-view-mode")
    if (saved === "grid" || saved === "list") setViewMode(saved)
  }, [])
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("inventario-view-mode", viewMode)
    }
  }, [viewMode])

  // Pagination
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [umbralStockBajo, setUmbralStockBajo] = useState(5)
  const [refreshKey, setRefreshKey] = useState(0)

  // Sorting (controlado por DataTable)
  const [sortBy, setSortBy] = useState<string>("nombre")
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc")

  const handleSort = useCallback((key: string) => {
    setSortBy((prev) => {
      if (prev === key) {
        setSortOrder((dir) => (dir === "asc" ? "desc" : "asc"))
        return prev
      }
      setSortOrder("asc")
      return key
    })
    setPage(1)
  }, [])

  // Selección masiva (bulk actions)
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])

  // Limpiar selección si cambian filtros o página (los ids ya no están visibles)
  useEffect(() => {
    setSelectedKeys([])
  }, [debouncedSearch, categoria, tipoDispositivo, bajoStock, includeArchived, page, sortBy, sortOrder])

  // Fetch configurable stock threshold
  useEffect(() => {
    fetch("/api/configuracion", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data.umbralStockBajo != null) setUmbralStockBajo(data.umbralStockBajo)
      })
      .catch(() => {})
  }, [])

  // Prioritize dynamic categories from device type config, fallback to hardcoded map
  const categoriasDisponibles = (() => {
    if (!tipoDispositivo) return todasLasCategorias
    const tipoConfig = tiposDispositivo.find(t => t.codigo === tipoDispositivo)
    const dynamicCats = tipoConfig?.config?.categoriasInventario
    if (dynamicCats && dynamicCats.length > 0) return dynamicCats
    return categoriasPorTipo[tipoDispositivo] || todasLasCategorias
  })()

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
    // Check if current category is valid for the new type
    const tipoConfig = tiposDispositivo.find(t => t.codigo === nuevoTipo)
    const dynamicCats = tipoConfig?.config?.categoriasInventario
    const nuevasCategorias = (dynamicCats && dynamicCats.length > 0) ? dynamicCats : (categoriasPorTipo[nuevoTipo] || todasLasCategorias)
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
    if (proveedorId) params.append("proveedorId", proveedorId)
    if (bajoStock) params.append("bajoStock", "true")
    if (includeArchived) params.append("includeArchived", "true")
    params.append("page", page.toString())
    params.append("limit", pageSize.toString())
    params.append("sortBy", sortBy)
    params.append("sortOrder", sortOrder)
    params.append("_r", refreshKey.toString())
    return `/api/inventario?${params.toString()}`
  }, [debouncedSearch, categoria, tipoDispositivo, proveedorId, bajoStock, includeArchived, page, pageSize, sortBy, sortOrder, refreshKey])

  // SWR for fetching with cache
  const { data, isLoading } = useSWR(apiUrl, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 2000,
    keepPreviousData: true,
  })

  // Extract data from response
  const items: Inventario[] = data?.data || (Array.isArray(data) ? data : [])
  const total = data?.total || (Array.isArray(data) ? data.length : 0)

  // Detección client-side de duplicados en la página actual.
  // Clave: nombre normalizado + tipo + categoría. Marca como duplicado cualquier
  // item que comparta clave con al menos otro de los visibles. También mapea
  // cada id a su grupo completo para alimentar el diálogo de consolidación.
  const { duplicateIds, duplicateGroupByItemId } = useMemo(() => {
    const groups = new Map<string, Inventario[]>()
    for (const it of items) {
      const key = `${it.nombre
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim()}|${it.tipoDispositivo}|${it.categoria}`
      const arr = groups.get(key) || []
      arr.push(it)
      groups.set(key, arr)
    }
    const dup = new Set<string>()
    const byId = new Map<string, Inventario[]>()
    for (const list of groups.values()) {
      if (list.length > 1) {
        list.forEach((it) => {
          dup.add(it.id)
          byId.set(it.id, list)
        })
      }
    }
    return { duplicateIds: dup, duplicateGroupByItemId: byId }
  }, [items])

  const [consolidateGroup, setConsolidateGroup] = useState<Inventario[] | null>(null)

  const handleDelete = async (id: string, nombre?: string) => {
    const confirmed = await confirm({
      title: "Eliminar Item",
      description: `¿Eliminar "${nombre ?? "este item"}" del inventario? Si nunca fue usado en órdenes o ventas se borra definitivamente; si ya tiene historial, te vamos a ofrecer archivarlo.`,
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      variant: "danger",
    })
    if (!confirmed) return

    try {
      const res = await fetch(`/api/inventario/${id}`, { method: "DELETE" })
      if (res.ok) {
        setRefreshKey(k => k + 1)
        return
      }

      if (res.status === 409) {
        const data = await res.json().catch(() => ({}))
        if (data.canArchive) {
          const archiveConfirmed = await confirm({
            title: "No se puede eliminar",
            description: `${data.error} ¿Querés archivarlo? Queda oculto de búsquedas y ventas, pero el historial se conserva.`,
            confirmText: "Archivar",
            cancelText: "Cancelar",
            variant: "danger",
          })
          if (!archiveConfirmed) return
          const archRes = await fetch(`/api/inventario/${id}?archive=true`, { method: "DELETE" })
          if (archRes.ok) setRefreshKey(k => k + 1)
          else alert("No se pudo archivar el item")
          return
        }
      }

      const err = await res.json().catch(() => ({}))
      alert(err.error || "No se pudo eliminar el item")
    } catch (error) {
      console.error("Error deleting item:", error)
      alert("Error al eliminar el item")
    }
  }

  const listColumns: Column<Inventario>[] = useMemo(() => [
    {
      key: "nombre",
      header: "Producto",
      sortable: true,
      render: (item) => (
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 shrink-0 rounded overflow-hidden bg-muted/50 flex items-center justify-center border">
            {item.imagenUrl ? (
              <img
                src={item.imagenUrl}
                alt={item.nombre}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <Package className="h-4 w-4 text-muted-foreground/50" />
            )}
          </div>
          <div className="min-w-0">
            <div className="font-medium text-sm truncate flex items-center gap-1.5">
              <span className="truncate">{item.nombre}</span>
              {duplicateIds.has(item.id) && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    const group = duplicateGroupByItemId.get(item.id)
                    if (group) setConsolidateGroup(group)
                  }}
                  className="shrink-0"
                  title="Clic para consolidar los duplicados detectados en esta página."
                >
                  <Badge
                    variant="outline"
                    className="h-4 px-1 text-[9px] font-normal border-amber-500/60 text-amber-600 bg-amber-500/10 hover:bg-amber-500/20 cursor-pointer"
                  >
                    Duplicado
                  </Badge>
                </button>
              )}
            </div>
            <div className="text-xs text-muted-foreground">{item.codigo}</div>
          </div>
        </div>
      ),
    },
    {
      key: "tipoDispositivo",
      header: "Tipo",
      className: "hidden xl:table-cell",
      headerClassName: "hidden xl:table-cell",
      render: (item) => {
        const nombre = tiposDispositivo.find((t) => t.codigo === item.tipoDispositivo)?.nombre || item.tipoDispositivo
        return <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5">{nombre}</Badge>
      },
    },
    {
      key: "categoria",
      header: "Categoría",
      className: "hidden xl:table-cell",
      headerClassName: "hidden xl:table-cell",
      render: (item) => <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5">{item.categoria}</Badge>,
    },
    {
      key: "proveedor",
      header: "Proveedor",
      hideOnTablet: true,
      render: (item) =>
        item.proveedor ? (
          <span className="text-xs text-muted-foreground truncate block max-w-[140px]">{item.proveedor}</span>
        ) : (
          <span className="text-xs text-muted-foreground/50">—</span>
        ),
    },
    {
      key: "stock",
      header: "Stock",
      sortable: true,
      className: "text-center",
      headerClassName: "text-center",
      render: (item) => {
        const itemThreshold = item.stockMinimo ?? umbralStockBajo
        const esStockBajo = item.stock <= itemThreshold
        const sinStock = item.stock === 0
        if (item.deletedAt) {
          return (
            <div className="flex items-center justify-center gap-1">
              <span className="font-bold">{item.stock}</span>
            </div>
          )
        }
        return (
          <div className="flex flex-col items-center">
            <QuickStockAdjust
              itemId={item.id}
              currentStock={item.stock}
              esStockBajo={esStockBajo}
              sinStock={sinStock}
              onAdjusted={() => setRefreshKey((k) => k + 1)}
            />
            {item.stockReservado > 0 && (
              <span className="text-[10px] text-amber-600 dark:text-amber-400 leading-tight">
                {item.stockReservado} res · {item.stock - item.stockReservado} disp
              </span>
            )}
          </div>
        )
      },
    },
    {
      key: "precioCompra",
      header: "Costo",
      sortable: true,
      hideOnMobile: true,
      className: "text-right",
      headerClassName: "text-right",
      render: (item) => (
        item.precioCompra === 0 ? (
          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400" title="Costo en $0 — el margen puede no ser real">
            <AlertCircle className="h-3.5 w-3.5" />
            {formatPrice(0)}
          </span>
        ) : (
          <span className="text-muted-foreground">{formatPrice(item.precioCompra)}</span>
        )
      ),
    },
    {
      key: "precioVenta",
      header: "Venta",
      sortable: true,
      className: "text-right",
      headerClassName: "text-right",
      render: (item) => <span className="font-medium">{formatPrice(item.precioVenta)}</span>,
    },
    {
      key: "margen",
      header: "Margen",
      className: "text-right hidden xl:table-cell",
      headerClassName: "text-right hidden xl:table-cell",
      render: (item) => {
        const margen = item.precioVenta - item.precioCompra
        if (item.precioCompra === 0 && item.precioVenta > 0) {
          return <span className="text-amber-500 text-xs font-medium" title="Sin costo cargado">~{formatPrice(margen)}</span>
        }
        return margen > 0 ? <span className="text-emerald-600 text-xs font-medium">+{formatPrice(margen)}</span> : <span className="text-muted-foreground text-xs">-</span>
      },
    },
    {
      key: "acciones",
      header: "",
      className: "text-right",
      render: (item) => {
        const isArchived = !!item.deletedAt
        return (
          <div className="flex items-center justify-end gap-0.5">
            {!isArchived && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                title="Editar"
                onClick={(e) => { e.stopPropagation(); setEditingItem(item); setShowForm(true) }}
              >
                <Edit className="h-3.5 w-3.5" />
              </Button>
            )}
            {isArchived && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 text-muted-foreground">Archivado</Badge>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground"
                  title="Más acciones"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem onClick={() => setAnalyticsItem({ id: item.id, nombre: item.nombre })}>
                  <TrendingUp className="h-4 w-4 mr-2" />
                  Analytics
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setMovimientosItem({ id: item.id, nombre: item.nombre })}>
                  <History className="h-4 w-4 mr-2" />
                  Movimientos
                </DropdownMenuItem>
                {!isArchived && (
                  <DropdownMenuItem onClick={() => setLabelItems([item])}>
                    <Tag className="h-4 w-4 mr-2" />
                    Imprimir etiqueta
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-destructive"
              title="Eliminar"
              onClick={(e) => { e.stopPropagation(); handleDelete(item.id, item.nombre) }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )
      },
    },
  ], [tiposDispositivo, umbralStockBajo, formatPrice, duplicateIds, duplicateGroupByItemId])

  return (
    <div className="space-y-4">
      <InventarioStats
        refreshKey={refreshKey}
        onFilterSinStock={() => { setBajoStock(true); setPage(1) }}
        onFilterBajoStock={() => { setBajoStock(true); setPage(1) }}
      />
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
          <div className="relative sm:col-span-2 lg:col-span-2">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Buscar por nombre, código, descripción o proveedor..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-10 pr-9"
            />
            {search && (
              <button
                type="button"
                onClick={() => handleSearchChange("")}
                aria-label="Limpiar búsqueda"
                className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            )}
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
          <Select
            value={proveedorId || "all"}
            onValueChange={(value) => { setProveedorId(value === "all" ? "" : value); setPage(1) }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Todos los proveedores" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los proveedores</SelectItem>
              <SelectItem value="none">Sin proveedor</SelectItem>
              {proveedoresActivos.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {proveedorId && (
          <InventarioProveedorStats
            proveedorId={proveedorId}
            proveedorNombre={
              proveedorId === "none"
                ? "Sin proveedor"
                : proveedores.find((p) => p.id === proveedorId)?.nombre || "Proveedor"
            }
            categoria={categoria || undefined}
            tipoDispositivo={tipoDispositivo || undefined}
            bajoStock={bajoStock}
            refreshKey={refreshKey}
          />
        )}
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
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setShowScanner(true)}
          >
            <ScanLine className="h-4 w-4" />
            <span className="hidden sm:inline">Escanear</span>
          </Button>
          <Button
            variant={includeArchived ? "default" : "outline"}
            size="sm"
            className="gap-1.5"
            onClick={() => { setIncludeArchived(!includeArchived); setPage(1) }}
          >
            <ArchiveRestore className="h-4 w-4" />
            Archivados
          </Button>
          {bajoStock && items.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                // Build items for OC grouped by proveedor
                const ocItems = items
                  .filter(i => !i.deletedAt && i.stock <= (i.stockMinimo ?? umbralStockBajo))
                  .map(i => ({
                    inventarioId: i.id,
                    descripcion: `${i.nombre}${i.codigo ? ` (${i.codigo})` : ''}`,
                    codigo: i.codigo,
                    cantidadPedida: Math.max(1, (i.stockMaximo ?? (i.stockMinimo ?? umbralStockBajo) * 2) - i.stock),
                    precioUnitario: i.precioCompra || 0,
                  }))
                if (ocItems.length === 0) return
                // Navigate to OC with pre-filled items via sessionStorage
                sessionStorage.setItem("oc-draft-items", JSON.stringify(ocItems))
                window.location.href = "/ordenes-compra?draft=true"
              }}
            >
              <Truck className="h-4 w-4" />
              Generar OC ({items.filter(i => !i.deletedAt && i.stock <= (i.stockMinimo ?? umbralStockBajo)).length})
            </Button>
          )}
          <ExportButton
            entity="inventario"
            filters={{
              ...(categoria && { categoria }),
              ...(tipoDispositivo && { tipo_dispositivo: tipoDispositivo }),
              ...(proveedorId && { proveedor_id: proveedorId }),
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
          <div className="flex items-center border rounded-md">
            <Button
              variant={viewMode === "grid" ? "default" : "ghost"}
              size="sm"
              className="h-8 w-8 p-0 rounded-r-none"
              onClick={() => setViewMode("grid")}
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "default" : "ghost"}
              size="sm"
              className="h-8 w-8 p-0 rounded-l-none"
              onClick={() => setViewMode("list")}
            >
              <LayoutList className="h-4 w-4" />
            </Button>
          </div>
          <Button onClick={() => setShowBulkForm(true)} variant="outline" className="gap-2">
            <ListPlus className="h-4 w-4" />
            <span className="hidden sm:inline">Carga en lista</span>
            <span className="sm:hidden">Lista</span>
          </Button>
          <Button onClick={() => setShowForm(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Nuevo Item
          </Button>
        </div>
      </div>

      {showBulkForm && (
        <InventarioBulkForm
          onClose={() => setShowBulkForm(false)}
          onSuccess={() => {
            setShowBulkForm(false)
            setRefreshKey(k => k + 1)
          }}
        />
      )}

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
            setRefreshKey(k => k + 1)
          }}
          onEditExisting={async (id) => {
            try {
              const res = await fetch(`/api/inventario/${id}`, { cache: "no-store" })
              if (!res.ok) throw new Error("No se pudo cargar el item")
              const existing: Inventario = await res.json()
              setEditingItem(existing)
            } catch (err) {
              console.error("Error cargando item existente:", err)
              alert("No se pudo abrir el item existente")
            }
          }}
        />
      )}

      {consolidateGroup && (
        <ConsolidateDuplicatesDialog
          open={!!consolidateGroup}
          onOpenChange={(o) => { if (!o) setConsolidateGroup(null) }}
          group={consolidateGroup}
          onSuccess={() => {
            setConsolidateGroup(null)
            setRefreshKey(k => k + 1)
          }}
        />
      )}

      {showImport && (
        <ImportModal
          entityType="INVENTARIO"
          onClose={() => setShowImport(false)}
          onSuccess={() => {
            setShowImport(false)
            setRefreshKey(k => k + 1)
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

      {analyticsItem && (
        <InventarioAnalyticsModal
          open={!!analyticsItem}
          onOpenChange={(open) => { if (!open) setAnalyticsItem(null) }}
          inventarioId={analyticsItem.id}
          inventarioNombre={analyticsItem.nombre}
        />
      )}

      {labelItems && (
        <LabelsPrintDialog
          open={!!labelItems}
          onOpenChange={(open) => { if (!open) setLabelItems(null) }}
          items={labelItems.map(i => ({
            id: i.id,
            nombre: i.nombre,
            codigo: i.codigo,
            barcode: i.barcode,
            precioVenta: i.precioVenta,
          }))}
        />
      )}

      <BarcodeScanner
        open={showScanner}
        onOpenChange={setShowScanner}
        onResult={async (result) => {
          if (result.found && result.item) {
            setEditingItem(result.item)
            setShowForm(true)
          } else {
            const crear = await confirm({
              title: "Código no encontrado",
              description: `El código "${result.code}" no está en el inventario. ¿Crear un nuevo producto con este código de barras?`,
              confirmText: "Crear producto",
              cancelText: "Cancelar",
            })
            if (crear) {
              sessionStorage.setItem("new-item-barcode", result.code)
              setEditingItem(null)
              setShowForm(true)
            }
          }
        }}
      />

      {selectedKeys.length > 0 && viewMode === "list" && (
        <InventarioBulkBar
          selectedCount={selectedKeys.length}
          selectedIds={selectedKeys}
          categoriasDisponibles={categoriasDisponibles}
          proveedores={proveedoresActivos}
          onClear={() => setSelectedKeys([])}
          onSuccess={() => setRefreshKey((k) => k + 1)}
          onGenerateLabels={() => {
            const selected = items.filter((i) => selectedKeys.includes(i.id))
            if (selected.length > 0) setLabelItems(selected)
          }}
        />
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="rounded-lg border bg-card p-4 flex gap-4">
              <div className="h-4 bg-muted animate-pulse rounded w-1/6" />
              <div className="h-4 bg-muted animate-pulse rounded w-1/3" />
              <div className="h-4 bg-muted animate-pulse rounded w-1/6" />
              <div className="h-4 bg-muted animate-pulse rounded w-1/6" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Package className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="font-semibold mb-1">Todavía no hay productos en el inventario</p>
            <p className="text-sm text-muted-foreground mb-4">Agregá tu primer producto para controlar stock y precios</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {viewMode === "list" ? (
            <DataTable
              data={items}
              columns={listColumns}
              keyExtractor={(item) => item.id}
              compact
              sortKey={sortBy}
              sortDirection={sortOrder}
              onSort={handleSort}
              selectable
              selectedKeys={selectedKeys}
              onSelectionChange={setSelectedKeys}
              rowClassName={(item) => {
                const isArchived = !!item.deletedAt
                const sinStock = item.stock === 0
                return `${sinStock && !isArchived ? "bg-destructive/5" : ""} ${isArchived ? "opacity-50" : ""}`
              }}
              pagination={total > pageSize ? {
                page,
                pageSize,
                total,
                onPageChange: setPage,
                onPageSizeChange: (size) => { setPageSize(size); setPage(1) },
              } : undefined}
            />
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {items.map((item) => {
                  const itemThreshold = item.stockMinimo ?? umbralStockBajo
                  const esStockBajo = item.stock <= itemThreshold
                  const sinStock = item.stock === 0
                  const margen = item.precioVenta - item.precioCompra
                  const tipoNombre = tiposDispositivo.find((t) => t.codigo === item.tipoDispositivo)?.nombre || item.tipoDispositivo
                  const isArchived = !!item.deletedAt

                  return (
                    <Card key={item.id} className={`overflow-hidden ${sinStock && !isArchived ? "border-destructive/30 bg-destructive/5" : ""} ${isArchived ? "opacity-50" : ""}`}>
                      {/* Hero image */}
                      <div className="aspect-[16/9] w-full bg-muted/40 flex items-center justify-center border-b">
                        {item.imagenUrl ? (
                          <img
                            src={item.imagenUrl}
                            alt={item.nombre}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <Package className="h-10 w-10 text-muted-foreground/40" />
                        )}
                      </div>
                      <CardContent className="p-4">
                        {/* Row 1: Name + Actions */}
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-sm leading-tight truncate flex items-center gap-1.5">
                              <span className="truncate">{item.nombre}</span>
                              {duplicateIds.has(item.id) && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    const group = duplicateGroupByItemId.get(item.id)
                                    if (group) setConsolidateGroup(group)
                                  }}
                                  className="shrink-0"
                                  title="Clic para consolidar los duplicados detectados en esta página."
                                >
                                  <Badge
                                    variant="outline"
                                    className="h-4 px-1 text-[9px] font-normal border-amber-500/60 text-amber-600 bg-amber-500/10 hover:bg-amber-500/20 cursor-pointer"
                                  >
                                    Duplicado
                                  </Badge>
                                </button>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">{item.codigo}</div>
                          </div>
                          <div className="flex items-center gap-0.5 shrink-0">
                            {isArchived ? (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 text-muted-foreground">
                                Archivado
                              </Badge>
                            ) : (
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
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              title="Eliminar"
                              onClick={() => handleDelete(item.id, item.nombre)}
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
                            {esStockBajo && !isArchived && (
                              <div className="flex items-center justify-center gap-0.5 mt-0.5">
                                <AlertCircle className="h-2.5 w-2.5 text-amber-600" />
                                <span className="text-[9px] text-amber-600 font-medium">
                                  {sinStock ? "Sin stock" : "Bajo"}
                                </span>
                              </div>
                            )}
                            {item.stockMinimo != null && !isArchived && (
                              <div className="flex items-center justify-center gap-0.5 mt-0.5">
                                <Settings2 className="h-2 w-2 text-muted-foreground" />
                                <span className="text-[8px] text-muted-foreground">mín: {item.stockMinimo}</span>
                              </div>
                            )}
                            {item.stockReservado > 0 && !isArchived && (
                              <div className="text-[9px] text-amber-600 dark:text-amber-400 mt-0.5">
                                {item.stockReservado} reserv. · {item.stock - item.stockReservado} disp.
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

                        {/* Row 4: Actions */}
                        <div className="flex justify-end gap-1 mt-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-[11px] px-2 text-muted-foreground hover:text-foreground"
                            onClick={() => setAnalyticsItem({ id: item.id, nombre: item.nombre })}
                          >
                            <TrendingUp className="mr-1 h-3 w-3" />
                            Analytics
                          </Button>
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
        </>
      )}
    </div>
  )
}
