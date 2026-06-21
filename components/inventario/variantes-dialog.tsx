"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  Loader2,
  Plus,
  Trash2,
  Layers,
  MoreVertical,
  Sparkles,
  X,
  AlertTriangle,
  RefreshCw,
} from "lucide-react"

// ============================================================
// Variantes dialog: gestor completo de variantes de un item.
// ============================================================

interface Variante {
  id: string
  inventarioId: string
  nombre: string
  atributos: Record<string, string | number | boolean>
  codigoVariante: string
  barcode: string | null
  stock: number
  stockReservado: number
  stockDisponible: number
  precioCompra: number | null
  precioVenta: number | null
  imagenUrl: string | null
  imagenPath: string | null
  activo: boolean
  orden: number
}

interface Parent {
  id: string
  nombre: string
  stock: number
  stockReservado: number
  tieneVariantes: boolean
  precioCompra: number | null
  precioVenta: number | null
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  inventarioId: string
  inventarioNombre: string
  onChange?: () => void
}

interface RowEdits {
  nombre?: string
  barcode?: string
  precioVenta?: string
  stockInput?: string
}

export function VariantesDialog({
  open,
  onOpenChange,
  inventarioId,
  inventarioNombre,
  onChange,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [variantes, setVariantes] = useState<Variante[]>([])
  const [parent, setParent] = useState<Parent | null>(null)
  const [totals, setTotals] = useState<{ stock: number; stockReservado: number }>({
    stock: 0,
    stockReservado: 0,
  })
  const [error, setError] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, RowEdits>>({})

  // New variant form
  const [creating, setCreating] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [newForm, setNewForm] = useState({
    nombre: "",
    codigoVariante: "",
    barcode: "",
    stock: "0",
    precioCompra: "",
    precioVenta: "",
    atributos: [{ key: "", value: "" }] as { key: string; value: string }[],
  })

  // Generador de combinaciones
  const [showGenerator, setShowGenerator] = useState(false)
  const [genAttrs, setGenAttrs] = useState<{ key: string; values: string }[]>([
    { key: "color", values: "" },
    { key: "talle", values: "" },
  ])
  const [generating, setGenerating] = useState(false)

  // Consolidación
  const [consolidateOpen, setConsolidateOpen] = useState(false)
  const [consolidating, setConsolidating] = useState(false)

  // Confirm delete
  const [deleteTarget, setDeleteTarget] = useState<Variante | null>(null)
  const [forceDelete, setForceDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const refetch = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/inventario/${inventarioId}/variantes`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Error al cargar")
      setVariantes(json.data || [])
      setParent(json.parent)
      setTotals(json.totals || { stock: 0, stockReservado: 0 })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar variantes")
    } finally {
      setLoading(false)
    }
  }, [inventarioId])

  useEffect(() => {
    if (open) {
      refetch()
      setEdits({})
      setShowNew(false)
      setShowGenerator(false)
    }
  }, [open, refetch])

  // -------- Edición inline --------

  const setEdit = (id: string, patch: RowEdits) => {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  const currentValue = (v: Variante, field: keyof RowEdits): string => {
    const edit = edits[v.id]?.[field]
    if (edit !== undefined) return edit
    if (field === "nombre") return v.nombre
    if (field === "barcode") return v.barcode ?? ""
    if (field === "precioVenta") return v.precioVenta?.toString() ?? ""
    if (field === "stockInput") return v.stock.toString()
    return ""
  }

  const hasChanges = (v: Variante): boolean => {
    const e = edits[v.id]
    if (!e) return false
    return Object.keys(e).some((k) => {
      const key = k as keyof RowEdits
      const orig = currentValue({ ...v }, key) // dummy
      void orig
      return true
    })
  }

  const saveField = async (v: Variante, field: keyof RowEdits) => {
    const value = edits[v.id]?.[field]
    if (value === undefined) return

    setBusyId(v.id)
    try {
      if (field === "stockInput") {
        const num = Number(value)
        if (!Number.isFinite(num) || num < 0 || !Number.isInteger(num)) {
          throw new Error("Stock debe ser entero >= 0")
        }
        if (num === v.stock) {
          setEdits((p) => {
            const c = { ...p }
            if (c[v.id]) delete c[v.id]!.stockInput
            return c
          })
          return
        }
        const res = await fetch(`/api/inventario/variantes/${v.id}/stock`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "absolute", value: num, motivo: "Edición inline" }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j.error || "Error al ajustar stock")
        }
      } else {
        const body: Record<string, any> = {}
        if (field === "nombre") body.nombre = value
        else if (field === "barcode") body.barcode = value || null
        else if (field === "precioVenta") {
          if (value === "") body.precioVenta = null
          else {
            const n = Number(value)
            if (!Number.isFinite(n) || n < 0) throw new Error("Precio inválido")
            body.precioVenta = n
          }
        }
        const res = await fetch(`/api/inventario/variantes/${v.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j.error || "Error al actualizar")
        }
      }

      setEdits((p) => {
        const c = { ...p }
        if (c[v.id]) {
          delete c[v.id]![field]
          if (Object.keys(c[v.id]!).length === 0) delete c[v.id]
        }
        return c
      })
      await refetch()
      onChange?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar")
    } finally {
      setBusyId(null)
    }
  }

  const toggleActivo = async (v: Variante) => {
    setBusyId(v.id)
    try {
      const res = await fetch(`/api/inventario/variantes/${v.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: !v.activo }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || "Error al actualizar")
      }
      await refetch()
      onChange?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al actualizar")
    } finally {
      setBusyId(null)
    }
  }

  // -------- Nueva variante --------

  const resetNewForm = () => {
    setNewForm({
      nombre: "",
      codigoVariante: "",
      barcode: "",
      stock: "0",
      precioCompra: "",
      precioVenta: "",
      atributos: [{ key: "", value: "" }],
    })
  }

  const submitNew = async () => {
    setError("")
    if (!newForm.nombre.trim() || !newForm.codigoVariante.trim()) {
      setError("Nombre y código son obligatorios")
      return
    }
    const stockNum = Number(newForm.stock)
    if (!Number.isFinite(stockNum) || stockNum < 0 || !Number.isInteger(stockNum)) {
      setError("Stock debe ser entero >= 0")
      return
    }

    const atributos: Record<string, string> = {}
    for (const a of newForm.atributos) {
      const k = a.key.trim()
      if (k) atributos[k] = a.value.trim()
    }

    setCreating(true)
    try {
      const body: Record<string, any> = {
        nombre: newForm.nombre.trim(),
        codigoVariante: newForm.codigoVariante.trim(),
        atributos,
        stock: stockNum,
      }
      if (newForm.barcode.trim()) body.barcode = newForm.barcode.trim()
      if (newForm.precioCompra) body.precioCompra = Number(newForm.precioCompra)
      if (newForm.precioVenta) body.precioVenta = Number(newForm.precioVenta)

      const res = await fetch(`/api/inventario/${inventarioId}/variantes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || "Error al crear")
      }
      resetNewForm()
      setShowNew(false)
      await refetch()
      onChange?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear variante")
    } finally {
      setCreating(false)
    }
  }

  // -------- Generador combinaciones --------

  const cartesianCombinations = useMemo(() => {
    const lists = genAttrs
      .map((a) => ({
        key: a.key.trim(),
        values: a.values
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
      }))
      .filter((a) => a.key && a.values.length > 0)

    if (lists.length === 0) return []

    const combos: Record<string, string>[] = [{}]
    for (const list of lists) {
      const next: Record<string, string>[] = []
      for (const combo of combos) {
        for (const val of list.values) {
          next.push({ ...combo, [list.key]: val })
        }
      }
      combos.length = 0
      combos.push(...next)
    }
    return combos
  }, [genAttrs])

  const existingCodes = useMemo(
    () => new Set(variantes.map((v) => v.codigoVariante.toLowerCase())),
    [variantes]
  )

  const generarVariantes = async () => {
    setError("")
    const items = cartesianCombinations.map((attrs) => {
      const parts = Object.values(attrs).map(String)
      const nombre = parts.join(" / ")
      const codigo = parts
        .map((p) => p.toUpperCase().replace(/\s+/g, "").slice(0, 10))
        .join("-")
      return { nombre, codigoVariante: codigo, atributos: attrs, stock: 0 }
    })

    // Filtrar conflictos
    const conflictos = items.filter((i) => existingCodes.has(i.codigoVariante.toLowerCase()))
    const validos = items.filter((i) => !existingCodes.has(i.codigoVariante.toLowerCase()))

    if (validos.length === 0) {
      setError("Todas las combinaciones ya existen")
      return
    }

    setGenerating(true)
    try {
      const res = await fetch(`/api/inventario/${inventarioId}/variantes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validos),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || "Error al generar")
      }
      const result = await res.json()
      setShowGenerator(false)
      setGenAttrs([{ key: "color", values: "" }, { key: "talle", values: "" }])
      await refetch()
      onChange?.()
      if (conflictos.length > 0) {
        setError(
          `Generadas ${result.count}. Saltadas ${conflictos.length} por código duplicado.`
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al generar variantes")
    } finally {
      setGenerating(false)
    }
  }

  // -------- Consolidar --------

  const handleConsolidate = async () => {
    setConsolidating(true)
    try {
      const res = await fetch(`/api/inventario/${inventarioId}/consolidar-variantes`, {
        method: "POST",
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || "Error al consolidar")
      }
      setConsolidateOpen(false)
      onChange?.()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al consolidar")
      setConsolidateOpen(false)
    } finally {
      setConsolidating(false)
    }
  }

  // -------- Eliminar --------

  const doDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const url = `/api/inventario/variantes/${deleteTarget.id}${forceDelete ? "?force=true" : ""}`
      const res = await fetch(url, { method: "DELETE" })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        if (j.code === "HAS_STOCK" && !forceDelete) {
          setForceDelete(true)
          throw new Error(j.error)
        }
        throw new Error(j.error || "Error al eliminar")
      }
      setDeleteTarget(null)
      setForceDelete(false)
      await refetch()
      onChange?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al eliminar")
    } finally {
      setDeleting(false)
    }
  }

  const totalStock = totals.stock
  const totalReservado = totals.stockReservado
  const parentStock = parent?.stock ?? 0
  const stockMatchParent = parent?.tieneVariantes ? totalStock === parentStock : true

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[calc(100vw-1rem)] sm:max-w-5xl max-h-[90dvh] overflow-hidden flex flex-col">
          <DialogHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <DialogTitle className="flex items-center gap-2">
                  <Layers className="h-4 w-4" />
                  Variantes
                </DialogTitle>
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {inventarioNombre}
                </p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuItem onClick={() => setShowGenerator(true)}>
                    <Sparkles className="h-3.5 w-3.5 mr-2" />
                    Generar combinaciones
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={refetch}>
                    <RefreshCw className="h-3.5 w-3.5 mr-2" />
                    Recargar
                  </DropdownMenuItem>
                  {variantes.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setConsolidateOpen(true)}
                      >
                        <AlertTriangle className="h-3.5 w-3.5 mr-2" />
                        Consolidar variantes
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </DialogHeader>

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span className="flex-1">{error}</span>
              <button onClick={() => setError("")} className="shrink-0">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Generador */}
          {showGenerator && (
            <div className="border rounded-md p-3 space-y-3 bg-muted/40">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5" />
                  Generar combinaciones
                </h4>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setShowGenerator(false)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Definí atributos (clave + valores separados por coma). Se generará el producto cartesiano.
              </p>
              <div className="space-y-2">
                {genAttrs.map((attr, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <Input
                      placeholder="atributo (ej: color)"
                      value={attr.key}
                      onChange={(e) => {
                        const next = [...genAttrs]
                        next[idx].key = e.target.value
                        setGenAttrs(next)
                      }}
                      className="w-40"
                    />
                    <Input
                      placeholder="rojo, azul, verde"
                      value={attr.values}
                      onChange={(e) => {
                        const next = [...genAttrs]
                        next[idx].values = e.target.value
                        setGenAttrs(next)
                      }}
                      className="flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setGenAttrs(genAttrs.filter((_, i) => i !== idx))}
                      disabled={genAttrs.length === 1}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setGenAttrs([...genAttrs, { key: "", values: "" }])}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Atributo
                </Button>
              </div>
              <div className="flex items-center justify-between pt-2 border-t">
                <span className="text-xs text-muted-foreground">
                  {cartesianCombinations.length} combinación{cartesianCombinations.length === 1 ? "" : "es"}
                </span>
                <Button
                  size="sm"
                  onClick={generarVariantes}
                  disabled={generating || cartesianCombinations.length === 0}
                >
                  {generating && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                  Generar {cartesianCombinations.length > 0 && `(${cartesianCombinations.length})`}
                </Button>
              </div>
            </div>
          )}

          {/* Formulario nueva variante */}
          {showNew && (
            <div className="border rounded-md p-3 space-y-3 bg-muted/40">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">Nueva variante</h4>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => {
                    setShowNew(false)
                    resetNewForm()
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Nombre *</Label>
                  <Input
                    value={newForm.nombre}
                    onChange={(e) => setNewForm({ ...newForm, nombre: e.target.value })}
                    placeholder="Rojo / M"
                    className="mt-1 h-8"
                  />
                </div>
                <div>
                  <Label className="text-xs">Código *</Label>
                  <Input
                    value={newForm.codigoVariante}
                    onChange={(e) =>
                      setNewForm({ ...newForm, codigoVariante: e.target.value })
                    }
                    placeholder="ROJ-M"
                    className="mt-1 h-8"
                  />
                </div>
                <div>
                  <Label className="text-xs">Barcode</Label>
                  <Input
                    value={newForm.barcode}
                    onChange={(e) => setNewForm({ ...newForm, barcode: e.target.value })}
                    placeholder="EAN/SKU"
                    className="mt-1 h-8"
                  />
                </div>
                <div>
                  <Label className="text-xs">Stock inicial</Label>
                  <Input
                    type="number"
                    min={0}
                    value={newForm.stock}
                    onChange={(e) => setNewForm({ ...newForm, stock: e.target.value })}
                    className="mt-1 h-8"
                  />
                </div>
                <div>
                  <Label className="text-xs">Precio compra</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={newForm.precioCompra}
                    onChange={(e) =>
                      setNewForm({ ...newForm, precioCompra: e.target.value })
                    }
                    placeholder={parent?.precioCompra?.toString() ?? ""}
                    className="mt-1 h-8"
                  />
                </div>
                <div>
                  <Label className="text-xs">Precio venta</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={newForm.precioVenta}
                    onChange={(e) =>
                      setNewForm({ ...newForm, precioVenta: e.target.value })
                    }
                    placeholder={parent?.precioVenta?.toString() ?? ""}
                    className="mt-1 h-8"
                  />
                </div>
              </div>

              <div>
                <Label className="text-xs">Atributos</Label>
                <div className="space-y-1.5 mt-1">
                  {newForm.atributos.map((attr, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <Input
                        placeholder="clave (color)"
                        value={attr.key}
                        onChange={(e) => {
                          const next = [...newForm.atributos]
                          next[idx].key = e.target.value
                          setNewForm({ ...newForm, atributos: next })
                        }}
                        className="h-7 text-xs w-36"
                      />
                      <Input
                        placeholder="valor (rojo)"
                        value={attr.value}
                        onChange={(e) => {
                          const next = [...newForm.atributos]
                          next[idx].value = e.target.value
                          setNewForm({ ...newForm, atributos: next })
                        }}
                        className="h-7 text-xs flex-1"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() =>
                          setNewForm({
                            ...newForm,
                            atributos: newForm.atributos.filter((_, i) => i !== idx),
                          })
                        }
                        disabled={newForm.atributos.length === 1}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() =>
                      setNewForm({
                        ...newForm,
                        atributos: [...newForm.atributos, { key: "", value: "" }],
                      })
                    }
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Atributo
                  </Button>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowNew(false)
                    resetNewForm()
                  }}
                  disabled={creating}
                >
                  Cancelar
                </Button>
                <Button size="sm" onClick={submitNew} disabled={creating}>
                  {creating && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                  Crear
                </Button>
              </div>
            </div>
          )}

          {/* Tabla de variantes */}
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              {variantes.length} variante{variantes.length === 1 ? "" : "s"}
            </div>
            <Button
              size="sm"
              onClick={() => setShowNew(true)}
              disabled={showNew}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Nueva variante
            </Button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : variantes.length === 0 ? (
            <div className="border-2 border-dashed rounded-lg py-12 text-center text-sm text-muted-foreground">
              Sin variantes. Creá la primera o usá el generador.
            </div>
          ) : (
            <div className="overflow-auto flex-1 -mx-6 px-6">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background border-b text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left py-2 px-2 font-medium">Nombre / Atributos</th>
                    <th className="text-left py-2 px-2 font-medium">Código</th>
                    <th className="text-left py-2 px-2 font-medium">Barcode</th>
                    <th className="text-right py-2 px-2 font-medium">Stock</th>
                    <th className="text-right py-2 px-2 font-medium">Precio venta</th>
                    <th className="text-center py-2 px-2 font-medium">Activo</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {variantes.map((v) => {
                    const busy = busyId === v.id
                    const stockEdited = edits[v.id]?.stockInput !== undefined
                    const nombreEdited = edits[v.id]?.nombre !== undefined
                    const barcodeEdited = edits[v.id]?.barcode !== undefined
                    const precioEdited = edits[v.id]?.precioVenta !== undefined
                    return (
                      <tr key={v.id} className="border-b hover:bg-muted/30">
                        <td className="py-2 px-2 align-top">
                          <div className="flex items-start gap-2">
                            {v.imagenUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={v.imagenUrl}
                                alt={v.nombre}
                                className="h-9 w-9 rounded object-cover border shrink-0"
                              />
                            ) : (
                              <div className="h-9 w-9 rounded bg-muted shrink-0 flex items-center justify-center text-[10px] text-muted-foreground">
                                {v.nombre.slice(0, 2).toUpperCase()}
                              </div>
                            )}
                            <div className="min-w-0 flex-1 space-y-1">
                              <Input
                                value={currentValue(v, "nombre")}
                                onChange={(e) => setEdit(v.id, { nombre: e.target.value })}
                                onBlur={() => nombreEdited && saveField(v, "nombre")}
                                className="h-7 text-sm"
                                disabled={busy}
                              />
                              {Object.keys(v.atributos).length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {Object.entries(v.atributos).map(([k, val]) => (
                                    <Badge
                                      key={k}
                                      variant="secondary"
                                      className="text-[10px] py-0 px-1.5 font-normal"
                                    >
                                      {k}: {String(val)}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-2 px-2 align-top">
                          <span className="font-mono text-xs">{v.codigoVariante}</span>
                        </td>
                        <td className="py-2 px-2 align-top">
                          <Input
                            value={currentValue(v, "barcode")}
                            onChange={(e) => setEdit(v.id, { barcode: e.target.value })}
                            onBlur={() => barcodeEdited && saveField(v, "barcode")}
                            className="h-7 text-xs font-mono w-28"
                            placeholder="—"
                            disabled={busy}
                          />
                        </td>
                        <td className="py-2 px-2 align-top text-right">
                          <Input
                            type="number"
                            min={0}
                            value={currentValue(v, "stockInput")}
                            onChange={(e) =>
                              setEdit(v.id, { stockInput: e.target.value })
                            }
                            onBlur={() => stockEdited && saveField(v, "stockInput")}
                            className="h-7 w-20 text-right ml-auto"
                            disabled={busy}
                          />
                          {v.stockReservado > 0 && (
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              {v.stockReservado} reservado
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-2 align-top text-right">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={currentValue(v, "precioVenta")}
                            onChange={(e) =>
                              setEdit(v.id, { precioVenta: e.target.value })
                            }
                            onBlur={() => precioEdited && saveField(v, "precioVenta")}
                            className="h-7 w-24 text-right ml-auto"
                            placeholder={parent?.precioVenta?.toString() ?? "0"}
                            disabled={busy}
                          />
                        </td>
                        <td className="py-2 px-2 align-top text-center">
                          <Switch
                            checked={v.activo}
                            onCheckedChange={() => toggleActivo(v)}
                            disabled={busy}
                          />
                        </td>
                        <td className="py-2 px-2 align-top">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => {
                              setDeleteTarget(v)
                              setForceDelete(false)
                            }}
                            disabled={busy}
                            title="Eliminar"
                          >
                            {busy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <DialogFooter className="flex-row items-center justify-between sm:justify-between gap-2 pt-2 border-t">
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <Badge variant="outline">
                Total variantes: <span className="font-mono ml-1">{totalStock}</span>
              </Badge>
              {parent?.tieneVariantes && (
                <Badge variant={stockMatchParent ? "outline" : "destructive"}>
                  Item: <span className="font-mono ml-1">{parentStock}</span>
                </Badge>
              )}
              {totalReservado > 0 && (
                <Badge variant="secondary">
                  Reservado: <span className="font-mono ml-1">{totalReservado}</span>
                </Badge>
              )}
            </div>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o) {
            setDeleteTarget(null)
            setForceDelete(false)
          }
        }}
        title="Eliminar variante"
        description={
          deleteTarget
            ? forceDelete
              ? `La variante "${deleteTarget.nombre}" tiene ${deleteTarget.stock} unidades en stock. Confirmá para eliminar de todos modos.`
              : `¿Eliminar la variante "${deleteTarget.nombre}"? Se puede recuperar luego con consolidar.`
            : ""
        }
        confirmText="Eliminar"
        variant="danger"
        loading={deleting}
        onConfirm={doDelete}
      />

      <ConfirmDialog
        open={consolidateOpen}
        onOpenChange={setConsolidateOpen}
        title="Consolidar variantes"
        description={`Se eliminarán ${variantes.length} variantes y sus stocks (${totalStock} unidades) se sumarán al item. Esta acción se puede revertir creando variantes nuevas.`}
        confirmText="Consolidar"
        variant="warning"
        loading={consolidating}
        onConfirm={handleConsolidate}
      />
    </>
  )
}
