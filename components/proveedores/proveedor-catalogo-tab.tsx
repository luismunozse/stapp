"use client"

import { useState, useMemo } from "react"
import useSWR from "swr"
import { toast } from "sonner"
import {
  Plus, Save, X, Trash2, Edit, Link2, AlertCircle, Search,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { useCurrency } from "@/contexts/currency-context"
import { EmptyState } from "@/components/ui/empty-state"

interface CatalogoItem {
  id: string
  codigoProveedor: string | null
  nombre: string
  descripcion: string | null
  precioReferencia: number | null
  moneda: string
  unidad: string | null
  notas: string | null
  precioActualizadoAt: string | null
  inventarioId: string | null
  inventario: { id: string; codigo: string; nombre: string } | null
}

/** El endpoint reporta `canViewCost` aparte de nullear `precioReferencia`:
 *  el precio es nullable de por sí, así que una celda en null no distingue
 *  "sin precio cargado" de "precio oculto". Adivinar desde el valor le
 *  escondería el input a un ADMIN cuyo catálogo todavía no tiene precios. */
interface CatalogoResponse {
  items: CatalogoItem[]
  canViewCost: boolean
}

interface Draft {
  nombre: string
  codigoProveedor: string
  descripcion: string
  precioReferencia: string
  unidad: string
  notas: string
  inventarioId: string
}

const empty: Draft = {
  nombre: "", codigoProveedor: "", descripcion: "", precioReferencia: "", unidad: "", notas: "", inventarioId: "",
}

const fetcher = (url: string) => fetch(url).then(r => r.json())

function fmtDate(iso: string | null, timezone: string) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: timezone })
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  return Math.floor(ms / 86400000)
}

