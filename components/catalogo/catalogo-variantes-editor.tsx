"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Loader2, Plus, Trash2, Pencil, Layers, Upload, X, ImageOff } from "lucide-react"
import { toast } from "sonner"

interface Variante {
  id: string
  etiqueta: string
  sku: string | null
  precio: number | null
  stock: number | null
  imagen_url: string | null
  activo: boolean
  orden: number
}

interface Props {
  itemId: string
}

export function CatalogoVariantesEditor({ itemId }: Props) {
  const [variantes, setVariantes] = useState<Variante[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Variante | null>(null)
  const [creating, setCreating] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/catalogo/items/${itemId}/variantes`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setVariantes(data.variantes ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error cargando variantes")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [itemId])

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar variante?")) return
    const res = await fetch(`/api/catalogo/items/${itemId}/variantes/${id}`, { method: "DELETE" })
    if (res.ok) {
      setVariantes((prev) => prev.filter((v) => v.id !== id))
      toast.success("Variante eliminada")
    } else {
      toast.error("Error al eliminar")
    }
  }

  const toggleActivo = async (v: Variante) => {
    const next = !v.activo
    setVariantes((prev) => prev.map((x) => (x.id === v.id ? { ...x, activo: next } : x)))
    try {
      const res = await fetch(`/api/catalogo/items/${itemId}/variantes/${v.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: next }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setVariantes((prev) => prev.map((x) => (x.id === v.id ? { ...x, activo: !next } : x)))
      toast.error("Error al actualizar")
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Layers className="h-4 w-4 text-muted-foreground" />
          <Label className="font-medium">Variantes</Label>
          <span className="text-xs text-muted-foreground">
            ({variantes.length}{variantes.length > 0 ? ` · ${variantes.filter((v) => v.activo).length} activas` : ""})
          </span>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => setCreating(true)} className="gap-1.5">
          <Plus className="h-3 w-3" />
          Agregar
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-4 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : variantes.length === 0 ? (
        <p className="text-xs text-muted-foreground p-3 border rounded-md bg-muted/30">
          Sin variantes. Si el item tiene opciones (color, talla, capacidad), agregalas aquí. El cliente deberá elegir una.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {variantes.map((v) => (
            <li
              key={v.id}
              className={`flex items-center gap-2 rounded-md border p-2 text-sm ${
                v.activo ? "" : "opacity-60"
              }`}
            >
              <div className="h-10 w-10 rounded bg-muted overflow-hidden flex items-center justify-center shrink-0">
                {v.imagen_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={v.imagen_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <ImageOff className="h-3 w-3 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{v.etiqueta}</div>
                <div className="text-xs text-muted-foreground flex gap-2">
                  {v.sku && <span className="font-mono">{v.sku}</span>}
                  {v.precio != null && <span>${Number(v.precio).toLocaleString("es-AR")}</span>}
                  {v.stock != null && <span>Stock: {v.stock}</span>}
                </div>
              </div>
              <Switch checked={v.activo} onCheckedChange={() => toggleActivo(v)} />
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(v)}>
                <Pencil className="h-3 w-3" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => handleDelete(v.id)}
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {(creating || editing) && (
        <VarianteForm
          itemId={itemId}
          variante={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={() => { load(); setCreating(false); setEditing(null) }}
        />
      )}
    </div>
  )
}

function VarianteForm({
  itemId,
  variante,
  onClose,
  onSaved,
}: {
  itemId: string
  variante: Variante | null
  onClose: () => void
  onSaved: () => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [etiqueta, setEtiqueta] = useState(variante?.etiqueta ?? "")
  const [sku, setSku] = useState(variante?.sku ?? "")
  const [precio, setPrecio] = useState(variante?.precio != null ? String(variante.precio) : "")
  const [stock, setStock] = useState(variante?.stock != null ? String(variante.stock) : "")
  const [imagenUrl, setImagenUrl] = useState<string | null>(variante?.imagen_url ?? null)
  const [activo, setActivo] = useState(variante?.activo ?? true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  const handleUpload = async (file: File) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/catalogo/upload", { method: "POST", body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setImagenUrl(data.url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al subir")
    } finally {
      setUploading(false)
    }
  }

  const handleSave = async () => {
    if (!etiqueta.trim()) {
      toast.error("La etiqueta es requerida")
      return
    }
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        etiqueta: etiqueta.trim(),
        sku: sku.trim() || null,
        precio: precio ? Number(precio) : null,
        stock: stock ? Number(stock) : null,
        imagen_url: imagenUrl,
        activo,
      }
      const url = variante
        ? `/api/catalogo/items/${itemId}/variantes/${variante.id}`
        : `/api/catalogo/items/${itemId}/variantes`
      const res = await fetch(url, {
        method: variante ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Error al guardar")
      toast.success(variante ? "Variante actualizada" : "Variante creada")
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{variante ? "Editar variante" : "Nueva variante"}</Label>
        <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="h-3 w-3" />
        </Button>
      </div>

      <div>
        <Label htmlFor="vetq" className="text-xs">Etiqueta *</Label>
        <Input
          id="vetq"
          value={etiqueta}
          onChange={(e) => setEtiqueta(e.target.value)}
          maxLength={80}
          placeholder="Ej: Negro 64GB"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="vsku" className="text-xs">SKU</Label>
          <Input id="vsku" value={sku} onChange={(e) => setSku(e.target.value)} maxLength={64} />
        </div>
        <div>
          <Label htmlFor="vstock" className="text-xs">Stock</Label>
          <Input
            id="vstock"
            type="number"
            min="0"
            step="1"
            value={stock}
            onChange={(e) => setStock(e.target.value)}
            placeholder="Sin tracking"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="vprecio" className="text-xs">Precio (opcional, sobreescribe el del item)</Label>
        <Input
          id="vprecio"
          type="number"
          min="0"
          step="0.01"
          value={precio}
          onChange={(e) => setPrecio(e.target.value)}
          placeholder="Hereda del item"
        />
      </div>

      <div className="flex items-center gap-2">
        <div className="w-16 h-16 rounded-md bg-muted overflow-hidden flex items-center justify-center border">
          {imagenUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imagenUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <ImageOff className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="gap-1.5"
          >
            {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
            {imagenUrl ? "Cambiar" : "Subir imagen"}
          </Button>
          {imagenUrl && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setImagenUrl(null)}
              className="gap-1.5 text-destructive"
            >
              Quitar
            </Button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleUpload(f)
              e.target.value = ""
            }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Label className="text-xs">Activa</Label>
        <Switch checked={activo} onCheckedChange={setActivo} />
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t">
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <Button type="button" size="sm" onClick={handleSave} disabled={saving || uploading} className="gap-1.5">
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          Guardar
        </Button>
      </div>
    </div>
  )
}
