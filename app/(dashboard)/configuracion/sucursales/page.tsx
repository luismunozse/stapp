"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { ArrowLeft, Plus, Pencil, Trash2, Loader2, Store, Star } from "lucide-react"

interface Sucursal {
  id: string
  nombre: string
  codigo: string | null
  direccion: string | null
  telefono: string | null
  notas: string | null
  principal: boolean
  activo: boolean
  createdAt: string
}

export default function SucursalesPage() {
  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Sucursal | null>(null)
  const [archiveId, setArchiveId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [nombre, setNombre] = useState("")
  const [codigo, setCodigo] = useState("")
  const [direccion, setDireccion] = useState("")
  const [telefono, setTelefono] = useState("")
  const [notas, setNotas] = useState("")
  const [principal, setPrincipal] = useState(false)
  const [activo, setActivo] = useState(true)
  const [error, setError] = useState("")

  const fetchSucursales = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/sucursales?includeInactive=true")
      const json = await res.json()
      setSucursales(json.data || [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSucursales()
  }, [fetchSucursales])

  const openNew = () => {
    setEditing(null)
    setNombre("")
    setCodigo("")
    setDireccion("")
    setTelefono("")
    setNotas("")
    setPrincipal(false)
    setActivo(true)
    setError("")
    setDialogOpen(true)
  }

  const openEdit = (s: Sucursal) => {
    setEditing(s)
    setNombre(s.nombre)
    setCodigo(s.codigo || "")
    setDireccion(s.direccion || "")
    setTelefono(s.telefono || "")
    setNotas(s.notas || "")
    setPrincipal(s.principal)
    setActivo(s.activo)
    setError("")
    setDialogOpen(true)
  }

  const handleSave = async () => {
    setError("")
    if (!nombre.trim()) {
      setError("Nombre requerido")
      return
    }
    setSaving(true)
    try {
      const body = {
        nombre: nombre.trim(),
        codigo: codigo.trim() || null,
        direccion: direccion.trim() || null,
        telefono: telefono.trim() || null,
        notas: notas.trim() || null,
        principal,
        ...(editing ? { activo } : {}),
      }
      const res = editing
        ? await fetch(`/api/sucursales/${editing.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/sucursales", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
      if (!res.ok) {
        const d = await res.json()
        // Gate de plan: el mensaje del backend ya trae el CTA ("Subí a Pro...").
        throw new Error(d.error || "Error al guardar")
      }
      setDialogOpen(false)
      fetchSucursales()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar")
    } finally {
      setSaving(false)
    }
  }

  const handleArchive = async () => {
    if (!archiveId) return
    setSaving(true)
    try {
      const res = await fetch(`/api/sucursales/${archiveId}`, { method: "DELETE" })
      if (!res.ok) {
        const d = await res.json()
        // HAS_DATA (409): sugiere desactivar en vez de archivar.
        alert(d.error || "Error al archivar")
        return
      }
      setArchiveId(null)
      fetchSucursales()
    } finally {
      setSaving(false)
    }
  }

  const activos = sucursales.filter((s) => s.activo)
  const inactivos = sucursales.filter((s) => !s.activo)

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
            <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
              <Store className="h-6 w-6" /> Sucursales
            </h1>
            <p className="text-sm text-muted-foreground">
              Locales físicos de tu negocio. Órdenes, ventas y caja se separan por sucursal; el personal se asigna a una.
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
        <div className="space-y-4">
          <SucursalList items={activos} onEdit={openEdit} onArchive={(id) => setArchiveId(id)} />
          {inactivos.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-muted-foreground">Archivadas</CardTitle>
              </CardHeader>
              <CardContent>
                <SucursalList items={inactivos} onEdit={openEdit} onArchive={() => {}} muted />
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar sucursal" : "Nueva sucursal"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-sm font-medium">Nombre</label>
              <Input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Ej: Casa Central, Sucursal Norte"
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Código (opcional)</label>
                <Input
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                  placeholder="CENTRO"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Teléfono (opcional)</label>
                <Input
                  value={telefono}
                  onChange={(e) => setTelefono(e.target.value)}
                  placeholder="+54 11 5555-5555"
                  className="mt-1"
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Dirección (opcional)</label>
              <Input
                value={direccion}
                onChange={(e) => setDireccion(e.target.value)}
                placeholder="Av. Siempre Viva 742"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Notas (opcional)</label>
              <Input
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                placeholder="Horarios, encargado, etc."
                className="mt-1"
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <div className="text-sm font-medium flex items-center gap-1.5">
                  <Star className="h-3.5 w-3.5 text-amber-500" />
                  Principal
                </div>
                <div className="text-xs text-muted-foreground">
                  Solo una puede ser principal. Es el default cuando una operación no especifica sucursal.
                </div>
              </div>
              <Switch
                checked={principal}
                onCheckedChange={setPrincipal}
                disabled={!!editing && editing.principal}
              />
            </div>
            {editing && !editing.principal && (
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <div className="text-sm font-medium">Activa</div>
                  <div className="text-xs text-muted-foreground">
                    Desactivada no aparece en selectores ni recibe nuevas operaciones.
                  </div>
                </div>
                <Switch checked={activo} onCheckedChange={setActivo} />
              </div>
            )}
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
        open={!!archiveId}
        onOpenChange={(o) => !o && setArchiveId(null)}
        title="Archivar sucursal"
        description="Sólo se puede archivar si no tiene órdenes ni personal asignado. Si los tiene, desactivala en su lugar."
        confirmText="Archivar"
        cancelText="Cancelar"
        variant="danger"
        loading={saving}
        onConfirm={handleArchive}
      />
    </div>
  )
}

function SucursalList({
  items,
  onEdit,
  onArchive,
  muted,
}: {
  items: Sucursal[]
  onEdit: (s: Sucursal) => void
  onArchive: (id: string) => void
  muted?: boolean
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        Sin sucursales
      </p>
    )
  }
  return (
    <div className="space-y-2">
      {items.map((s) => (
        <div
          key={s.id}
          className={`flex items-center justify-between p-3 rounded-lg border ${muted ? "opacity-60" : ""}`}
        >
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <Store className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium truncate">{s.nombre}</span>
                {s.principal && (
                  <Badge variant="outline" className="text-[10px] gap-1 border-amber-500/60 text-amber-600">
                    <Star className="h-2.5 w-2.5" /> Principal
                  </Badge>
                )}
                {s.codigo && (
                  <Badge variant="secondary" className="text-[10px]">{s.codigo}</Badge>
                )}
              </div>
              {(s.direccion || s.telefono || s.notas) && (
                <div className="text-xs text-muted-foreground truncate">
                  {[s.direccion, s.telefono, s.notas].filter(Boolean).join(" · ")}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="icon" onClick={() => onEdit(s)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            {!s.principal && s.activo && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onArchive(s.id)}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
