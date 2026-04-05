"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Save, Loader2 } from "lucide-react"
import { toast } from "sonner"

interface PersonalInfoProps {
  initialName: string
  email: string
  role: string
  onNameUpdated: () => void
}

export function PersonalInfo({ initialName, email, role, onNameUpdated }: PersonalInfoProps) {
  const [nombre, setNombre] = useState(initialName)
  const [saving, setSaving] = useState(false)

  const hasChanges = nombre.trim() !== initialName

  const handleSave = async () => {
    if (!nombre.trim() || nombre.trim().length < 2) {
      toast.error("El nombre debe tener al menos 2 caracteres")
      return
    }

    setSaving(true)
    try {
      const res = await fetch("/api/users/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nombre.trim() }),
      })
      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || "Error al actualizar")
        return
      }

      toast.success("Nombre actualizado")
      onNameUpdated()
    } catch {
      toast.error("Error al actualizar")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Informacion personal</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="nombre">Nombre</Label>
          <Input
            id="nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Tu nombre"
            maxLength={100}
          />
        </div>

        <div className="space-y-2">
          <Label>Email</Label>
          <p className="text-sm text-muted-foreground px-3 py-2 bg-muted rounded-md">
            {email}
          </p>
        </div>

        <div className="space-y-2">
          <Label>Rol</Label>
          <div>
            <Badge variant="secondary">{role}</Badge>
          </div>
        </div>

        {hasChanges && (
          <Button onClick={handleSave} disabled={saving} size="sm">
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Guardar cambios
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
