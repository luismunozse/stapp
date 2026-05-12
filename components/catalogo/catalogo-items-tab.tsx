"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import {
  Plus, Search, Pencil, Trash2, ImageOff, Package, Wrench, GripVertical,
  CheckSquare, Square, X, Eye, EyeOff, Star, FolderInput, Loader2,
} from "lucide-react"
import { toast } from "sonner"
import type { CatalogoItem, CatalogoCategoria } from "@/types/database"
import { CatalogoItemDialog } from "./catalogo-item-dialog"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { useDragReorder } from "./use-drag-reorder"

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
    if (search && !it.nombre.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const hasFilters = !!search || !!filterTipo || !!filterCategoria || !!filterEstado
  const canReorder = !hasFilters && selected.size === 0

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

  const handleDelete = async () => {
    if (!deleteId) return
    const res = await fetch(`/api/catalogo/items/${deleteId}`, { method: "DELETE" })
    if (res.ok) {
      toast.success("Item eliminado")
      setItems((prev) => prev.filter((i) => i.id !== deleteId))
    } else {
      toast.error("Error al eliminar")
    }
    setDeleteId(null)
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
        <Button onClick={() => setCreating(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Nuevo item
        </Button>
      </div>

      {filtered.length > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <button
            onClick={selectAllVisible}
            className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            {allVisibleSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
            {allVisibleSelected ? "Deseleccionar todo" : `Seleccionar ${filtered.length} visible${filtered.length > 1 ? "s" : ""}`}
          </button>
          <span>{filtered.length} de {items.length} items</span>
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
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                      <ImageOff className="h-8 w-8" />
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
                    <Button variant="outline" size="sm" onClick={() => setDeleteId(item.id)}>
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
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

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Eliminar item"
        description="Esta acción no se puede deshacer."
        confirmText="Eliminar"
        variant="danger"
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
