"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Plus, FolderTree, Pencil, Trash2, Loader2, GripVertical, Upload, ImageOff, X } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import type { CatalogoCategoria } from "@/types/database"
import { useDragReorder } from "./use-drag-reorder"

export function CatalogoCategoriasTab() {
  const [categorias, setCategorias] = useState<CatalogoCategoria[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<CatalogoCategoria | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/catalogo/categorias")
      const data = await res.json()
      setCategorias(data.categorias ?? [])
    } catch {
      toast.error("Error cargando categorías")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleDelete = async () => {
    if (!deleteId) return
    const res = await fetch(`/api/catalogo/categorias/${deleteId}`, { method: "DELETE" })
    if (res.ok) {
      toast.success("Categoría eliminada")
      setCategorias((prev) => prev.filter((c) => c.id !== deleteId))
    } else {
      toast.error("Error al eliminar")
    }
    setDeleteId(null)
  }

  const handleReorder = async (next: CatalogoCategoria[]) => {
    setCategorias(next)
    const payload = { orden: next.map((c, i) => ({ id: c.id, orden: i })) }
    try {
      const res = await fetch("/api/catalogo/categorias/reorder", {
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

  const dnd = useDragReorder(categorias, handleReorder)

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Nueva categoría
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 bg-muted rounded-md animate-pulse" />
          ))}
        </div>
      ) : categorias.length === 0 ? (
        <EmptyState
          icon={FolderTree}
          title="Sin categorías"
          description="Las categorías ayudan a tus clientes a encontrar lo que buscan."
          action={{ label: "Crear categoría", onClick: () => setCreating(true) }}
        />
      ) : (
        <div className="space-y-2">
          {categorias.map((cat, idx) => (
            <Card
              key={cat.id}
              draggable
              onDragStart={dnd.onDragStart(idx)}
              onDragOver={dnd.onDragOver}
              onDrop={dnd.onDrop(idx)}
              onDragEnd={dnd.onDragEnd}
              className={`transition-opacity cursor-move ${dnd.draggingId === cat.id ? "opacity-40" : ""}`}
            >
              <CardContent className="p-3 flex items-center justify-between gap-3">
                <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                {cat.imagen_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cat.imagen_url} alt="" className="h-9 w-9 rounded object-cover border shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium">
                    {cat.nombre}
                    {!cat.activo && (
                      <span className="ml-2 inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground align-middle">
                        Inactiva
                      </span>
                    )}
                  </h3>
                  {cat.slug && (
                    <p className="text-xs text-muted-foreground font-mono">/c/{cat.slug}</p>
                  )}
                  {cat.descripcion && (
                    <p className="text-sm text-muted-foreground line-clamp-1">{cat.descripcion}</p>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" onClick={() => setEditing(cat)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setDeleteId(cat.id)}>
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <CategoriaDialog
          categoria={editing}
          open={creating || !!editing}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={() => { load(); setCreating(false); setEditing(null) }}
        />
      )}

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title="Eliminar categoría"
        description="Los items de esta categoría quedarán sin categoría asignada."
        confirmText="Eliminar"
        variant="danger"
        onConfirm={handleDelete}
      />
    </div>
  )
}

function CategoriaDialog({
  categoria,
  open,
  onClose,
  onSaved,
}: {
  categoria: CatalogoCategoria | null
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [nombre, setNombre] = useState(categoria?.nombre ?? "")
  const [slug, setSlug] = useState(categoria?.slug ?? "")
  const [descripcion, setDescripcion] = useState(categoria?.descripcion ?? "")
  const [saving, setSaving] = useState(false)
  const [imagenUrl, setImagenUrl] = useState<string | null>(categoria?.imagen_url ?? null)
  const [activo, setActivo] = useState<boolean>(categoria?.activo ?? true)
  const [uploading, setUploading] = useState(false)

  const handleUpload = async (file: File) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/catalogo/upload", { method: "POST", body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Error al subir imagen")
      setImagenUrl(data.url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al subir imagen")
    } finally {
      setUploading(false)
    }
  }

  const handleSave = async () => {
    if (!nombre.trim()) return toast.error("Nombre requerido")
    setSaving(true)
    try {
      const url = categoria ? `/api/catalogo/categorias/${categoria.id}` : "/api/catalogo/categorias"
      const method = categoria ? "PUT" : "POST"
      const payload: Record<string, unknown> = {
        nombre: nombre.trim(),
        descripcion: descripcion.trim() || null,
      }
      if (slug.trim()) payload.slug = slug.trim()
      payload.imagen_url = imagenUrl
      payload.activo = activo
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Error")
      toast.success(categoria ? "Categoría actualizada" : "Categoría creada")
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{categoria ? "Editar categoría" : "Nueva categoría"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Imagen (opcional)</Label>
            <div className="mt-1.5 flex items-center gap-3">
              <div className="w-20 h-20 bg-muted rounded-md overflow-hidden flex items-center justify-center border shrink-0">
                {imagenUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imagenUrl} alt="Imagen de la categoría" className="w-full h-full object-cover" />
                ) : (
                  <ImageOff className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  id="cat-img"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handleUpload(f)
                    e.target.value = ""
                  }}
                />
                <Button type="button" variant="outline" size="sm" disabled={uploading} className="gap-1.5"
                  onClick={() => document.getElementById("cat-img")?.click()}>
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {imagenUrl ? "Cambiar" : "Subir"}
                </Button>
                {imagenUrl && (
                  <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-destructive"
                    onClick={() => setImagenUrl(null)}>
                    <X className="h-4 w-4" /> Quitar
                  </Button>
                )}
              </div>
            </div>
          </div>
          <div>
            <Label htmlFor="cat-nombre">Nombre *</Label>
            <Input id="cat-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={80} />
          </div>
          <div>
            <Label htmlFor="cat-slug">Slug URL</Label>
            <div className="flex items-center gap-1 mt-1">
              <span className="text-xs text-muted-foreground whitespace-nowrap">/c/</span>
              <Input
                id="cat-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                maxLength={64}
                placeholder={categoria ? "" : "Auto desde nombre"}
                pattern="[a-z0-9][a-z0-9-]*[a-z0-9]"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              URL pública SEO: /catalogo/.../c/{slug || "<auto>"}. Sólo a-z, 0-9, guiones.
            </p>
          </div>
          <div>
            <Label htmlFor="cat-desc">Descripción</Label>
            <Textarea id="cat-desc" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={2} maxLength={500} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="cat-activo">Activa</Label>
              <p className="text-xs text-muted-foreground">Si la desactivás, no se muestra en el catálogo público.</p>
            </div>
            <Switch id="cat-activo" checked={activo} onCheckedChange={setActivo} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-3 border-t">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            Guardar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
