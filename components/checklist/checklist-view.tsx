"use client"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ClipboardCheck, Check, X, Edit2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatDate } from "@/lib/utils"

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

interface ChecklistViewProps {
  checklist: Checklist
  onEdit?: () => void
}

const categoriaLabels: Record<string, string> = {
  CONDICION_FISICA: "Condicion Fisica",
  ACCESORIOS: "Accesorios Entregados",
  FUNCIONAL: "Estado Funcional",
  OTRO: "Otros",
}

export function ChecklistView({ checklist, onEdit }: ChecklistViewProps) {
  // Agrupar items por categoria
  const itemsByCategory = checklist.template.items.reduce((acc, item) => {
    const cat = item.categoria || "GENERAL"
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(item)
    return acc
  }, {} as Record<string, TemplateItem[]>)

  const renderValue = (item: TemplateItem) => {
    const value = checklist.valores[item.id]

    switch (item.tipo) {
      case "BOOLEAN":
        if (value === true) {
          return (
            <Badge className="bg-green-100 text-green-800">
              <Check className="h-3 w-3 mr-1" />
              Si
            </Badge>
          )
        } else if (value === false) {
          return (
            <Badge className="bg-red-100 text-red-800">
              <X className="h-3 w-3 mr-1" />
              No
            </Badge>
          )
        }
        return (
          <Badge variant="outline" className="text-muted-foreground">
            Sin especificar
          </Badge>
        )

      case "TEXT":
      case "SELECT":
        if (value) {
          return (
            <span className="text-sm font-medium">{value as string}</span>
          )
        }
        return (
          <span className="text-sm text-muted-foreground">Sin especificar</span>
        )

      default:
        return null
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5" />
            Checklist de Recepcion
          </CardTitle>
          {onEdit && (
            <Button variant="ghost" size="sm" onClick={onEdit}>
              <Edit2 className="h-4 w-4 mr-1" />
              Editar
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Completado el {formatDate(checklist.createdAt)}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {Object.entries(itemsByCategory).map(([categoria, items]) => (
          <div key={categoria}>
            <h3 className="font-medium text-sm text-muted-foreground border-b pb-2 mb-2">
              {categoriaLabels[categoria] || categoria}
            </h3>
            <div className="space-y-2">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between py-1"
                >
                  <span className="text-sm">{item.label}</span>
                  {renderValue(item)}
                </div>
              ))}
            </div>
          </div>
        ))}

        {checklist.notas && (
          <div className="pt-2 border-t">
            <h4 className="font-medium text-sm mb-1">Observaciones:</h4>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {checklist.notas}
            </p>
          </div>
        )}

        {checklist.firmaCliente && (
          <div className="pt-2 border-t">
            <h4 className="font-medium text-sm mb-2">Firma del Cliente:</h4>
            <img
              src={`data:${checklist.firmaMime};base64,${checklist.firmaCliente}`}
              alt="Firma del cliente"
              className="max-h-24 border rounded"
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
