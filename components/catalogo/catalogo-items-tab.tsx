"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import {
  Plus, Search, Pencil, Trash2, ImageOff, Package, Wrench, GripVertical,
  CheckSquare, Square, X, Eye, EyeOff, Star, FolderInput, Loader2, Copy, MoreVertical,
  Download, LayoutGrid, Rows3, AlertTriangle,
} from "lucide-react"
import { toast } from "sonner"
import type { CatalogoItem, CatalogoCategoria } from "@/types/database"
import { CatalogoItemDialog } from "./catalogo-item-dialog"
import { CatalogoImportInventarioDialog } from "./catalogo-import-inventario-dialog"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { useDragReorder } from "./use-drag-reorder"
import { InlineEditCell } from "./inline-edit-cell"
import { parseStock, parsePrecio } from "@/lib/catalogo/inline-edit"

type ItemConCategoria = CatalogoItem & { categoria?: { id: string; nombre: string } | null }
type BulkAction = "activar" | "desactivar" | "destacar" | "quitar_destacado" | "borrar" | "cambiar_categoria"

export function CatalogoItemsTab() {
  const [items, setItems] = useState<ItemConCategoria[]>([])
  const [categorias, setCategorias] = useState<CatalogoCategoria[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [filterTipo, setFilterTipo] = useState<"" | "PRODUCTO" | "SERVICIO">("")
  const [filterCategoria, setFilterCategoria] = useState<string>("")
  const [filterEstado, setFilterEstado] = useState<"" | "activo" | "inactivo">("")
  const [editing, setEditing] = useState<ItemConCategoria | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkConfirm, setBulkConfirm] = useState<BulkAction | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [onlyMissingImage, setOnlyMissingImage] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [itemsRes, catsRes] = await Promise.all([
        fetch("/api/catalogo/items"),
        fetch("/api/catalogo/categorias"),
      ])
      const itemsData = await itemsRes.json()
      const catsData = await catsRes.json()
      setItems(itemsData.items ?? [])
      setCategorias(catsData.categorias ?? [])
    } catch {
      toast.error("Error cargando catálogo")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const filtered = items.filter((it) => {
    if (filterTipo && it.tipo !== filterTipo) return false
    if (filterCategoria && it.categoria_id !== filterCategoria) return false
    if (filterEstado === "activo" && !it.activo) return false
    if (filterEstado === "inactivo" && it.activo) return false
    if (onlyMissingImage && !!it.imagen_url) return false
    if (search && !it.nombre.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const sinImagenCount = items.filter((i) => !i.imagen_url && i.activo).length
  const hasFilters = !!search || !!filterTipo || !!filterCategoria || !!filterEstado || onlyMissingImage
  const canReorder = !hasFilters && selected.size === 0 && viewMode === "grid"

  const handleReorder = async (next: ItemConCategoria[]) => {
    setItems(next)
    const payload = { orden: next.map((it, i) => ({ id: it.id, orden: i })) }
    try {
      const res = await fetch("/api/catalogo/items/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error()
    } catch {
      toast.error("Error al reordenar")
      load()
    }
  }

  const dnd = useDragReorder(filtered, handleReorder)

  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (!deleteId || deleting) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/catalogo/items/${deleteId}`, { method: "DELETE" })
      if (res.ok) {
        toast.success("Item eliminado")
        setItems((prev) => prev.filter((i) => i.id !== deleteId))
      } else {
        toast.error("Error al eliminar")
      }
    } finally {
      setDeleting(false)
      setDeleteId(null)
    }
  }

  const saveField = async (id: string, field: "stock" | "precio", value: number | null) => {
    const prev = items
    setItems((cur) => cur.map((i) => (i.id === id ? { ...i, [field]: value } : i)))
    try {
      const res = await fetch(`/api/catalogo/items/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Error al guardar")
      }
    } catch (err) {
      setItems(prev)
      toast.error(err instanceof Error ? err.message : "Error al guardar")
    }
  }

  const handleDuplicate = async (id: string) => {
    const t = toast.loading("Duplicando...")
    try {
      const res = await fetch(`/api/catalogo/items/${id}/duplicate`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Error al duplicar")
      toast.success("Item duplicado (inactivo)", { id: t })
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al duplicar", { id: t })
    }
  }

  const toggleSelect = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      const visibleIds = filtered.map((i) => i.id)
      const allSelected = visibleIds.every((id) => next.has(id))
      if (allSelected) visibleIds.forEach((id) => next.delete(id))
      else visibleIds.forEach((id) => next.add(id))
      return next
    })
  }

  const clearSelection = () => setSelected(new Set())

  const runBulk = async (action: BulkAction, categoriaId?: string | null) => {
    if (selected.size === 0) return
    setBulkLoading(true)
    const ids = Array.from(selected)
    try {
      const body: Record<string, unknown> = { ids }
      if (action === "destacar") { body.action = "destacar"; body.valor = true }
      else if (action === "quitar_destacado") { body.action = "destacar"; body.valor = false }
      else if (action === "cambiar_categoria") { body.action = "cambiar_categoria"; body.categoria_id = categoriaId ?? null }
      else body.action = action

      const res = await fetch("/api/catalogo/items/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Error en operación")
      toast.success(`${data.affected ?? ids.length} item${ids.length > 1 ? "s" : ""} procesado${ids.length > 1 ? "s" : ""}`)
      clearSelection()
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error en operación bulk")
    } finally {
      setBulkLoading(false)
      setBulkConfirm(null)
    }
  }

  const allVisibleSelected = filtered.length > 0 && filtered.every((i) => selected.has(i.id))

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar item..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          value={filterTipo}
          onChange={(e) => setFilterTipo(e.target.value as any)}
          className="h-10 rounded-md border bg-background px-3 text-sm"
        >
          <option value="">Todos</option>
          <option value="PRODUCTO">Productos</option>
          <option value="SERVICIO">Servicios</option>
        </select>
        <select
          value={filterCategoria}
          onChange={(e) => setFilterCategoria(e.target.value)}
          className="h-10 rounded-md border bg-background px-3 text-sm"
          aria-label="Filtrar por categoría"
        >
          <option value="">Todas las categorías</option>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>{c.nombre}</option>
          ))}
        </select>
        <select
          value={filterEstado}
          onChange={(e) => setFilterEstado(e.target.value as any)}
          className="h-10 rounded-md border bg-background px-3 text-sm"
          aria-label="Filtrar por estado"
        >
          <option value="">Activos e inactivos</option>
          <option value="activo">Solo activos</option>
          <option value="inactivo">Solo inactivos</option>
        </select>
        <Button variant="outline" onClick={() => setImportOpen(true)} className="gap-1.5">
          <Download className="h-4 w-4" />
          <span className="hidden sm:inline">Importar inventario</span>
          <span className="sm:hidden">Importar</span>
        </Button>
        <Button onClick={() => setCreating(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Nuevo item
        </Button>
      </div>

      {sinImagenCount > 0 && !onlyMissingImage && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-orange-200 bg-orange-50 dark:border-orange-900/40 dark:bg-orange-950/30 px-3 py-2 text-sm">
          <div className="flex items-center gap-2 text-orange-700 dark:text-orange-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              {sinImagenCount} item{sinImagenCount > 1 ? "s" : ""} activo{sinImagenCount > 1 ? "s" : ""} sin foto. Convierten mejor con imagen.
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOnlyMissingImage(true)}
            className="text-orange-700 dark:text-orange-200 hover:bg-orange-100 dark:hover:bg-orange-900/30"
          >
            Revisar
          </Button>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <button
            onClick={selectAllVisible}
            className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            {allVisibleSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
            {allVisibleSelected ? "Deseleccionar todo" : `Seleccionar ${filtered.length} visible${filtered.length > 1 ? "s" : ""}`}
          </button>
          <div className="flex items-center gap-3">
            {onlyMissingImage && (
              <button
                onClick={() => setOnlyMissingImage(false)}
                className="inline-flex items-center gap-1 text-orange-700 hover:text-orange-900 dark:text-orange-300"
              >
                <X className="h-3 w-3" />
                Filtro &ldquo;sin foto&rdquo;
              </button>
            )}
            <span>{filtered.length} de {items.length} items</span>
            <div className="inline-flex rounded-md border bg-background p-0.5">
              <button
                onClick={() => setViewMode("grid")}
                className={`h-6 w-6 inline-flex items-center justify-center rounded-sm transition-colors ${
                  viewMode === "grid" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
                aria-label="Vista grilla"
                title="Vista grilla"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`h-6 w-6 inline-flex items-center justify-center rounded-sm transition-colors ${
                  viewMode === "list" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
                aria-label="Vista lista"
                title="Vista lista"
              >
                <Rows3 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <div className="aspect-video bg-muted" />
              <CardContent className="p-3 space-y-2">
                <div className="h-4 bg-muted rounded w-3/4" />
                <div className="h-3 bg-muted rounded w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Package}
          title={items.length === 0 ? "Sin items todavía" : "Sin resultados"}
          description={items.length === 0 ? "Creá tu primer producto o servicio." : "Probá ajustar los filtros."}
          action={items.length === 0 ? { label: "Crear item", onClick: () => setCreating(true) } : undefined}
        />
      ) : viewMode === "list" ? (
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="w-10 px-2 py-2"></th>
                <th className="w-12 px-2 py-2"></th>
                <th className="text-left px-2 py-2 font-medium">Nombre</th>
                <th className="text-left px-2 py-2 font-medium hidden md:table-cell">Categoría</th>
                <th className="text-right px-2 py-2 font-medium">Precio</th>
                <th className="text-right px-2 py-2 font-medium hidden sm:table-cell">Stock</th>
                <th className="text-center px-2 py-2 font-medium hidden sm:table-cell">Estado</th>
                <th className="w-20 px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const isSelected = selected.has(item.id)
                return (
                  <tr
                    key={item.id}
                    className={`border-t hover:bg-muted/30 transition-colors ${
                      isSelected ? "bg-primary/5" : ""
                    }`}
                  >
                    <td className="px-2 py-1.5">
                      <button
                        onClick={() => toggleSelect(item.id)}
                        className={`h-5 w-5 rounded border-2 flex items-center justify-center ${
                          isSelected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
                        }`}
                        aria-label={isSelected ? "Deseleccionar" : "Seleccionar"}
                      >
                        {isSelected && <CheckSquare className="h-3 w-3" />}
                      </button>
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="h-10 w-10 rounded bg-muted overflow-hidden flex items-center justify-center">
                        {item.imagen_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.imagen_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <ImageOff className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        {item.tipo === "PRODUCTO" ? (
                          <Package className="h-3 w-3 text-muted-foreground shrink-0" />
                        ) : (
                          <Wrench className="h-3 w-3 text-muted-foreground shrink-0" />
                        )}
                        <span className="font-medium truncate">{item.nombre}</span>
                        {item.destacado && <Star className="h-3 w-3 fill-current text-amber-500 shrink-0" />}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 hidden md:table-cell text-muted-foreground truncate max-w-[140px]">
                      {item.categoria?.nombre ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <InlineEditCell
                        value={item.precio == null ? null : Number(item.precio)}
                        parse={parsePrecio}
                        onSave={(v) => saveField(item.id, "precio", v)}
                        format={(v) => (v == null ? "" : `$${v.toLocaleString("es-AR")}`)}
                        placeholder={<span className="text-muted-foreground italic text-xs">Consultar</span>}
                        ariaLabel={`Editar precio de ${item.nombre}`}
                      />
                    </td>
                    <td className="px-2 py-1.5 hidden sm:table-cell text-right">
                      {item.tipo === "SERVICIO" ? (
                        <span className="text-muted-foreground text-xs">—</span>
                      ) : (
                        <InlineEditCell
                          value={item.stock == null ? null : Number(item.stock)}
                          parse={parseStock}
                          onSave={(v) => saveField(item.id, "stock", v)}
                          format={(v) =>
                            v == null ? (
                              "—"
                            ) : v === 0 ? (
                              <span className="text-destructive">0</span>
                            ) : (
                              v
                            )
                          }
                          placeholder={<span className="text-muted-foreground text-xs">—</span>}
                          ariaLabel={`Editar stock de ${item.nombre}`}
                        />
                      )}
                    </td>
                    <td className="px-2 py-1.5 hidden sm:table-cell text-center">
                      {item.activo ? (
                        <Badge variant="outline" className="text-xs">Activo</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">Inactivo</Badge>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(item)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreVertical className="h-3 w-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleDuplicate(item.id)}>
                              <Copy className="h-3.5 w-3.5 mr-2" />
                              Duplicar
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setDeleteId(item.id)}>
                              <Trash2 className="h-3.5 w-3.5 mr-2 text-destructive" />
                              <span className="text-destructive">Eliminar</span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item, idx) => {
            const isSelected = selected.has(item.id)
            return (
              <Card
                key={item.id}
                draggable={canReorder}
                onDragStart={canReorder ? dnd.onDragStart(idx) : undefined}
                onDragOver={canReorder ? dnd.onDragOver : undefined}
                onDrop={canReorder ? dnd.onDrop(idx) : undefined}
                onDragEnd={canReorder ? dnd.onDragEnd : undefined}
                className={`overflow-hidden group hover:shadow-md transition-all ${
                  dnd.draggingId === item.id ? "opacity-40" : ""
                } ${canReorder ? "cursor-move" : ""} ${
                  isSelected ? "ring-2 ring-primary ring-offset-1" : ""
                }`}
              >
                <div className="aspect-video bg-muted relative">
                  <button
                    type="button"
                    onClick={(e) => toggleSelect(item.id, e)}
                    className={`absolute top-2 left-2 z-20 h-6 w-6 rounded-md border-2 bg-background/95 backdrop-blur flex items-center justify-center transition-opacity ${
                      isSelected || selected.size > 0 ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    } ${isSelected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`}
                    aria-label={isSelected ? "Deseleccionar" : "Seleccionar"}
                  >
                    {isSelected && <CheckSquare className="h-3.5 w-3.5" />}
                  </button>
                  {canReorder && (
                    <div className="absolute top-2 right-2 z-10 bg-background/80 backdrop-blur rounded p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <GripVertical className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                  {item.imagen_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.imagen_url} alt={item.nombre} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-muted-foreground">
                      <ImageOff className="h-8 w-8" />
                      {item.activo && (
                        <span className="text-[10px] uppercase tracking-wide font-medium text-orange-600 dark:text-orange-400">
                          Falta foto
                        </span>
                      )}
                    </div>
                  )}
                  <Badge variant={item.tipo === "PRODUCTO" ? "default" : "secondary"} className="absolute bottom-2 left-2 gap-1">
                    {item.tipo === "PRODUCTO" ? <Package className="h-3 w-3" /> : <Wrench className="h-3 w-3" />}
                    {item.tipo}
                  </Badge>
                  {!item.activo && (
                    <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
                      <Badge variant="outline">Inactivo</Badge>
                    </div>
                  )}
                </div>
                <CardContent className="p-3 space-y-2">
                  <div>
                    <h3 className="font-medium text-sm line-clamp-1">{item.nombre}</h3>
                    {item.categoria && (
                      <p className="text-xs text-muted-foreground">{item.categoria.nombre}</p>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold">
                      {item.precio == null
                        ? <span className="text-muted-foreground italic">Consultar</span>
                        : item.precio_hasta != null
                          ? `Desde $${Number(item.precio).toLocaleString("es-AR")}`
                          : `$${Number(item.precio).toLocaleString("es-AR")}`}
                    </div>
                    {item.tipo === "PRODUCTO" && item.stock != null && (
                      <Badge variant={item.stock === 0 ? "destructive" : "outline"} className="text-xs">
                        Stock: {item.stock}
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-1 pt-1">
                    <Button variant="outline" size="sm" className="flex-1 gap-1" onClick={() => setEditing(item)}>
                      <Pencil className="h-3 w-3" />
                      Editar
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" aria-label="Más acciones">
                          <MoreVertical className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleDuplicate(item.id)}>
                          <Copy className="h-3.5 w-3.5 mr-2" />
                          Duplicar
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setDeleteId(item.id)}>
                          <Trash2 className="h-3.5 w-3.5 mr-2 text-destructive" />
                          <span className="text-destructive">Eliminar</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {selected.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 max-w-[calc(100vw-2rem)]">
          <div className="flex items-center gap-2 rounded-full border bg-background shadow-2xl pl-4 pr-2 py-2">
            <span className="text-sm font-medium whitespace-nowrap">
              {selected.size} seleccionado{selected.size > 1 ? "s" : ""}
            </span>
            <div className="h-5 w-px bg-border" />
            <div className="flex items-center gap-1 overflow-x-auto">
              <Button
                variant="ghost"
                size="sm"
                disabled={bulkLoading}
                onClick={() => runBulk("activar")}
                className="gap-1.5"
              >
                <Eye className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Activar</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={bulkLoading}
                onClick={() => runBulk("desactivar")}
                className="gap-1.5"
              >
                <EyeOff className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Desactivar</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={bulkLoading}
                onClick={() => runBulk("destacar")}
                className="gap-1.5"
              >
                <Star className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Destacar</span>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" disabled={bulkLoading} className="gap-1.5">
                    <FolderInput className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Categoría</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 max-h-72 overflow-y-auto">
                  <DropdownMenuItem onClick={() => runBulk("cambiar_categoria", null)}>
                    <span className="text-muted-foreground italic">Sin categoría</span>
                  </DropdownMenuItem>
                  {categorias.map((c) => (
                    <DropdownMenuItem key={c.id} onClick={() => runBulk("cambiar_categoria", c.id)}>
                      {c.nombre}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="ghost"
                size="sm"
                disabled={bulkLoading}
                onClick={() => setBulkConfirm("borrar")}
                className="gap-1.5 text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Eliminar</span>
              </Button>
            </div>
            <div className="h-5 w-px bg-border" />
            <Button
              variant="ghost"
              size="icon"
              onClick={clearSelection}
              disabled={bulkLoading}
              className="h-8 w-8 rounded-full"
              aria-label="Cancelar selección"
            >
              {bulkLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      )}

      {(creating || editing) && (
        <CatalogoItemDialog
          item={editing}
          categorias={categorias}
          open={creating || !!editing}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={() => { load(); setCreating(false); setEditing(null) }}
        />
      )}

      <CatalogoImportInventarioDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={load}
        categorias={categorias}
      />

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Eliminar item"
        description="Esta acción no se puede deshacer."
        confirmText="Eliminar"
        variant="danger"
        loading={deleting}
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={bulkConfirm === "borrar"}
        onOpenChange={(open) => !open && setBulkConfirm(null)}
        title={`Eliminar ${selected.size} item${selected.size > 1 ? "s" : ""}`}
        description="Esta acción no se puede deshacer. Los items seleccionados se eliminarán definitivamente."
        confirmText="Eliminar"
        variant="danger"
        loading={bulkLoading}
        onConfirm={() => runBulk("borrar")}
      />
    </div>
  )
}
