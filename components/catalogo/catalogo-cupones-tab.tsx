"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { EmptyState } from "@/components/ui/empty-state"
import {
  Plus, Loader2, Pencil, Trash2, Copy, Ticket, Percent, DollarSign, Calendar, Users,
} from "lucide-react"
import { toast } from "sonner"
import { useCurrency } from "@/contexts/currency-context"

interface Cupon {
  id: string
  codigo: string
  descripcion: string | null
  tipo: "porcentaje" | "monto"
  valor: number
  min_compra: number | null
  max_usos: number | null
  usos_actuales: number
  fecha_inicio: string | null
  fecha_fin: string | null
  activo: boolean
  created_at: string
}

export function CatalogoCuponesTab() {
  const { timezone } = useCurrency()
  const [cupones, setCupones] = useState<Cupon[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Cupon | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/catalogo/cupones")
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCupones(data.cupones ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error cargando cupones")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleDelete = async () => {
    if (!deleteId) return
    const res = await fetch(`/api/catalogo/cupones/${deleteId}`, { method: "DELETE" })
    if (res.ok) {
      toast.success("Cupón eliminado")
      setCupones((prev) => prev.filter((c) => c.id !== deleteId))
    } else {
      toast.error("Error al eliminar")
    }
    setDeleteId(null)
  }

  const toggleActivo = async (cupon: Cupon) => {
    const next = !cupon.activo
    setCupones((prev) => prev.map((c) => (c.id === cupon.id ? { ...c, activo: next } : c)))
    try {
      const res = await fetch(`/api/catalogo/cupones/${cupon.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: next }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setCupones((prev) => prev.map((c) => (c.id === cupon.id ? { ...c, activo: !next } : c)))
      toast.error("Error al actualizar")
    }
  }

  const copyCode = async (codigo: string) => {
    await navigator.clipboard.writeText(codigo)
    toast.success("Código copiado")
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            Cupones de descuento que tus clientes aplican en el checkout del catálogo.
          </p>
        </div>
        <Button onClick={() => setCreating(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Nuevo cupón
        </Button>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[...Array(3)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4 space-y-2">
                <div className="h-5 bg-muted rounded w-1/3" />
                <div className="h-3 bg-muted rounded w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : cupones.length === 0 ? (
        <EmptyState
          icon={Ticket}
          title="Sin cupones"
          description="Creá descuentos para aumentar conversión."
          action={{ label: "Crear cupón", onClick: () => setCreating(true) }}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {cupones.map((c) => {
            const vencido = c.fecha_fin && new Date(c.fecha_fin) < new Date()
            const agotado = c.max_usos != null && c.usos_actuales >= c.max_usos
            const disabled = !c.activo || vencido || agotado
            return (
              <Card key={c.id} className={`overflow-hidden ${disabled ? "opacity-60" : ""}`}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <button
                        onClick={() => copyCode(c.codigo)}
                        className="inline-flex items-center gap-1.5 font-mono font-bold text-lg hover:text-primary transition-colors"
                      >
                        {c.codigo}
                        <Copy className="h-3.5 w-3.5 opacity-50" />
                      </button>
                      {c.descripcion && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{c.descripcion}</p>
                      )}
                    </div>
                    <Switch checked={c.activo} onCheckedChange={() => toggleActivo(c)} />
                  </div>

                  <div className="flex items-center gap-2 text-sm">
                    {c.tipo === "porcentaje" ? (
                      <Badge variant="default" className="gap-1">
                        <Percent className="h-3 w-3" />
                        {Number(c.valor)}% OFF
                      </Badge>
                    ) : (
                      <Badge variant="default" className="gap-1">
                        <DollarSign className="h-3 w-3" />
                        ${Number(c.valor).toLocaleString("es-AR")} OFF
                      </Badge>
                    )}
                    {vencido && <Badge variant="destructive">Vencido</Badge>}
                    {agotado && <Badge variant="destructive">Agotado</Badge>}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    {c.min_compra != null && (
                      <div className="flex items-center gap-1">
                        <DollarSign className="h-3 w-3" />
                        Min: ${Number(c.min_compra).toLocaleString("es-AR")}
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {c.usos_actuales}{c.max_usos != null ? `/${c.max_usos}` : ""} usos
                    </div>
                    {(c.fecha_inicio || c.fecha_fin) && (
                      <div className="flex items-center gap-1 col-span-2">
                        <Calendar className="h-3 w-3" />
                        {c.fecha_inicio ? new Date(c.fecha_inicio).toLocaleDateString("es-AR", { timeZone: timezone }) : "—"}
                        {" → "}
                        {c.fecha_fin ? new Date(c.fecha_fin).toLocaleDateString("es-AR", { timeZone: timezone }) : "sin fin"}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-1 pt-2 border-t">
                    <Button variant="outline" size="sm" className="flex-1 gap-1" onClick={() => setEditing(c)}>
                      <Pencil className="h-3 w-3" />
                      Editar
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setDeleteId(c.id)}>
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {(creating || editing) && (
        <CuponDialog
          cupon={editing}
          open={creating || !!editing}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={() => { load(); setCreating(false); setEditing(null) }}
        />
      )}

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Eliminar cupón"
        description="Las cotizaciones con este cupón mantendrán el descuento ya aplicado."
        confirmText="Eliminar"
        variant="danger"
        onConfirm={handleDelete}
      />
    </div>
  )
}

function CuponDialog({
  cupon,
  open,
  onClose,
  onSaved,
}: {
  cupon: Cupon | null
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [codigo, setCodigo] = useState("")
  const [descripcion, setDescripcion] = useState("")
  const [tipo, setTipo] = useState<"porcentaje" | "monto">("porcentaje")
  const [valor, setValor] = useState("")
  const [minCompra, setMinCompra] = useState("")
  const [maxUsos, setMaxUsos] = useState("")
  const [fechaInicio, setFechaInicio] = useState("")
  const [fechaFin, setFechaFin] = useState("")
  const [activo, setActivo] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (cupon) {
      setCodigo(cupon.codigo)
      setDescripcion(cupon.descripcion ?? "")
      setTipo(cupon.tipo)
      setValor(String(cupon.valor))
      setMinCompra(cupon.min_compra != null ? String(cupon.min_compra) : "")
      setMaxUsos(cupon.max_usos != null ? String(cupon.max_usos) : "")
      setFechaInicio(cupon.fecha_inicio ? cupon.fecha_inicio.slice(0, 10) : "")
      setFechaFin(cupon.fecha_fin ? cupon.fecha_fin.slice(0, 10) : "")
      setActivo(cupon.activo)
    } else {
      setCodigo("")
      setDescripcion("")
      setTipo("porcentaje")
      setValor("")
      setMinCompra("")
      setMaxUsos("")
      setFechaInicio("")
      setFechaFin("")
      setActivo(true)
    }
  }, [cupon, open])

  const save = async () => {
    const codigoNorm = codigo.trim().toUpperCase()
    if (!/^[A-Z0-9_-]{3,32}$/.test(codigoNorm)) {
      toast.error("Código: 3-32 caracteres, solo A-Z, 0-9, guion y guion bajo")
      return
    }
    const valorNum = Number(valor)
    if (!valorNum || valorNum <= 0) {
      toast.error("Valor inválido")
      return
    }
    if (tipo === "porcentaje" && valorNum > 100) {
      toast.error("Porcentaje no puede superar 100")
      return
    }

    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        descripcion: descripcion.trim() || null,
        tipo,
        valor: valorNum,
        min_compra: minCompra ? Number(minCompra) : null,
        max_usos: maxUsos ? Number(maxUsos) : null,
        fecha_inicio: fechaInicio ? new Date(fechaInicio).toISOString() : null,
        fecha_fin: fechaFin ? new Date(fechaFin + "T23:59:59").toISOString() : null,
        activo,
      }
      let res: Response
      if (cupon) {
        res = await fetch(`/api/catalogo/cupones/${cupon.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      } else {
        res = await fetch("/api/catalogo/cupones", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, codigo: codigoNorm }),
        })
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Error al guardar")
      toast.success(cupon ? "Cupón actualizado" : "Cupón creado")
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{cupon ? "Editar cupón" : "Nuevo cupón"}</DialogTitle>
          <DialogDescription>
            Los clientes ingresan este código en el checkout del catálogo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="codigo">Código *</Label>
            <Input
              id="codigo"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))}
              maxLength={32}
              disabled={!!cupon}
              placeholder="VERANO25"
              className="font-mono uppercase"
            />
            {!cupon && (
              <p className="text-xs text-muted-foreground mt-1">3-32 caracteres. No se puede cambiar después.</p>
            )}
          </div>

          <div>
            <Label htmlFor="desc">Descripción (opcional)</Label>
            <Input
              id="desc"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              maxLength={280}
              placeholder="Promo verano"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="tipo">Tipo *</Label>
              <select
                id="tipo"
                value={tipo}
                onChange={(e) => setTipo(e.target.value as "porcentaje" | "monto")}
                className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="porcentaje">Porcentaje (%)</option>
                <option value="monto">Monto fijo ($)</option>
              </select>
            </div>
            <div>
              <Label htmlFor="valor">Valor *</Label>
              <Input
                id="valor"
                type="number"
                min="0"
                step={tipo === "porcentaje" ? "1" : "0.01"}
                max={tipo === "porcentaje" ? 100 : undefined}
                value={valor}
                onChange={(e) => setValor(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="min">Compra mínima ($)</Label>
              <Input
                id="min"
                type="number"
                min="0"
                step="0.01"
                value={minCompra}
                onChange={(e) => setMinCompra(e.target.value)}
                placeholder="Opcional"
              />
            </div>
            <div>
              <Label htmlFor="max">Usos máximos</Label>
              <Input
                id="max"
                type="number"
                min="1"
                step="1"
                value={maxUsos}
                onChange={(e) => setMaxUsos(e.target.value)}
                placeholder="Sin límite"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ini">Vigencia desde</Label>
              <Input id="ini" type="date" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="fin">Vigencia hasta</Label>
              <Input id="fin" type="date" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <Label htmlFor="act" className="cursor-pointer">Activo</Label>
            <Switch id="act" checked={activo} onCheckedChange={setActivo} />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving} className="gap-1.5">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
