"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  TrendingUp,
  Mail,
  Plus,
  Edit,
  Trash2,
  Eye,
  Calendar,
} from "lucide-react"
import { VendedorForm } from "./vendedor-form"
import { useModal } from "@/contexts/modal-context"

interface Vendedor {
  id: string
  nombre: string
  email: string
  created_at: string
}

export function VendedoresList() {
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === "ADMIN"
  const { confirm, showError } = useModal()

  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editingVendedor, setEditingVendedor] = useState<Vendedor | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    fetchVendedores()
  }, [])

  const fetchVendedores = async () => {
    try {
      const res = await fetch("/api/vendedores")
      const data = await res.json()
      setVendedores(data)
    } catch (error) {
      console.error("Error fetching vendedores:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (vendedor: Vendedor, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setEditingVendedor(vendedor)
    setFormOpen(true)
  }

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const confirmed = await confirm({
      title: "Eliminar Vendedor",
      description: "¿Estás seguro de eliminar este vendedor? Esta acción no se puede deshacer.",
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      variant: "danger",
    })

    if (!confirmed) return

    setDeletingId(id)
    try {
      const res = await fetch(`/api/vendedores/${id}`, { method: "DELETE" })
      if (res.ok) {
        fetchVendedores()
      } else {
        const data = await res.json()
        await showError(data.error || "Error al eliminar")
      }
    } catch (error) {
      console.error("Error deleting vendedor:", error)
      await showError("Error al eliminar vendedor")
    } finally {
      setDeletingId(null)
    }
  }

  const handleFormSuccess = () => {
    fetchVendedores()
    setEditingVendedor(null)
  }

  const handleFormClose = (open: boolean) => {
    setFormOpen(open)
    if (!open) setEditingVendedor(null)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <>
      {isAdmin && (
        <div className="flex justify-end mb-4">
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Nuevo Vendedor
          </Button>
        </div>
      )}

      {vendedores.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No hay vendedores registrados
            {isAdmin && (
              <div className="mt-4">
                <Button onClick={() => setFormOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Agregar primer vendedor
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {vendedores.map((vendedor) => (
            <Link key={vendedor.id} href={`/vendedores/${vendedor.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-green-100 rounded-lg">
                        <TrendingUp className="h-6 w-6 text-green-600" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">{vendedor.nombre}</CardTitle>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                          <Mail className="h-4 w-4" />
                          {vendedor.email}
                        </div>
                      </div>
                    </div>
                    {isAdmin && (
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(e) => handleEdit(vendedor, e)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={(e) => handleDelete(vendedor.id, e)}
                          disabled={deletingId === vendedor.id}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">Registrado</span>
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {formatDate(vendedor.created_at)}
                    </span>
                  </div>
                  <div className="pt-2 border-t">
                    <div className="flex items-center gap-2 text-sm text-primary">
                      <Eye className="h-4 w-4" />
                      Ver detalle
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <VendedorForm
        open={formOpen}
        onOpenChange={handleFormClose}
        vendedor={editingVendedor}
        onSuccess={handleFormSuccess}
      />
    </>
  )
}
