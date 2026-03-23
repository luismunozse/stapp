"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Newspaper,
  Plus,
  Eye,
  EyeOff,
  Trash2,
  Sparkles,
  Zap,
  Wrench,
  RefreshCw,
  Loader2,
  Star,
} from "lucide-react"
import { useSuperadminFetch, useSuperadminMutation } from "@/hooks/use-superadmin-fetch"

interface ChangelogEntry {
  id: string
  titulo: string
  descripcion: string
  tipo: string
  importante: boolean
  publicado: boolean
  fecha_publicacion: string | null
  created_at: string
}

const tipoConfig: Record<string, { icon: typeof Sparkles; label: string; color: string }> = {
  NUEVA_FUNCION: { icon: Sparkles, label: "Nueva funcion", color: "text-blue-600" },
  MEJORA: { icon: Zap, label: "Mejora", color: "text-amber-600" },
  CORRECCION: { icon: Wrench, label: "Correccion", color: "text-green-600" },
}

export function ChangelogContent() {
  const { data, loading, fetchData } = useSuperadminFetch<ChangelogEntry[]>({ showErrorToast: true })
  const { mutate, loading: mutating } = useSuperadminMutation()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ titulo: "", descripcion: "", tipo: "MEJORA", importante: false })

  const loadData = useCallback(async () => {
    await fetchData("/api/superadmin/changelog")
  }, [fetchData])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleCreate = async () => {
    if (!form.titulo || !form.descripcion) return
    await mutate("/api/superadmin/changelog", {
      method: "POST",
      body: form,
      successMessage: "Entrada creada",
      onSuccess: () => {
        setForm({ titulo: "", descripcion: "", tipo: "MEJORA", importante: false })
        setShowForm(false)
        loadData()
      },
    })
  }

  const handleTogglePublish = async (entry: ChangelogEntry) => {
    await mutate("/api/superadmin/changelog", {
      method: "PATCH",
      body: { id: entry.id, publicado: !entry.publicado },
      successMessage: entry.publicado ? "Despublicado" : "Publicado",
      onSuccess: loadData,
    })
  }

  const handleDelete = async (id: string) => {
    await mutate(`/api/superadmin/changelog?id=${id}`, {
      method: "DELETE",
      successMessage: "Eliminado",
      onSuccess: loadData,
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Changelog</h1>
          <p className="text-muted-foreground">Gestiona las novedades que ven los usuarios</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Actualizar
          </Button>
          <Button size="sm" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Nueva entrada
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Total entradas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data?.length || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Publicadas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{data?.filter(e => e.publicado).length || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Borradores</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{data?.filter(e => !e.publicado).length || 0}</div>
          </CardContent>
        </Card>
      </div>

      {/* List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Newspaper className="h-5 w-5" />
            Entradas del Changelog
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {loading && !data ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />
              ))
            ) : data && data.length > 0 ? (
              data.map(entry => {
                const config = tipoConfig[entry.tipo] || tipoConfig.MEJORA
                const Icon = config.icon
                return (
                  <div key={entry.id} className="flex items-start justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${config.color}`} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium">{entry.titulo}</p>
                          {entry.importante && (
                            <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
                          )}
                          <Badge variant={entry.publicado ? "default" : "secondary"}>
                            {entry.publicado ? "Publicado" : "Borrador"}
                          </Badge>
                          <Badge variant="outline">{config.label}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">{entry.descripcion}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {entry.fecha_publicacion
                            ? `Publicado: ${new Date(entry.fecha_publicacion).toLocaleDateString("es-AR")}`
                            : `Creado: ${new Date(entry.created_at).toLocaleDateString("es-AR")}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-4">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleTogglePublish(entry)}
                        disabled={mutating}
                        title={entry.publicado ? "Despublicar" : "Publicar"}
                      >
                        {entry.publicado ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(entry.id)}
                        disabled={mutating}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )
              })
            ) : (
              <p className="text-center text-muted-foreground py-8">
                No hay entradas en el changelog. Crea una para comunicar novedades a tus usuarios.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva entrada de changelog</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Titulo</Label>
              <Input
                placeholder="Ej: Nueva funcion de reportes"
                value={form.titulo}
                onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Descripcion</Label>
              <Textarea
                placeholder="Describe la novedad..."
                value={form.descripcion}
                onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select value={form.tipo} onValueChange={v => setForm(f => ({ ...f, tipo: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NUEVA_FUNCION">Nueva funcion</SelectItem>
                    <SelectItem value="MEJORA">Mejora</SelectItem>
                    <SelectItem value="CORRECCION">Correccion</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Importante</Label>
                <Select value={form.importante ? "si" : "no"} onValueChange={v => setForm(f => ({ ...f, importante: v === "si" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="no">No</SelectItem>
                    <SelectItem value="si">Si - Destacado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={mutating || !form.titulo || !form.descripcion}>
              {mutating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Crear entrada
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
