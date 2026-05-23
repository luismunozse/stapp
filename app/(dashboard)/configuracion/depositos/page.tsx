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
import { ArrowLeft, Plus, Pencil, Trash2, Loader2, Warehouse, Star } from "lucide-react"

interface Deposito {
  id: string
  nombre: string
  codigo: string | null
  direccion: string | null
  notas: string | null
  principal: boolean
  activo: boolean
  createdAt: string
}

export default function DepositosPage() {
  const [depositos, setDepositos] = useState<Deposito[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Deposito | null>(null)
  const [archiveId, setArchiveId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [nombre, setNombre] = useState("")
  const [codigo, setCodigo] = useState("")
  const [direccion, setDireccion] = useState("")
  const [notas, setNotas] = useState("")
  const [principal, setPrincipal] = useState(false)
  const [activo, setActivo] = useState(true)
  const [error, setError] = useState("")

  const fetchDepositos = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/depositos?includeInactive=true")
      const json = await res.json()
      setDepositos(json.data || [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDepositos()
  }, [fetchDepositos])

  const openNew = () => {
    setEditing(null)
    setNombre("")
    setCodigo("")
    setDireccion("")
    setNotas("")
    setPrincipal(false)
    setActivo(true)
    setError("")
    setDialogOpen(true)
  }

  const openEdit = (d: Deposito) => {
    setEditing(d)
    setNombre(d.nombre)
    setCodigo(d.codigo || "")
    setDireccion(d.direccion || "")
    setNotas(d.notas || "")
    setPrincipal(d.principal)
    setActivo(d.activo)
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
        notas: notas.trim() || null,
        principal,
        ...(editing ? { activo } : {}),
      }
      const res = editing
        ? await fetch(`/api/depositos/${editing.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/depositos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || "Error al guardar")
      }
      setDialogOpen(false)
      fetchDepositos()
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
      const res = await fetch(`/api/depositos/${archiveId}`, { method: "DELETE" })
      if (!res.ok) {
        const d = await res.json()
        alert(d.error || "Error al archivar")
        return
      }
      setArchiveId(null)
      fetchDepositos()
    } finally {
      setSaving(false)
    }
  }

  const activos = depositos.filter((d) => d.activo)
  const inactivos = depositos.filter((d) => !d.activo)

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
              <Warehouse className="h-6 w-6" /> Depósitos
            </h1>
            <p className="text-sm text-muted-foreground">
              Sucursales o locales físicos donde guardás stock. El stock se transfiere entre ellos sin afectar el total.
            </p>
          </div>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4 mr-1" /> Nuevo
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-4">
          <DepositoList items={activos} onEdit={openEdit} onArchive={(id) => setArchiveId(id)} />
          {inactivos.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-muted-foreground">Archivados</CardTitle>
              </CardHeader>
              <CardContent>
                <DepositoList items={inactivos} onEdit={openEdit} onArchive={() => {}} muted />
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar depósito" : "Nuevo depósito"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-sm font-medium">Nombre</label>
              <Input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Ej: Sucursal Centro, Depósito Pilar"
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Código (opcional)</label>
                <Input
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                  placeholder="DEP-01"
                  className="mt-1"
                />
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
                  Solo uno puede ser principal. Es el default cuando una operación no especifica depósito.
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
                  <div className="text-sm font-medium">Activo</div>
                  <div className="text-xs text-muted-foreground">
                    Desactivado no aparece en selectores ni recibe nuevas transferencias.
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
        title="Archivar depósito"
        description="Sólo se puede archivar si no tiene stock. El historial de movimientos se preserva."
        confirmText="Archivar"
        cancelText="Cancelar"
        variant="danger"
        loading={saving}
        onConfirm={handleArchive}
      />
    </div>
  )
}

function DepositoList({
  items,
  onEdit,
  onArchive,
  muted,
}: {
  items: Deposito[]
  onEdit: (d: Deposito) => void
  onArchive: (id: string) => void
  muted?: boolean
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        Sin depósitos
      </p>
    )
  }
  return (
    <div className="space-y-2">
      {items.map((d) => (
        <div
          key={d.id}
          className={`flex items-center justify-between p-3 rounded-lg border ${muted ? "opacity-60" : ""}`}
        >
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <Warehouse className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium truncate">{d.nombre}</span>
                {d.principal && (
                  <Badge variant="outline" className="text-[10px] gap-1 border-amber-500/60 text-amber-600">
                    <Star className="h-2.5 w-2.5" /> Principal
                  </Badge>
                )}
                {d.codigo && (
                  <Badge variant="secondary" className="text-[10px]">{d.codigo}</Badge>
                )}
              </div>
              {(d.direccion || d.notas) && (
                <div className="text-xs text-muted-foreground truncate">
                  {[d.direccion, d.notas].filter(Boolean).join(" · ")}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="icon" onClick={() => onEdit(d)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            {!d.principal && d.activo && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onArchive(d.id)}
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
