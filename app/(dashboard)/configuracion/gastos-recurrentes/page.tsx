"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import {
  ArrowLeft, Plus, Pencil, Trash2, Loader2, Repeat, PlayCircle,
} from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"

interface Categoria {
  id: string
  nombre: string
  color: string | null
  tipo: "FIJO" | "VARIABLE"
}

interface Gasto {
  id: string
  categoriaGastoId: string | null
  categoria: Categoria | null
  concepto: string
  monto: number
  metodoPago: string
  frecuencia: "SEMANAL" | "MENSUAL" | "ANUAL"
  diaDelMes: number | null
  proximoVencimiento: string
  ultimoGenerado: string | null
  activo: boolean
  observaciones: string | null
}

const METODOS = [
  { value: "EFECTIVO", label: "Efectivo" },
  { value: "TRANSFERENCIA", label: "Transferencia" },
  { value: "TARJETA_DEBITO", label: "Tarjeta Débito" },
  { value: "TARJETA_CREDITO", label: "Tarjeta Crédito" },
  { value: "MERCADOPAGO", label: "MercadoPago" },
  { value: "OTRO", label: "Otro" },
]

const FRECUENCIAS = [
  { value: "SEMANAL", label: "Semanal" },
  { value: "MENSUAL", label: "Mensual" },
  { value: "ANUAL", label: "Anual" },
]

