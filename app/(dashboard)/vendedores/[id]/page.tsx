"use client"

import { useState, useEffect, use } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  ArrowLeft,
  TrendingUp,
  Mail,
  Calendar,
  Edit,
  Trash2,
} from "lucide-react"
import { VendedorForm } from "@/components/vendedores/vendedor-form"
import { useModal } from "@/contexts/modal-context"

interface VendedorDetalle {
  id: string
  nombre: string
  email: string
  createdAt: string
}

export default function VendedorDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { confirm, showError } = useModal()
  const [vendedor, setVendedor] = useState<VendedorDetalle | null>(null)
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    fetchVendedor()
  }, [id])

  const fetchVendedor = async () => {
    try {
      const res = await fetch(`/api/vendedores/${id}`)
      if (!res.ok) {
        router.push("/vendedores")
        return
      }
      const data = await res.json()
      setVendedor(data)
    } catch (error) {
      console.error("Error fetching vendedor:", error)
      router.push("/vendedores")
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: "Eliminar Vendedor",
      description: "¿Estás seguro de eliminar este vendedor? Esta acción no se puede deshacer.",
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      variant: "danger",
    })

    if (!confirmed) return

    setDeleting(true)
    try {
      const res = await fetch(`/api/vendedores/${id}`, { method: "DELETE" })
      if (res.ok) {
        router.push("/vendedores")
      } else {
        const data = await res.json()
        await showError(data.error || "Error al eliminar")
      }
    } catch (error) {
      console.error("Error deleting vendedor:", error)
      await showError("Error al eliminar vendedor")
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (!vendedor) {
    return null
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/vendedores">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold">{vendedor.nombre}</h1>
            <p className="text-muted-foreground">Detalle del vendedor</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Edit className="mr-2 h-4 w-4" />
            Editar
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleting}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {deleting ? "Eliminando..." : "Eliminar"}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Información
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <span>{vendedor.nombre}</span>
            </div>
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <span>{vendedor.email}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span>Desde {new Date(vendedor.createdAt).toLocaleDateString()}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Permisos del Rol
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-green-500"></span>
                Crear y gestionar clientes
              </li>
              <li className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-green-500"></span>
                Crear órdenes de servicio
              </li>
              <li className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-green-500"></span>
                Ver inventario (solo lectura)
              </li>
              <li className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-red-500"></span>
                No puede gestionar usuarios
              </li>
              <li className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-red-500"></span>
                No puede modificar configuración
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>

      <VendedorForm
        open={editOpen}
        onOpenChange={setEditOpen}
        vendedor={vendedor}
        onSuccess={fetchVendedor}
      />
    </div>
  )
}
