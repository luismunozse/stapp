"use client"

import { useState } from "react"
import useSWR from "swr"
import { toast } from "sonner"
import {
  Phone, Mail, MessageCircle, Star, Trash2, Edit, Plus, Save, X, User,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { EmptyState } from "@/components/ui/empty-state"

interface Contacto {
  id: string
  nombre: string
  cargo: string | null
  telefono: string | null
  whatsapp: string | null
  email: string | null
  notas: string | null
  principal: boolean
}

interface Draft {
  nombre: string
  cargo: string
  telefono: string
  whatsapp: string
  email: string
  notas: string
  principal: boolean
}

const empty: Draft = {
  nombre: "", cargo: "", telefono: "", whatsapp: "", email: "", notas: "", principal: false,
}

const fetcher = (url: string) => fetch(url).then(r => r.json())

export function ProveedorContactosTab({ proveedorId }: { proveedorId: string }) {
  const { data: contactos = [], mutate } = useSWR<Contacto[]>(
    `/api/proveedores/${proveedorId}/contactos`,
    fetcher,
    { revalidateOnFocus: false }
  )

  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<Draft>(empty)
  const [saving, setSaving] = useState(false)

  const startAdd = () => {
    setAdding(true)
    setEditingId(null)
    setDraft({ ...empty, principal: contactos.length === 0 })
  }

  const startEdit = (c: Contacto) => {
    setAdding(false)
    setEditingId(c.id)
    setDraft({
      nombre: c.nombre,
      cargo: c.cargo || "",
      telefono: c.telefono || "",
      whatsapp: c.whatsapp || "",
      email: c.email || "",
      notas: c.notas || "",
      principal: c.principal,
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
      const url = editingId
        ? `/api/proveedores/${proveedorId}/contactos/${editingId}`
        : `/api/proveedores/${proveedorId}/contactos`
      const method = editingId ? "PUT" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || "Error al guardar")
        return
      }
      toast.success(editingId ? "Contacto actualizado" : "Contacto agregado")
      cancel()
      mutate()
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    if (!confirm("¿Eliminar este contacto?")) return
    const res = await fetch(`/api/proveedores/${proveedorId}/contactos/${id}`, { method: "DELETE" })
    if (res.ok) {
      toast.success("Contacto eliminado")
      mutate()
    }
  }

  const togglePrincipal = async (c: Contacto) => {
    await fetch(`/api/proveedores/${proveedorId}/contactos/${c.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ principal: !c.principal }),
    })
    mutate()
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <div className="text-sm text-muted-foreground">{contactos.length} contacto{contactos.length === 1 ? "" : "s"}</div>
        <Button size="sm" onClick={startAdd}>
          <Plus className="h-4 w-4 mr-1" />Nuevo contacto
        </Button>
      </div>

      {(adding || editingId) && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Nombre *</Label>
                <Input value={draft.nombre} onChange={(e) => setDraft({ ...draft, nombre: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Cargo</Label>
                <Input value={draft.cargo} onChange={(e) => setDraft({ ...draft, cargo: e.target.value })} placeholder="Ej: Ventas, Cobranzas" />
              </div>
              <div className="space-y-1">
                <Label>Teléfono</Label>
                <Input value={draft.telefono} onChange={(e) => setDraft({ ...draft, telefono: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>WhatsApp (sin +)</Label>
                <Input
                  inputMode="numeric"
                  value={draft.whatsapp}
                  onChange={(e) => setDraft({ ...draft, whatsapp: e.target.value.replace(/\D/g, "") })}
                  placeholder="5491112345678"
                />
                <p className="text-[10px] text-muted-foreground">Sólo dígitos (10-15).</p>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Email</Label>
                <Input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Notas</Label>
                <Textarea
                  rows={2}
                  value={draft.notas}
                  onChange={(e) => setDraft({ ...draft, notas: e.target.value })}
                  placeholder="Horarios, observaciones..."
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={draft.principal} onCheckedChange={(v) => setDraft({ ...draft, principal: v })} id="principal" />
              <Label htmlFor="principal" className="cursor-pointer text-sm">Contacto principal</Label>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={cancel}>
                <X className="h-4 w-4 mr-1" />Cancelar
              </Button>
              <Button size="sm" onClick={save} disabled={saving}>
                <Save className="h-4 w-4 mr-1" />Guardar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {contactos.length === 0 && !adding && (
        <EmptyState
          icon={User}
          title="Sin contactos"
          description="Agregá un contacto para tener referencias rápidas."
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {contactos.map((c) => (
          <Card key={c.id} className={c.principal ? "border-primary/40" : ""}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold text-sm truncate">{c.nombre}</span>
                    {c.principal && (
                      <Badge variant="default" className="text-[10px] gap-1">
                        <Star className="h-2.5 w-2.5 fill-current" /> Principal
                      </Badge>
                    )}
                  </div>
                  {c.cargo && <div className="text-xs text-muted-foreground ml-6">{c.cargo}</div>}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => togglePrincipal(c)} title={c.principal ? "Quitar como principal" : "Marcar principal"}>
                    <Star className={`h-3.5 w-3.5 ${c.principal ? "fill-yellow-400 text-yellow-400" : ""}`} />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(c)}>
                    <Edit className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(c.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs pl-6">
                {c.telefono && (
                  <a href={`tel:${c.telefono}`} className="flex items-center gap-1 hover:text-primary">
                    <Phone className="h-3 w-3 text-muted-foreground" />
                    {c.telefono}
                  </a>
                )}
                {c.whatsapp && (
                  <a href={`https://wa.me/${c.whatsapp}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-green-600 hover:text-green-700">
                    <MessageCircle className="h-3 w-3" />
                    WhatsApp
                  </a>
                )}
                {c.email && (
                  <a href={`mailto:${c.email}`} className="flex items-center gap-1 hover:text-primary min-w-0">
                    <Mail className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="truncate">{c.email}</span>
                  </a>
                )}
              </div>
              {c.notas && <p className="text-xs text-muted-foreground pl-6 whitespace-pre-wrap">{c.notas}</p>}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
