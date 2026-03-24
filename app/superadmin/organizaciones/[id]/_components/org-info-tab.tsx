"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Save, MessageCircle } from "lucide-react"
import { useSuperadminMutation } from "@/hooks/use-superadmin-fetch"
import { formatDateTime } from "@/lib/utils"
import type { OrganizationDetail } from "@/types/superadmin"

interface OrgInfoTabProps {
  organization: OrganizationDetail
  onUpdated: () => void
}

export function OrgInfoTab({ organization, onUpdated }: OrgInfoTabProps) {
  const { mutate, loading: saving } = useSuperadminMutation()

  const [formData, setFormData] = useState({
    nombre: organization.nombre || "",
    nombre_mostrar: organization.nombre_mostrar || "",
    email: organization.email || "",
    telefono: organization.telefono || "",
    direccion: organization.direccion || "",
  })

  const handleSave = async () => {
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

        {/* Contacto por WhatsApp */}
        {formData.telefono && (
          <div className="pt-4 border-t">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <p className="text-sm font-medium">Contactar por WhatsApp</p>
                <p className="text-xs text-muted-foreground">
                  Enviar mensaje al teléfono de la organización
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="text-green-600 border-green-600 hover:bg-green-50 hover:text-green-700"
                onClick={() => {
                  const phone = formData.telefono.replace(/\D/g, "")
                  window.open(
                    `https://wa.me/${phone}`,
                    "_blank"
                  )
                }}
              >
                <MessageCircle className="h-4 w-4 mr-2" />
                WhatsApp
              </Button>
            </div>
          </div>
        )}

        <div className="flex justify-between items-center pt-4 border-t">
          <div className="text-sm text-muted-foreground">
            Creada: {formatDateTime(organization.created_at)}
          </div>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Guardando..." : "Guardar cambios"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
