"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Plus, Search, Pencil, Trash2, ImageOff, Package, Wrench, GripVertical } from "lucide-react"
import { toast } from "sonner"
import type { CatalogoItem, CatalogoCategoria } from "@/types/database"
import { CatalogoItemDialog } from "./catalogo-item-dialog"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useDragReorder } from "./use-drag-reorder"

type ItemConCategoria = CatalogoItem & { categoria?: { id: string; nombre: string } | null }

export function CatalogoItemsTab() {
  const [items, setItems] = useState<ItemConCategoria[]>([])
  const [categorias, setCategorias] = useState<CatalogoCategoria[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [filterTipo, setFilterTipo] = useState<"" | "PRODUCTO" | "SERVICIO">("")
  const [editing, setEditing] = useState<ItemConCategoria | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

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
    if (search && !it.nombre.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const canReorder = !search && !filterTipo

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
        <Button onClick={() => setCreating(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Nuevo item
        </Button>
      </div>

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
          {filtered.map((item, idx) => (
            <Card
              key={item.id}
              draggable={canReorder}
              onDragStart={canReorder ? dnd.onDragStart(idx) : undefined}
              onDragOver={canReorder ? dnd.onDragOver : undefined}
              onDrop={canReorder ? dnd.onDrop(idx) : undefined}
              onDragEnd={canReorder ? dnd.onDragEnd : undefined}
              className={`overflow-hidden group hover:shadow-md transition-all ${
                dnd.draggingId === item.id ? "opacity-40" : ""
              } ${canReorder ? "cursor-move" : ""}`}
            >
              <div className="aspect-video bg-muted relative">
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
                <Badge variant={item.tipo === "PRODUCTO" ? "default" : "secondary"} className="absolute top-2 left-2 gap-1">
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
          ))}
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
    </div>
  )
}
