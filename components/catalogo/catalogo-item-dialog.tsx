"use client"

import { useEffect, useRef, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Upload, Loader2, ImageOff, X, Star } from "lucide-react"
import { toast } from "sonner"
import type { CatalogoItem, CatalogoCategoria } from "@/types/database"
import { CatalogoVariantesEditor } from "./catalogo-variantes-editor"

interface Props {
  item: CatalogoItem | null
  categorias: CatalogoCategoria[]
  open: boolean
  onClose: () => void
  onSaved: () => void
}

export function CatalogoItemDialog({ item, categorias, open, onClose, onSaved }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  const [tipo, setTipo] = useState<"PRODUCTO" | "SERVICIO">("PRODUCTO")
  const [nombre, setNombre] = useState("")
  const [descripcion, setDescripcion] = useState("")
  const [categoriaId, setCategoriaId] = useState<string>("")
  const [precio, setPrecio] = useState<string>("")
  const [precioHasta, setPrecioHasta] = useState<string>("")
  const [precioLista, setPrecioLista] = useState<string>("")
  const [stock, setStock] = useState<string>("")
  const [imagenUrl, setImagenUrl] = useState<string | null>(null)
  const [activo, setActivo] = useState(true)
  const [destacado, setDestacado] = useState(false)

  useEffect(() => {
    if (item) {
      setTipo(item.tipo)
      setNombre(item.nombre)
      setDescripcion(item.descripcion ?? "")
      setCategoriaId(item.categoria_id ?? "")
      setPrecio(item.precio != null ? String(item.precio) : "")
      setPrecioHasta(item.precio_hasta != null ? String(item.precio_hasta) : "")
      setPrecioLista(item.precio_lista != null ? String(item.precio_lista) : "")
      setStock(item.stock != null ? String(item.stock) : "")
      setImagenUrl(item.imagen_url ?? null)
      setActivo(item.activo)
      setDestacado(item.destacado ?? false)
    } else {
      setTipo("PRODUCTO")
      setNombre("")
      setDescripcion("")
      setCategoriaId("")
      setPrecio("")
      setPrecioHasta("")
      setPrecioLista("")
      setStock("")
      setImagenUrl(null)
      setActivo(true)
      setDestacado(false)
    }
  }, [item, open])

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
    if (!nombre.trim()) {
      toast.error("Nombre requerido")
      return
    }

    const payload: Record<string, unknown> = {
      tipo,
      nombre: nombre.trim(),
      descripcion: descripcion.trim() || null,
      categoria_id: categoriaId || null,
      precio: precio ? Number(precio) : null,
      precio_hasta: precioHasta ? Number(precioHasta) : null,
      precio_lista: precioLista ? Number(precioLista) : null,
      imagen_url: imagenUrl,
      activo,
      destacado,
    }

    if (tipo === "PRODUCTO") {
      payload.stock = stock ? Number(stock) : null
    } else {
      payload.stock = null
    }

    setSaving(true)
    try {
      const url = item ? `/api/catalogo/items/${item.id}` : "/api/catalogo/items"
      const method = item ? "PUT" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Error al guardar")
      toast.success(item ? "Item actualizado" : "Item creado")
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item ? "Editar item" : "Nuevo item"}</DialogTitle>
          <DialogDescription>
            Producto o servicio que aparecerá en tu catálogo público.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={tipo === "PRODUCTO" ? "default" : "outline"}
              onClick={() => setTipo("PRODUCTO")}
            >
              Producto
            </Button>
            <Button
              type="button"
              variant={tipo === "SERVICIO" ? "default" : "outline"}
              onClick={() => setTipo("SERVICIO")}
            >
              Servicio
            </Button>
          </div>

          <div>
            <Label>Imagen</Label>
            <div className="mt-1.5 flex items-center gap-3">
              <div className="w-32 aspect-video bg-muted rounded-md overflow-hidden flex items-center justify-center border">
                {imagenUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imagenUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <ImageOff className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="gap-1.5"
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
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
                    <X className="h-4 w-4" />
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
          </div>

          <div>
            <Label htmlFor="nombre">Nombre *</Label>
            <Input id="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={160} />
          </div>

          <div>
            <Label htmlFor="descripcion">Descripción</Label>
            <Textarea
              id="descripcion"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              rows={3}
              maxLength={2000}
            />
          </div>

          <div>
            <Label htmlFor="categoria">Categoría</Label>
            <select
              id="categoria"
              value={categoriaId}
              onChange={(e) => setCategoriaId(e.target.value)}
              className="mt-1 w-full h-10 rounded-md border bg-background px-3 text-sm"
            >
              <option value="">Sin categoría</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="precio">Precio</Label>
              <Input
                id="precio"
                type="text"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={precio}
                onChange={(e) => setPrecio(e.target.value)}
                placeholder="Vacío = consultar"
              />
            </div>
            <div>
              <Label htmlFor="precio_hasta">Precio hasta (rango)</Label>
              <Input
                id="precio_hasta"
                type="text"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={precioHasta}
                onChange={(e) => setPrecioHasta(e.target.value)}
                placeholder="Opcional"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="precio_lista">Precio de lista (antes)</Label>
            <Input
              id="precio_lista"
              type="text"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={precioLista}
              onChange={(e) => setPrecioLista(e.target.value)}
              placeholder="Opcional — se muestra tachado si es mayor que el precio"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Anchor pricing: si es mayor que el precio actual, se renderiza tachado con el % de descuento.
            </p>
          </div>

          {tipo === "PRODUCTO" && (
            <div>
              <Label htmlFor="stock">Stock disponible</Label>
              <Input
                id="stock"
                type="text"
                inputMode="numeric"
                min="0"
                step="1"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                placeholder="Vacío = sin tracking"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Si lo dejás vacío, no se trackea stock. 0 = agotado.
              </p>
            </div>
          )}

          {item && tipo === "PRODUCTO" && (
            <div className="pt-2 border-t">
              <CatalogoVariantesEditor itemId={item.id} />
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <div className="flex items-start gap-2">
              <Star className="h-4 w-4 text-yellow-500 mt-0.5" />
              <div>
                <Label htmlFor="destacado">Destacar item</Label>
                <p className="text-xs text-muted-foreground">Aparece primero con badge "Destacado".</p>
              </div>
            </div>
            <Switch id="destacado" checked={destacado} onCheckedChange={setDestacado} />
          </div>

          <div className="flex items-center justify-between pt-2">
            <div>
              <Label htmlFor="activo">Visible en el catálogo</Label>
              <p className="text-xs text-muted-foreground">Si lo desactivás, no aparece para los clientes.</p>
            </div>
            <Switch id="activo" checked={activo} onCheckedChange={setActivo} />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving || uploading}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            {item ? "Guardar cambios" : "Crear item"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
