"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ClipboardCheck, Plus, Loader2 } from "lucide-react"
import { ChecklistForm } from "./checklist-form"
import { ChecklistView } from "./checklist-view"

interface TemplateItem {
  id: string
  label: string
  tipo: string
  categoria: string
  opciones: string | null
  orden: number
  requerido: boolean
}

interface Template {
  id: string
  nombre: string
  items: TemplateItem[]
}

interface Checklist {
  id: string
  ordenId: string
  templateId: string
  valores: Record<string, boolean | string | null>
  notas: string | null
  createdAt: string
  updatedAt: string
  firmaCliente: string | null
  firmaMime: string | null
  template: Template
}

interface ChecklistCardProps {
  ordenId: string
}

export function ChecklistCard({ ordenId }: ChecklistCardProps) {
  const [loading, setLoading] = useState(true)
  const [checklist, setChecklist] = useState<Checklist | null>(null)
  const [template, setTemplate] = useState<Template | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [isEditing, setIsEditing] = useState(false)

  const fetchChecklist = async () => {
    try {
      const res = await fetch(`/api/ordenes/${ordenId}/checklist`)
      if (!res.ok) {
        console.error("Error fetching checklist")
        return
      }
      const data = await res.json()
      // Merge template into checklist so ChecklistView can access checklist.template
      if (data.checklist && data.template) {
        setChecklist({ ...data.checklist, template: data.template })
      } else {
        setChecklist(data.checklist)
      }
      setTemplate(data.template)
    } catch (error) {
      console.error("Error:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchChecklist()
  }, [ordenId])

  const handleSuccess = () => {
    setShowForm(false)
    setIsEditing(false)
    fetchChecklist()
  }

  const handleCancel = () => {
    setShowForm(false)
    setIsEditing(false)
  }

  const handleEdit = () => {
    setIsEditing(true)
    setShowForm(true)
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  // Si hay checklist y no estamos editando, mostrar vista
  if (checklist && !showForm) {
    return <ChecklistView checklist={checklist} onEdit={handleEdit} />
  }

  // Si estamos mostrando el formulario (crear o editar)
  if (showForm && template) {
    return (
      <ChecklistForm
        ordenId={ordenId}
        template={checklist ? checklist.template : template}
        initialValues={checklist?.valores}
        initialNotas={checklist?.notas || ""}
        initialFirma={checklist?.firmaCliente}
        initialFirmaMime={checklist?.firmaMime}
        isEditing={isEditing}
        onSuccess={handleSuccess}
        onCancel={handleCancel}
      />
    )
  }

  // No hay checklist ni template configurado
  if (!template) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5" />
            Checklist de Recepcion
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            No hay un template de checklist configurado.
            <br />
            Configure uno en Configuracion &gt; Checklist.
          </p>
        </CardContent>
      </Card>
    )
  }

  // No hay checklist, mostrar boton para crear
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5" />
          Checklist de Recepcion
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-center py-4">
          <p className="text-muted-foreground mb-4">
            No hay checklist registrado para esta orden
          </p>
          <Button onClick={() => setShowForm(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Crear Checklist
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
