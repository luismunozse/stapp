"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Plus,
  Edit,
  Trash2,
  Phone,
  Mail,
  MapPin,
  Globe,
  ExternalLink,
} from "lucide-react"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"
import { ProveedorForm } from "./proveedor-form"
import { useModal } from "@/contexts/modal-context"

interface Proveedor {
  id: string
  nombre: string
  telefono?: string | null
  whatsapp?: string | null
  email?: string | null
  direccion?: string | null
  website?: string | null
  notas?: string | null
  activo: boolean
  createdAt: string
  updatedAt: string
}

export function ProveedoresList() {
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingProveedor, setEditingProveedor] = useState<Proveedor | null>(null)
  const { confirm } = useModal()

  const fetchProveedores = async () => {
    try {
      const res = await fetch("/api/proveedores")
      const data = await res.json()
      setProveedores(data)
    } catch (error) {
      console.error("Error fetching proveedores:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchProveedores()
  }, [])

  const handleDelete = async (id: string) => {
    const confirmed = await confirm({
      title: "Eliminar proveedor",
      description: "¿Estás seguro de eliminar este proveedor? Esta acción no se puede deshacer.",
      confirmText: "Eliminar",
      variant: "danger",
    })
    if (!confirmed) return

    try {
      const res = await fetch(`/api/proveedores/${id}`, { method: "DELETE" })
      if (res.ok) {
        fetchProveedores()
      }
    } catch (error) {
      console.error("Error deleting proveedor:", error)
    }
  }

  const getWhatsAppLink = (whatsapp: string) => {
    return `https://wa.me/${whatsapp}`
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <Button onClick={() => setShowForm(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Nuevo Proveedor
        </Button>
      </div>

      {showForm && (
        <ProveedorForm
          proveedor={editingProveedor}
          onClose={() => {
            setShowForm(false)
            setEditingProveedor(null)
          }}
          onSuccess={() => {
            setShowForm(false)
            setEditingProveedor(null)
            fetchProveedores()
          }}
        />
      )}

      {loading ? (
        <div className="text-center py-8">Cargando...</div>
      ) : proveedores.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No hay proveedores registrados. Agrega uno para comenzar.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {proveedores.map((proveedor) => (
            <Card key={proveedor.id} className={!proveedor.activo ? "opacity-60" : ""}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-lg flex items-center gap-2">
                      {proveedor.nombre}
                      {!proveedor.activo && (
                        <Badge variant="secondary">Inactivo</Badge>
                      )}
                    </CardTitle>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setEditingProveedor(proveedor)
                        setShowForm(true)
                      }}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(proveedor.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Teléfono */}
                {proveedor.telefono && (
                  <a
                    href={`tel:${proveedor.telefono}`}
                    className="flex items-center gap-2 text-sm hover:text-primary"
                  >
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    {proveedor.telefono}
                  </a>
                )}

                {/* WhatsApp */}
                {proveedor.whatsapp && (
                  <a
                    href={getWhatsAppLink(proveedor.whatsapp)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-green-600 hover:text-green-700"
                  >
                    <WhatsAppIcon className="h-4 w-4" />
                    WhatsApp
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}

                {/* Email */}
                {proveedor.email && (
                  <a
                    href={`mailto:${proveedor.email}`}
                    className="flex items-center gap-2 text-sm hover:text-primary"
                  >
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    {proveedor.email}
                  </a>
                )}

                {/* Dirección */}
                {proveedor.direccion && (
                  <div className="flex items-start gap-2 text-sm">
                    <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <span>{proveedor.direccion}</span>
                  </div>
                )}

                {/* Website */}
                {proveedor.website && (
                  <a
                    href={proveedor.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <Globe className="h-4 w-4" />
                    Ver página web
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}

                {/* Notas */}
                {proveedor.notas && (
                  <div className="pt-2 border-t">
                    <p className="text-sm text-muted-foreground">{proveedor.notas}</p>
                  </div>
                )}

                {/* Sin datos de contacto */}
                {!proveedor.telefono &&
                  !proveedor.whatsapp &&
                  !proveedor.email &&
                  !proveedor.website && (
                    <p className="text-sm text-muted-foreground italic">
                      Sin datos de contacto
                    </p>
                  )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