export function ProveedorCatalogoTab({ proveedorId }: { proveedorId: string }) {
  const { formatPrice, timezone } = useCurrency()
  const [search, setSearch] = useState("")
  const { data, mutate } = useSWR<CatalogoResponse>(
    `/api/proveedores/${proveedorId}/catalogo`,
    fetcher,
    { revalidateOnFocus: false }
  )
  // Memoizado para que el `?? []` no devuelva un array nuevo en cada render:
  // sin esto el useMemo de `filtered` se recalcula siempre.
  const items = useMemo(() => data?.items ?? [], [data])
  const canViewCost = data?.canViewCost ?? false

  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<Draft>(empty)
  const [saving, setSaving] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter((i) =>
      `${i.codigoProveedor || ""} ${i.nombre} ${i.descripcion || ""}`.toLowerCase().includes(q)
    )
  }, [items, search])

  const startAdd = () => {
    setAdding(true)
    setEditingId(null)
    setDraft(empty)
  }

  const startEdit = (i: CatalogoItem) => {
    setAdding(false)
    setEditingId(i.id)
    setDraft({
      nombre: i.nombre,
      codigoProveedor: i.codigoProveedor || "",
      descripcion: i.descripcion || "",
      precioReferencia: i.precioReferencia != null ? String(i.precioReferencia) : "",
      unidad: i.unidad || "",
      notas: i.notas || "",
      inventarioId: i.inventarioId || "",
    })
  }

  const cancel = () => {
    setAdding(false)
    setEditingId(null)
    setDraft(empty)
  }

  const save = async () => {
    if (!draft.nombre.trim()) {
      toast.error("Nombre requerido")
      return
    }
    setSaving(true)
    try {
      // Sin permiso de costo el input ni se muestra, así que el draft queda
      // vacío: mandar la clave escribiría null sobre el precio guardado. El
      // endpoint sólo pisa precio_referencia si la clave viaja, así que se
      // omite y la columna conserva su valor.
      const payload = {
        nombre: draft.nombre,
        codigoProveedor: draft.codigoProveedor || undefined,
        descripcion: draft.descripcion || undefined,
        ...(canViewCost
          ? { precioReferencia: draft.precioReferencia !== "" ? Number(draft.precioReferencia) : null }
          : {}),
        unidad: draft.unidad || undefined,
        notas: draft.notas || undefined,
        inventarioId: draft.inventarioId || null,
      }
      const url = editingId
        ? `/api/proveedores/${proveedorId}/catalogo/${editingId}`
        : `/api/proveedores/${proveedorId}/catalogo`
      const res = await fetch(url, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || "Error al guardar")
        return
      }
      toast.success(editingId ? "Item actualizado" : "Item agregado")
      cancel()
      mutate()
    } finally {
      setSaving(false)
    }
  }

  const remove = async (i: CatalogoItem) => {
    if (!confirm(`¿Eliminar "${i.nombre}"?`)) return
    const res = await fetch(`/api/proveedores/${proveedorId}/catalogo/${i.id}`, { method: "DELETE" })
    if (res.ok) {
      toast.success("Item eliminado")
      mutate()
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar item..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="flex-1 text-sm text-muted-foreground">
          {items.length} item{items.length === 1 ? "" : "s"} en catálogo
        </div>
        <Button size="sm" onClick={startAdd}>
          <Plus className="h-4 w-4 mr-1" />Nuevo
        </Button>
      </div>

      {(adding || editingId) && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="catalogo-nombre">Nombre *</Label>
                <Input
                  id="catalogo-nombre"
                  value={draft.nombre}
                  onChange={(e) => setDraft({ ...draft, nombre: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="catalogo-codigo">Código del proveedor</Label>
                <Input
                  id="catalogo-codigo"
                  value={draft.codigoProveedor}
                  onChange={(e) => setDraft({ ...draft, codigoProveedor: e.target.value })}
                  placeholder="SKU del proveedor"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="catalogo-unidad">Unidad</Label>
                <Input
                  id="catalogo-unidad"
                  value={draft.unidad}
                  onChange={(e) => setDraft({ ...draft, unidad: e.target.value })}
                  placeholder="unidad, caja, kg..."
                />
              </div>
              {canViewCost && (
                <div className="space-y-1">
                  <Label htmlFor="catalogo-precio">Precio referencia</Label>
                  <Input
                    id="catalogo-precio"
                    type="number"
                    min={0}
                    step="0.01"
                    value={draft.precioReferencia}
                    onChange={(e) => setDraft({ ...draft, precioReferencia: e.target.value })}
                  />
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="catalogo-inventario">Inventario vinculado (ID)</Label>
                <Input
                  id="catalogo-inventario"
                  value={draft.inventarioId}
                  onChange={(e) => setDraft({ ...draft, inventarioId: e.target.value })}
                  placeholder="ID del item de inventario (opcional)"
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="catalogo-descripcion">Descripción</Label>
                <Input
                  id="catalogo-descripcion"
                  value={draft.descripcion}
                  onChange={(e) => setDraft({ ...draft, descripcion: e.target.value })}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="catalogo-notas">Notas</Label>
                <Input
                  id="catalogo-notas"
                  value={draft.notas}
                  onChange={(e) => setDraft({ ...draft, notas: e.target.value })}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={cancel}><X className="h-4 w-4 mr-1" />Cancelar</Button>
              <Button size="sm" onClick={save} disabled={saving}><Save className="h-4 w-4 mr-1" />Guardar</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {items.length === 0 && !adding ? (
        <EmptyState
          icon={Link2}
          title="Sin items en catálogo"
          description="Cargá los productos que ofrece el proveedor con su precio de referencia."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-auto">
              <table className="w-full text-xs sm:text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left">Código</th>
                    <th className="px-3 py-2 text-left">Producto</th>
                    {canViewCost && <th className="px-3 py-2 text-right">Precio ref.</th>}
                    <th className="px-3 py-2 text-left">Actualizado</th>
                    <th className="px-3 py-2 text-left">Inventario</th>
                    <th className="px-3 py-2 w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((i) => {
                    const dias = daysSince(i.precioActualizadoAt)
                    const stale = dias != null && dias > 60
                    return (
                      <tr key={i.id} className="border-t">
                        <td className="px-3 py-2 font-mono text-[11px]">{i.codigoProveedor || "—"}</td>
                        <td className="px-3 py-2">
                          <div className="font-medium">{i.nombre}</div>
                          {i.descripcion && <div className="text-[11px] text-muted-foreground">{i.descripcion}</div>}
                        </td>
                        {canViewCost && (
                          <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                            {i.precioReferencia != null ? formatPrice(i.precioReferencia) : "—"}
                            {i.unidad && <span className="text-[10px] text-muted-foreground ml-1">/ {i.unidad}</span>}
                          </td>
                        )}
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className={stale ? "text-warning-600" : ""}>
                            {fmtDate(i.precioActualizadoAt, timezone)}
                          </span>
                          {stale && (
                            <span className="ml-1 inline-flex items-center text-[10px] text-warning-600">
                              <AlertCircle className="h-3 w-3 mr-0.5" />
                              {dias}d
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {i.inventario ? (
                            <Badge variant="outline" className="gap-1 text-[10px]">
                              <Link2 className="h-2.5 w-2.5" />
                              {i.inventario.codigo}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-[11px]">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1 justify-end">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              aria-label="Editar item"
                              onClick={() => startEdit(i)}
                            >
                              <Edit className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              aria-label="Eliminar item"
                              onClick={() => remove(i)}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
