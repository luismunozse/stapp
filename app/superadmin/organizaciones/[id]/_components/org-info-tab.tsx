"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Save } from "lucide-react"
import { useSuperadminMutation } from "@/hooks/use-superadmin-fetch"
import { formatDateTime } from "@/lib/utils"
import type { OrganizationDetail } from "@/types/superadmin"

interface OrgInfoTabProps {
  organization: OrganizationDetail
  onUpdated: () => void
}

export function OrgInfoTab({ organization, onUpdated }: OrgInfoTabProps) {
  const { mutate, loading: saving } = useSuperadminMutation()

  const initialData = {
    nombre: organization.nombre || "",
    nombre_mostrar: organization.nombre_mostrar || "",
    email: organization.email || "",
    telefono: organization.telefono || "",
    direccion: organization.direccion || "",
  }

  const [formData, setFormData] = useState(initialData)

  const isDirty = JSON.stringify(formData) !== JSON.stringify(initialData)
  const isValid = formData.nombre.trim().length >= 2

  const handleSave = async () => {
    if (!isValid) return
    const result = await mutate(
      `/api/superadmin/organizations/${organization.id}`,
      {
        method: "PUT",
        body: formData,
        successMessage: "Organización actualizada",
        errorMessage: "Error al guardar la organización",
        onSuccess: onUpdated,
      }
    )
  }

  const updateField = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Datos de la Organización</CardTitle>
        <CardDescription>
          Información general de la organización
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="nombre">Nombre</Label>
            <Input
              id="nombre"
              value={formData.nombre}
              onChange={(e) => updateField("nombre", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nombre_mostrar">Nombre a mostrar</Label>
            <Input
              id="nombre_mostrar"
              value={formData.nombre_mostrar}
              onChange={(e) => updateField("nombre_mostrar", e.target.value)}
              placeholder="Opcional"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => updateField("email", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="telefono">Teléfono</Label>
            <Input
              id="telefono"
              value={formData.telefono}
              onChange={(e) => updateField("telefono", e.target.value)}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="direccion">Dirección</Label>
            <Input
              id="direccion"
              value={formData.direccion}
              onChange={(e) => updateField("direccion", e.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-between items-center pt-4 border-t">
          <div className="text-sm text-muted-foreground">
            Creada: {formatDateTime(organization.created_at)}
          </div>
          <Button onClick={handleSave} disabled={saving || !isDirty || !isValid}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Guardando..." : "Guardar cambios"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
