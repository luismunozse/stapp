"use client"

import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Search, Loader2, CheckSquare, Square, Package, Download } from "lucide-react"
import { toast } from "sonner"
import type { CatalogoCategoria } from "@/types/database"

interface InventarioItem {
  id: string
  codigo: string
  nombre: string
  categoria: string
  stock: number
  precioVenta: number
}

interface Props {
  open: boolean
  onClose: () => void
  onImported: () => void
  categorias: CatalogoCategoria[]
}

export function CatalogoImportInventarioDialog({ open, onClose, onImported, categorias }: Props) {
  const [search, setSearch] = useState("")
  const [items, setItems] = useState<InventarioItem[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [categoriaDestino, setCategoriaDestino] = useState<string>("")
  const [activarAlImportar, setActivarAlImportar] = useState(false)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    if (!open) {
      setSelected(new Set())
      setSearch("")
      setCategoriaDestino("")
      setActivarAlImportar(false)
      setItems([])
      return
    }
    void loadInventario("")
  }, [open])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => loadInventario(search), 250)
    return () => clearTimeout(t)
  }, [search, open])

  const loadInventario = async (q: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: "100" })
      if (q.trim()) params.set("search", q.trim())
      const res = await fetch(`/api/inventario?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setItems(data.items ?? data.data ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error cargando inventario")
    } finally {
      setLoading(false)
    }
  }

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    setSelected((prev) => {
      if (items.every((i) => prev.has(i.id))) return new Set()
      return new Set(items.map((i) => i.id))
    })
  }

  const handleImport = async () => {
    if (selected.size === 0) return
    setImporting(true)
    try {
      const res = await fetch("/api/catalogo/items/import-inventario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inventarioIds: Array.from(selected),
          categoriaId: categoriaDestino || null,
          activo: activarAlImportar,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Error al importar")

      const creados = data.creados ?? 0
      const saltados = data.saltados ?? 0
      if (creados > 0) {
        toast.success(
          `${creados} item${creados > 1 ? "s" : ""} importado${creados > 1 ? "s" : ""}` +
            (saltados > 0 ? ` · ${saltados} ya estaban` : "")
        )
        onImported()
        onClose()
      } else {
        toast.info(data.mensaje || "Todos los items seleccionados ya estaban en el catálogo")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al importar")
    } finally {
      setImporting(false)
    }
  }

  const allVisibleSelected = items.length > 0 && items.every((i) => selected.has(i.id))

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !importing && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-3">
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Importar desde inventario
          </DialogTitle>
          <DialogDescription>
            Crea items del catálogo a partir de tu inventario. Los items se linkean por stock (source of truth: inventario).
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 space-y-3 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre o código..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {items.length > 0 && (
            <button
              onClick={toggleAll}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {allVisibleSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
              {allVisibleSelected ? "Deseleccionar todo" : `Seleccionar ${items.length} visible${items.length > 1 ? "s" : ""}`}
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 min-h-[200px]">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
              {search ? "Sin resultados" : "Sin items en inventario"}
            </div>
          ) : (
            <ul className="space-y-1.5 pb-2">
              {items.map((it) => {
                const isSel = selected.has(it.id)
                return (
                  <li
                    key={it.id}
                    onClick={() => toggle(it.id)}
                    className={`flex items-center gap-3 p-2.5 rounded-md border cursor-pointer transition-colors ${
                      isSel ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                    }`}
                  >
                    <div
                      className={`h-5 w-5 rounded border-2 flex items-center justify-center shrink-0 ${
                        isSel ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
                      }`}
                    >
                      {isSel && <CheckSquare className="h-3 w-3" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm truncate">{it.nombre}</p>
                        <span className="text-xs text-muted-foreground font-mono shrink-0">{it.codigo}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{it.categoria}</span>
                        <span>·</span>
                        <span>Stock: {it.stock}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold">
                        ${Number(it.precioVenta || 0).toLocaleString("es-AR")}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="border-t bg-muted/30 p-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Categoría destino</Label>
              <select
                value={categoriaDestino}
                onChange={(e) => setCategoriaDestino(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="">Sin categoría</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
              <Label htmlFor="activar" className="text-sm cursor-pointer">
                Activar al importar
              </Label>
              <Switch id="activar" checked={activarAlImportar} onCheckedChange={setActivarAlImportar} />
            </div>
          </div>
          {!activarAlImportar && (
            <p className="text-xs text-muted-foreground">
              Los items se crearán inactivos. Revísalos y agregá fotos antes de publicar.
            </p>
          )}

          <div className="flex items-center justify-between pt-1">
            <Badge variant="outline" className="text-xs">
              {selected.size} seleccionado{selected.size !== 1 ? "s" : ""}
            </Badge>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose} disabled={importing}>
                Cancelar
              </Button>
              <Button onClick={handleImport} disabled={selected.size === 0 || importing} className="gap-1.5">
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Importar
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
