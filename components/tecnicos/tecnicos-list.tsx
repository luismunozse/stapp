"use client"

import { useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Wrench,
  Mail,
  ClipboardList,
  CheckCircle,
  Plus,
  Edit,
  Trash2,
  Eye,
} from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { TecnicoForm } from "./tecnico-form"
import { useModal } from "@/contexts/modal-context"

interface Tecnico {
  id: string
  nombre: string
  email: string
  ordenesActivas: number
  ordenesCompletadas: number
}

export function TecnicosList() {
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === "ADMIN"
  const { confirm, showError, showWarning } = useModal()

  const [formOpen, setFormOpen] = useState(false)
  const [editingTecnico, setEditingTecnico] = useState<Tecnico | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetcher = (url: string) => fetch(url).then(res => res.json())
  const { data: tecnicos = [], isLoading: loading, mutate } = useSWR<Tecnico[]>(
    "/api/tecnicos", fetcher,
    { revalidateOnFocus: false, dedupingInterval: 5000 }
  )

  const handleEdit = (tecnico: Tecnico, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setEditingTecnico(tecnico)
    setFormOpen(true)
  }

  const handleDelete = async (id: string, ordenesActivas: number, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (ordenesActivas > 0) {
      await showWarning("No se puede eliminar un técnico con órdenes activas")
      return
    }

    const confirmed = await confirm({
      title: "Eliminar Técnico",
      description: "¿Estás seguro de eliminar este técnico? Esta acción no se puede deshacer.",
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      variant: "danger",
    })

    if (!confirmed) return

    setDeletingId(id)
    try {
      const res = await fetch(`/api/tecnicos/${id}`, { method: "DELETE" })
      if (res.ok) {
        mutate()
      } else {
        const data = await res.json()
        await showError(data.error || "Error al eliminar")
      }
    } catch (error) {
      console.error("Error deleting tecnico:", error)
      await showError("Error al eliminar técnico")
    } finally {
      setDeletingId(null)
    }
  }

  const handleFormSuccess = () => {
    mutate()
    setEditingTecnico(null)
  }

  const handleFormClose = (open: boolean) => {
    setFormOpen(open)
    if (!open) setEditingTecnico(null)
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
            Nuevo Técnico
          </Button>
        </div>
      )}

      {tecnicos.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No hay técnicos registrados
            {isAdmin && (
              <div className="mt-4">
                <Button onClick={() => setFormOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Agregar primer técnico
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {tecnicos.map((tecnico) => (
            <Link key={tecnico.id} href={`/tecnicos/${tecnico.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                <CardHeader className="p-3 sm:p-6">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                      <div className="p-1.5 sm:p-2 bg-primary/10 rounded-lg shrink-0">
                        <Wrench className="h-4 w-4 sm:h-6 sm:w-6 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <TooltipProvider delayDuration={300}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <CardTitle className="text-sm sm:text-lg truncate">{tecnico.nombre}</CardTitle>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              <p className="font-medium">{tecnico.nombre}</p>
                              <p className="text-xs text-muted-foreground">{tecnico.email}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <div className="flex items-center gap-1.5 text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1">
                          <Mail className="h-3 w-3 sm:h-4 sm:w-4 shrink-0" />
                          <TooltipProvider delayDuration={300}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="truncate">{tecnico.email}</span>
                              </TooltipTrigger>
                              <TooltipContent side="bottom">{tecnico.email}</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      </div>
                    </div>
                    {isAdmin && (
                      <div className="flex gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 sm:h-8 sm:w-8"
                          onClick={(e) => handleEdit(tecnico, e)}
                        >
                          <Edit className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 sm:h-8 sm:w-8 text-destructive hover:text-destructive"
                          onClick={(e) => handleDelete(tecnico.id, tecnico.ordenesActivas, e)}
                          disabled={deletingId === tecnico.id}
                        >
                          <Trash2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="p-3 sm:p-6 pt-0 space-y-2 sm:space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ClipboardList className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
                      <span className="text-xs sm:text-sm">Activas</span>
                    </div>
                    <Badge variant="secondary" className="text-[10px] sm:text-xs">{tecnico.ordenesActivas}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
                      <span className="text-xs sm:text-sm">Completadas</span>
                    </div>
                    <Badge className="bg-green-100 text-green-800 hover:bg-green-100 text-[10px] sm:text-xs">
                      {tecnico.ordenesCompletadas}
                    </Badge>
                  </div>
                  <div className="pt-2 border-t">
                    <div className="flex items-center gap-2 text-xs sm:text-sm text-primary">
                      <Eye className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      Ver detalle
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <TecnicoForm
        open={formOpen}
        onOpenChange={handleFormClose}
        tecnico={editingTecnico}
        onSuccess={handleFormSuccess}
      />
    </>
  )
}