export default function GastosRecurrentesPage() {
  const { formatPrice, timezone } = useCurrency()
  const [gastos, setGastos] = useState<Gasto[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Gasto | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [materializing, setMaterializing] = useState(false)
  const [materializeMsg, setMaterializeMsg] = useState("")

  // form state
  const [categoriaId, setCategoriaId] = useState<string>("")
  const [concepto, setConcepto] = useState("")
  const [monto, setMonto] = useState("")
  const [metodoPago, setMetodoPago] = useState("EFECTIVO")
  const [frecuencia, setFrecuencia] = useState<"SEMANAL" | "MENSUAL" | "ANUAL">("MENSUAL")
  const [diaDelMes, setDiaDelMes] = useState<string>("1")
  const [proximoVencimiento, setProximoVencimiento] = useState("")
  const [observaciones, setObservaciones] = useState("")
  const [error, setError] = useState("")

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [gRes, cRes] = await Promise.all([
        fetch("/api/gastos-recurrentes").then((r) => r.json()),
        fetch("/api/categorias-gasto").then((r) => r.json()),
      ])
      setGastos(gRes.gastos || [])
      setCategorias(cRes.categorias || [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const openNew = () => {
    setEditing(null)
    setCategoriaId("")
    setConcepto("")
    setMonto("")
    setMetodoPago("EFECTIVO")
    setFrecuencia("MENSUAL")
    setDiaDelMes("1")
    setProximoVencimiento(new Date().toISOString().split("T")[0])
    setObservaciones("")
    setError("")
    setDialogOpen(true)
  }

  const openEdit = (g: Gasto) => {
    setEditing(g)
    setCategoriaId(g.categoriaGastoId || "")
    setConcepto(g.concepto)
    setMonto(g.monto.toString())
    setMetodoPago(g.metodoPago)
    setFrecuencia(g.frecuencia)
    setDiaDelMes(g.diaDelMes?.toString() || "1")
    setProximoVencimiento(g.proximoVencimiento)
    setObservaciones(g.observaciones || "")
    setError("")
    setDialogOpen(true)
  }

  const handleSave = async () => {
    setError("")
    const m = parseFloat(monto)
    if (!concepto.trim()) return setError("El concepto es requerido")
    if (!m || m <= 0) return setError("El monto debe ser mayor a 0")
    if (!proximoVencimiento) return setError("La próxima fecha es requerida")

    setSaving(true)
    try {
      const body = {
        categoriaGastoId: categoriaId || null,
        concepto: concepto.trim(),
        monto: m,
        metodoPago,
        frecuencia,
        diaDelMes: frecuencia === "MENSUAL" ? parseInt(diaDelMes) : null,
        proximoVencimiento,
        observaciones: observaciones.trim() || null,
      }
      const res = editing
        ? await fetch(`/api/gastos-recurrentes/${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/gastos-recurrentes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || "Error al guardar")
      }
      setDialogOpen(false)
      fetchAll()
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
      await fetch(`/api/gastos-recurrentes/${deleteId}`, { method: "DELETE" })
      setDeleteId(null)
      fetchAll()
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActivo = async (g: Gasto) => {
    await fetch(`/api/gastos-recurrentes/${g.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo: !g.activo }),
    })
    fetchAll()
  }

  const handleMaterializar = async () => {
    setMaterializing(true)
    setMaterializeMsg("")
    try {
      const res = await fetch("/api/gastos-recurrentes/materializar", { method: "POST" })
      const data = await res.json()
      if (res.ok) {
        if (data.generados === 0) {
          setMaterializeMsg("No hay gastos vencidos para generar")
        } else {
          setMaterializeMsg(`✓ Se generaron ${data.generados} gastos vencidos`)
        }
        fetchAll()
      } else {
        setMaterializeMsg(`Error: ${data.error}`)
      }
    } finally {
      setMaterializing(false)
      setTimeout(() => setMaterializeMsg(""), 5000)
    }
  }

  const hoy = new Date().toISOString().split("T")[0]
  const hayVencidos = gastos.some((g) => g.activo && g.proximoVencimiento <= hoy)

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
            <h1 className="text-2xl sm:text-3xl font-bold">Gastos Recurrentes</h1>
            <p className="text-sm text-muted-foreground">
              Plantillas de gastos que se repiten todos los meses (alquiler, sueldos, servicios).
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleMaterializar}
            disabled={materializing || !hayVencidos}
          >
            {materializing ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <PlayCircle className="h-4 w-4 mr-1" />
            )}
            Generar vencidos
          </Button>
          <Button onClick={openNew}>
            <Plus className="h-4 w-4 mr-1" /> Nuevo
          </Button>
        </div>
      </div>

      {materializeMsg && (
        <div className="text-sm bg-muted/50 border rounded-lg p-3">{materializeMsg}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : gastos.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground space-y-2">
            <Repeat className="h-10 w-10 mx-auto opacity-30" />
            <p>No hay gastos recurrentes configurados</p>
            <Button onClick={openNew} size="sm">
              <Plus className="h-4 w-4 mr-1" /> Crear el primero
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Configurados ({gastos.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {gastos.map((g) => {
                const vencido = g.activo && g.proximoVencimiento <= hoy
                return (
                  <div
                    key={g.id}
                    className={`flex items-center justify-between p-3 rounded-lg border ${
                      g.activo ? "" : "opacity-50"
                    } ${vencido ? "border-amber-400 bg-amber-50/50 dark:bg-amber-950/20" : ""}`}
                  >
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{g.concepto}</span>
                        {g.categoria && (
                          <Badge
                            variant="secondary"
                            className="text-xs"
                            style={
                              g.categoria.color
                                ? {
                                    backgroundColor: `${g.categoria.color}20`,
                                    color: g.categoria.color,
                                  }
                                : undefined
                            }
                          >
                            {g.categoria.nombre}
                          </Badge>
                        )}
                        {vencido && (
                          <Badge className="text-xs bg-amber-500">Vencido</Badge>
                        )}
                        {!g.activo && (
                          <Badge variant="outline" className="text-xs">Pausado</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatPrice(g.monto)} · {g.frecuencia.toLowerCase()}
                        {g.diaDelMes && g.frecuencia === "MENSUAL" && ` (día ${g.diaDelMes})`}
                        {" · próximo: "}
                        {new Date(g.proximoVencimiento + "T00:00:00").toLocaleDateString("es-AR", { timeZone: timezone })}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Switch
                        checked={g.activo}
                        onCheckedChange={() => handleToggleActivo(g)}
                        className="mr-1"
                      />
                      <Button variant="ghost" size="icon" onClick={() => openEdit(g)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteId(g.id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar gasto recurrente" : "Nuevo gasto recurrente"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-sm font-medium">Concepto</label>
              <Input
                value={concepto}
                onChange={(e) => setConcepto(e.target.value)}
                placeholder="Ej: Alquiler local"
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Monto</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  placeholder="0.00"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Método</label>
                <Select value={metodoPago} onValueChange={setMetodoPago}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {METODOS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Categoría</label>
              <Select value={categoriaId || "_none"} onValueChange={(v) => setCategoriaId(v === "_none" ? "" : v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Sin categoría" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Sin categoría</SelectItem>
                  {categorias.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Frecuencia</label>
                <Select value={frecuencia} onValueChange={(v) => setFrecuencia(v as any)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FRECUENCIAS.map((f) => (
                      <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {frecuencia === "MENSUAL" && (
                <div>
                  <label className="text-sm font-medium">Día del mes</label>
                  <Input
                    type="number"
                    min="1"
                    max="31"
                    value={diaDelMes}
                    onChange={(e) => setDiaDelMes(e.target.value)}
                    className="mt-1"
                  />
                </div>
              )}
            </div>
            <div>
              <label className="text-sm font-medium">Próximo vencimiento</label>
              <Input
                type="date"
                value={proximoVencimiento}
                onChange={(e) => setProximoVencimiento(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Observaciones (opcional)</label>
              <Textarea
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                rows={2}
                className="mt-1"
              />
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
        title="Eliminar gasto recurrente"
        description="Esto no afecta los movimientos ya generados, solo deja de generar nuevos."
        confirmText="Eliminar"
        cancelText="Cancelar"
        variant="danger"
        loading={saving}
        onConfirm={handleDelete}
      />
    </div>
  )
}
