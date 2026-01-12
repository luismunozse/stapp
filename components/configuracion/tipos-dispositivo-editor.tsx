"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Smartphone,
  Plus,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronUp,
  Power,
  PowerOff,
} from "lucide-react"
import { useModal } from "@/contexts/modal-context"
import type { TipoDispositivoCustom } from "@/types"

export function TiposDispositivoEditor() {
  const { confirm } = useModal()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [tipos, setTipos] = useState<TipoDispositivoCustom[]>([])
  const [showForm, setShowForm] = useState(false)

  // Form state
  const [codigo, setCodigo] = useState("")
  const [nombre, setNombre] = useState("")
  const [prefijoOrden, setPrefijoOrden] = useState("")

  const fetchTipos = async () => {
    try {
      const res = await fetch("/api/tipos-dispositivo?soloActivos=false&incluirTodos=true")
      if (!res.ok) throw new Error("Error fetching tipos")
      const data = await res.json()
      setTipos(data)
    } catch (error) {
      console.error("Error:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTipos()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!codigo.trim() || !nombre.trim() || !prefijoOrden.trim()) return

    setSaving(true)
    try {
      const res = await fetch("/api/tipos-dispositivo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          codigo: codigo.toUpperCase().replace(/\s+/g, "_"),
          nombre,
          prefijoOrden: prefijoOrden.toUpperCase(),
        }),
      })

      if (!res.ok) {
        const error = await res.json()
        alert(error.error || "Error al crear tipo")
        return
      }

      const nuevoTipo = await res.json()
      setTipos((prev) => [...prev, nuevoTipo])
      setCodigo("")
      setNombre("")
      setPrefijoOrden("")
      setShowForm(false)
    } catch (error) {
      console.error("Error:", error)
      alert("Error al crear tipo")
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActivo = async (tipo: TipoDispositivoCustom) => {
    try {
      const res = await fetch(`/api/tipos-dispositivo/${tipo.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: !tipo.activo }),
      })

      if (!res.ok) {
        const error = await res.json()
        alert(error.error || "Error al actualizar tipo")
        return
      }

      setTipos((prev) =>
        prev.map((t) => (t.id === tipo.id ? { ...t, activo: !t.activo } : t))
      )
    } catch (error) {
      console.error("Error:", error)
    }
  }

  const handleDelete = async (tipo: TipoDispositivoCustom) => {
    if (tipo.esBase) {
      alert("Los tipos base no se pueden eliminar, solo desactivar")
      return
    }

    const confirmed = await confirm({
      title: "Eliminar Tipo",
      description: `¿Eliminar el tipo "${tipo.nombre}"?`,
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      variant: "danger",
    })

    if (!confirmed) return

    try {
      const res = await fetch(`/api/tipos-dispositivo/${tipo.id}`, {
        method: "DELETE",
      })

      if (!res.ok) {
        const error = await res.json()
        alert(error.error || "Error al eliminar tipo")
        return
      }

      const result = await res.json()
      if (result.desactivado) {
        setTipos((prev) =>
          prev.map((t) => (t.id === tipo.id ? { ...t, activo: false } : t))
        )
      } else {
        setTipos((prev) => prev.filter((t) => t.id !== tipo.id))
      }
    } catch (error) {
      console.error("Error:", error)
    }
  }

  const handleMoveItem = async (tipoId: string, direction: "up" | "down") => {
    const items = [...tipos].sort((a, b) => a.orden - b.orden)
    const index = items.findIndex((t) => t.id === tipoId)
    if (index === -1) return
    if (direction === "up" && index === 0) return
    if (direction === "down" && index === items.length - 1) return

    const newIndex = direction === "up" ? index - 1 : index + 1
    const temp = items[index]
    items[index] = items[newIndex]
    items[newIndex] = temp

    // Update local state immediately
    const reordered = items.map((item, i) => ({ ...item, orden: i }))
    setTipos(reordered)

    // Update in backend
    try {
      await fetch(`/api/tipos-dispositivo/${tipoId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orden: newIndex }),
      })
      await fetch(`/api/tipos-dispositivo/${items[index].id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orden: index }),
      })
    } catch (error) {
      console.error("Error reordering:", error)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Smartphone className="h-5 w-5" />
                Tipos de Dispositivo
              </CardTitle>
              <CardDescription>
                Administra los tipos de dispositivo disponibles para tu organizacion
              </CardDescription>
            </div>
            <Button onClick={() => setShowForm(!showForm)}>
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Tipo
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {showForm && (
            <form
              onSubmit={handleSubmit}
              className="space-y-4 p-4 border rounded-lg bg-muted/50"
            >
              <h4 className="font-medium">Agregar nuevo tipo</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="nombre">Nombre</Label>
                  <Input
                    id="nombre"
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    placeholder="Ej: Impresora"
                    disabled={saving}
                  />
                </div>
                <div>
                  <Label htmlFor="codigo">Codigo</Label>
                  <Input
                    id="codigo"
                    value={codigo}
                    onChange={(e) => setCodigo(e.target.value.toUpperCase())}
                    placeholder="Ej: IMPRESORA"
                    disabled={saving}
                    className="uppercase"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Solo letras, numeros y guion bajo
                  </p>
                </div>
                <div>
                  <Label htmlFor="prefijo">Prefijo para ordenes</Label>
                  <Input
                    id="prefijo"
                    value={prefijoOrden}
                    onChange={(e) => setPrefijoOrden(e.target.value.toUpperCase())}
                    placeholder="Ej: IMP"
                    disabled={saving}
                    maxLength={10}
                    className="uppercase"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Se usara en el codigo de orden
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={saving || !nombre.trim() || !codigo.trim() || !prefijoOrden.trim()}>
                  {saving ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  Agregar Tipo
                </Button>
                <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
                  Cancelar
                </Button>
              </div>
            </form>
          )}

          {tipos.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No hay tipos de dispositivo configurados.
            </p>
          ) : (
            <div className="space-y-2">
              {tipos
                .sort((a, b) => a.orden - b.orden)
                .map((tipo, index) => (
                  <div
                    key={tipo.id}
                    className={`flex items-center gap-2 p-3 border rounded-lg ${
                      tipo.activo ? "bg-background" : "bg-muted/50 opacity-60"
                    }`}
                  >
                    <div className="flex flex-col gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => handleMoveItem(tipo.id, "up")}
                        disabled={index === 0}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => handleMoveItem(tipo.id, "down")}
                        disabled={index === tipos.length - 1}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex-1">
                      <div className="font-medium flex items-center gap-2">
                        {tipo.nombre}
                        {tipo.esBase && (
                          <Badge variant="secondary" className="text-xs">
                            Base
                          </Badge>
                        )}
                        {!tipo.activo && (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            Inactivo
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground flex gap-2 mt-1">
                        <span>Codigo: {tipo.codigo}</span>
                        <span>|</span>
                        <span>Prefijo: {tipo.prefijoOrden}</span>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleToggleActivo(tipo)}
                        title={tipo.activo ? "Desactivar" : "Activar"}
                      >
                        {tipo.activo ? (
                          <Power className="h-4 w-4 text-green-600" />
                        ) : (
                          <PowerOff className="h-4 w-4 text-muted-foreground" />
                        )}
                      </Button>
                      {!tipo.esBase && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(tipo)}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
