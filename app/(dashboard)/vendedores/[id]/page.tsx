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
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3 sm:gap-4">
          <Button variant="ghost" size="icon" asChild className="shrink-0">
            <Link href="/vendedores">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-3xl font-bold truncate">{vendedor.nombre}</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">Detalle del vendedor</p>
          </div>
        </div>
        <div className="flex gap-2 pl-12 sm:pl-0">
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Edit className="mr-1.5 h-4 w-4" />
            Editar
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={deleting}
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            {deleting ? "..." : "Eliminar"}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="p-3 sm:p-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
              Información
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0 space-y-2 sm:space-y-3">
            <div className="flex items-center gap-2 min-w-0">
              <TrendingUp className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground shrink-0" />
              <span className="text-xs sm:text-sm truncate">{vendedor.nombre}</span>
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <Mail className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground shrink-0" />
              <span className="text-xs sm:text-sm truncate">{vendedor.email}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground shrink-0" />
              <span className="text-xs sm:text-sm">Desde {new Date(vendedor.createdAt).toLocaleDateString()}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-3 sm:p-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
              Permisos del Rol
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <ul className="space-y-1.5 sm:space-y-2 text-xs sm:text-sm">
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 sm:h-2 sm:w-2 rounded-full bg-green-500 shrink-0"></span>
                Crear y gestionar clientes
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 sm:h-2 sm:w-2 rounded-full bg-green-500 shrink-0"></span>
                Crear órdenes de servicio
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 sm:h-2 sm:w-2 rounded-full bg-green-500 shrink-0"></span>
                Ver inventario (solo lectura)
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 sm:h-2 sm:w-2 rounded-full bg-red-500 shrink-0"></span>
                No puede gestionar usuarios
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 sm:h-2 sm:w-2 rounded-full bg-red-500 shrink-0"></span>
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
