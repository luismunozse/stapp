"use client"

import { useState, useEffect, use } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  ArrowLeft,
  Wrench,
  Mail,
  Calendar,
  ClipboardList,
  CheckCircle,
  Edit,
  Trash2,
} from "lucide-react"
import { TecnicoForm } from "@/components/tecnicos/tecnico-form"
import { useModal } from "@/contexts/modal-context"

interface Orden {
  id: string
  numeroOrden: number
  dispositivo: string
  estado: string
  fechaIngreso: string
  cliente: string
}

interface TecnicoDetalle {
  id: string
  nombre: string
  email: string
  createdAt: string
  ordenesActivas: number
  ordenesCompletadas: number
  ordenes: Orden[]
}

const estadoColors: Record<string, string> = {
  RECIBIDO: "bg-slate-100 text-slate-800",
  EN_DIAGNOSTICO: "bg-purple-100 text-purple-800",
  PRESUPUESTADO: "bg-amber-100 text-amber-800",
  APROBADO: "bg-blue-100 text-blue-800",
  EN_REPARACION: "bg-yellow-100 text-yellow-800",
  ESPERANDO_REPUESTO: "bg-orange-100 text-orange-800",
  REPARADO: "bg-cyan-100 text-cyan-800",
  ENTREGADO: "bg-green-100 text-green-800",
  CANCELADO: "bg-gray-100 text-gray-800",
  SIN_REPARACION: "bg-red-100 text-red-800",
}

const estadoLabels: Record<string, string> = {
  RECIBIDO: "Recibido",
  EN_DIAGNOSTICO: "En Diagnóstico",
  PRESUPUESTADO: "Presupuestado",
  APROBADO: "Aprobado",
  EN_REPARACION: "En Reparación",
  ESPERANDO_REPUESTO: "Esperando Repuesto",
  REPARADO: "Reparado",
  ENTREGADO: "Entregado",
  CANCELADO: "Cancelado",
  SIN_REPARACION: "Sin Reparación",
}

export default function TecnicoDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { confirm, showError } = useModal()
  const [tecnico, setTecnico] = useState<TecnicoDetalle | null>(null)
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    fetchTecnico()
  }, [id])

  const fetchTecnico = async () => {
    try {
      const res = await fetch(`/api/tecnicos/${id}`)
      if (!res.ok) {
        router.push("/tecnicos")
        return
      }
      const data = await res.json()
      setTecnico(data)
    } catch (error) {
      console.error("Error fetching tecnico:", error)
      router.push("/tecnicos")
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: "Eliminar Técnico",
      description: "¿Estás seguro de eliminar este técnico? Esta acción no se puede deshacer.",
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      variant: "danger",
    })

    if (!confirmed) return

    setDeleting(true)
    try {
      const res = await fetch(`/api/tecnicos/${id}`, { method: "DELETE" })
      if (res.ok) {
        router.push("/tecnicos")
      } else {
        const data = await res.json()
        await showError(data.error || "Error al eliminar")
      }
    } catch (error) {
      console.error("Error deleting tecnico:", error)
      await showError("Error al eliminar técnico")
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

  if (!tecnico) {
    return null
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/tecnicos">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold">{tecnico.nombre}</h1>
            <p className="text-muted-foreground">Detalle del técnico</p>
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
            disabled={deleting || tecnico.ordenesActivas > 0}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {deleting ? "Eliminando..." : "Eliminar"}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Información
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-muted-foreground" />
              <span>{tecnico.nombre}</span>
            </div>
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <span>{tecnico.email}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span>Desde {new Date(tecnico.createdAt).toLocaleDateString()}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <ClipboardList className="h-4 w-4" />
              Órdenes Activas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{tecnico.ordenesActivas}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle className="h-4 w-4" />
              Órdenes Completadas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">{tecnico.ordenesCompletadas}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Historial de Órdenes</CardTitle>
        </CardHeader>
        <CardContent>
          {tecnico.ordenes.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No hay órdenes asignadas a este técnico
            </p>
          ) : (
            <div className="space-y-3">
              {tecnico.ordenes.map((orden) => (
                <Link
                  key={orden.id}
                  href={`/ordenes/${orden.id}`}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="font-medium">#{orden.numeroOrden}</div>
                    <div>
                      <div className="font-medium">{orden.dispositivo}</div>
                      <div className="text-sm text-muted-foreground">{orden.cliente}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-muted-foreground">
                      {new Date(orden.fechaIngreso).toLocaleDateString()}
                    </span>
                    <Badge className={estadoColors[orden.estado]}>
                      {estadoLabels[orden.estado]}
                    </Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <TecnicoForm
        open={editOpen}
        onOpenChange={setEditOpen}
        tecnico={tecnico}
        onSuccess={fetchTecnico}
      />
    </div>
  )
}
