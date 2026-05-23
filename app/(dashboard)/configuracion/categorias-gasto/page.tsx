"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { ArrowLeft, Plus, Pencil, Trash2, Loader2 } from "lucide-react"

interface Categoria {
  id: string
  nombre: string
  tipo: "FIJO" | "VARIABLE"
  afectaRentabilidad: boolean
  color: string | null
  icono: string | null
  activo: boolean
}

const COLORES = [
  "#ef4444", "#f59e0b", "#3b82f6", "#06b6d4", "#8b5cf6",
  "#10b981", "#14b8a6", "#f97316", "#ec4899", "#6366f1",
  "#64748b", "#94a3b8",
]

export default function CategoriasGastoPage() {
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Categoria | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // form state
  const [nombre, setNombre] = useState("")
  const [tipo, setTipo] = useState<"FIJO" | "VARIABLE">("VARIABLE")
  const [afectaRentabilidad, setAfectaRentabilidad] = useState(true)
  const [color, setColor] = useState<string>(COLORES[0])
  const [error, setError] = useState("")

  const fetchCategorias = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/categorias-gasto?incluirInactivas=true")
      const data = await res.json()
      setCategorias(data.categorias || [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchCategorias() }, [fetchCategorias])

  const openNew = () => {
    setEditing(null)
    setNombre("")
    setTipo("VARIABLE")
    setAfectaRentabilidad(true)
    setColor(COLORES[0])
    setError("")
    setDialogOpen(true)
  }

  const openEdit = (c: Categoria) => {
    setEditing(c)
    setNombre(c.nombre)
    setTipo(c.tipo)
    setAfectaRentabilidad(c.afectaRentabilidad)
    setColor(c.color || COLORES[0])
    setError("")
    setDialogOpen(true)
  }

  const handleSave = async () => {
    setError("")
    if (!nombre.trim()) {
      setError("El nombre es requerido")
      return
    }
    setSaving(true)
    try {
      const body = { nombre: nombre.trim(), tipo, afectaRentabilidad, color }
      const res = editing
        ? await fetch(`/api/categorias-gasto/${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/categorias-gasto", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || "Error al guardar")
      }
      setDialogOpen(false)
      fetchCategorias()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    setSaving(true)
    try {
      await fetch(`/api/categorias-gasto/${deleteId}`, { method: "DELETE" })
      setDeleteId(null)
      fetchCategorias()
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActivo = async (c: Categoria) => {
    await fetch(`/api/categorias-gasto/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo: !c.activo }),
    })
    fetchCategorias()
  }

  const fijas = categorias.filter((c) => c.tipo === "FIJO")
  const variables = categorias.filter((c) => c.tipo === "VARIABLE")

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Link href="/configuracion">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">Categorías de Gasto</h1>
            <p className="text-sm text-muted-foreground">
              Definí cómo querés clasificar tus gastos para el cálculo de ganancia neta.
            </p>
          </div>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4 mr-1" /> Nueva
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <CategoriaList
            title="Gastos fijos"
            description="Gastos recurrentes mensuales (alquiler, sueldos, servicios)"
            items={fijas}
            onEdit={openEdit}
            onDelete={(id) => setDeleteId(id)}
            onToggle={handleToggleActivo}
          />
          <CategoriaList
            title="Gastos variables"
            description="Gastos que dependen de la actividad (insumos, mantenimiento)"
            items={variables}
            onEdit={openEdit}
            onDelete={(id) => setDeleteId(id)}
            onToggle={handleToggleActivo}
          />
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar categoría" : "Nueva categoría"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium">Nombre</label>
              <Input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Ej: Alquiler, Insumos, etc."
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Tipo</label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as any)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="FIJO">Fijo (mensual recurrente)</SelectItem>
                  <SelectItem value="VARIABLE">Variable (depende de la actividad)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Color</label>
              <div className="flex flex-wrap gap-2 mt-1">
                {COLORES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`w-7 h-7 rounded-full border-2 ${
                      color === c ? "border-foreground scale-110" : "border-transparent"
                    } transition-all`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <div className="text-sm font-medium">Afecta el resultado</div>
                <div className="text-xs text-muted-foreground">
                  Si lo desactivás, los movimientos no se restan de la ganancia neta
                  (ej: retiro del dueño, transferencias internas).
                </div>
              </div>
              <Switch checked={afectaRentabilidad} onCheckedChange={setAfectaRentabilidad} />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title="Eliminar categoría"
        description="La categoría se desactivará. Los movimientos existentes mantendrán su referencia."
        confirmText="Eliminar"
        cancelText="Cancelar"
        variant="danger"
        loading={saving}
        onConfirm={handleDelete}
      />
    </div>
  )
}

function CategoriaList({
  title,
  description,
  items,
  onEdit,
  onDelete,
  onToggle,
}: {
  title: string
  description: string
  items: Categoria[]
  onEdit: (c: Categoria) => void
  onDelete: (id: string) => void
  onToggle: (c: Categoria) => void
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Sin categorías
          </p>
        ) : (
          <div className="space-y-1">
            {items.map((c) => (
              <div
                key={c.id}
                className={`flex items-center justify-between p-2 rounded-lg border ${
                  c.activo ? "" : "opacity-50"
                }`}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {c.color && (
                    <span
                      className="inline-block w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: c.color }}
                    />
                  )}
                  <span className="text-sm font-medium truncate">{c.nombre}</span>
                  {!c.afectaRentabilidad && (
                    <Badge variant="outline" className="text-xs">No afecta</Badge>
                  )}
                  {!c.activo && (
                    <Badge variant="secondary" className="text-xs">Inactiva</Badge>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Switch
                    checked={c.activo}
                    onCheckedChange={() => onToggle(c)}
                    className="mr-1"
                  />
                  <Button variant="ghost" size="icon" onClick={() => onEdit(c)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onDelete(c.id)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
