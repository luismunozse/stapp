"use client"

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import type { Lead } from "@/types/database"

interface LeadDetailDialogProps {
  lead: Lead
  isOpen: boolean
  onClose: () => void
  onUpdate: () => void
}

interface Conversacion {
  conversacion: any
  mensajes: any[]
}

export function LeadDetailDialog({ lead, isOpen, onClose, onUpdate }: LeadDetailDialogProps) {
  const { formatDateTime } = useCurrency()
  const [loading, setLoading] = useState(false)
  const [conversacion, setConversacion] = useState<Conversacion | null>(null)
  const [notas, setNotas] = useState(lead.notas || "")
  const [estado, setEstado] = useState(lead.estado)

  useEffect(() => {
    if (isOpen && lead.id) {
      fetchConversacion()
    }
  }, [isOpen, lead.id])

  const fetchConversacion = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/leads/${lead.id}/conversacion`)
      if (response.ok) {
        const data = await response.json()
        setConversacion(data)
      }
    } catch (error) {
      console.error("Error fetching conversación:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleUpdate = async () => {
    try {
      const response = await fetch(`/api/leads?id=${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado, notas }),
      })

      if (response.ok) {
        onUpdate()
        onClose()
      }
    } catch (error) {
      console.error("Error updating lead:", error)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[calc(100vw-1rem)] sm:max-w-3xl max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Detalle del Lead</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Información del lead */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Nombre</label>
              <p className="text-sm text-muted-foreground">{lead.nombre || "No proporcionado"}</p>
            </div>
            <div>
              <label className="text-sm font-medium">Email</label>
              <p className="text-sm text-muted-foreground">{lead.email || "No proporcionado"}</p>
            </div>
            <div>
              <label className="text-sm font-medium">Teléfono</label>
              <p className="text-sm text-muted-foreground">{lead.telefono || "No proporcionado"}</p>
            </div>
            <div>
              <label className="text-sm font-medium">Empresa</label>
              <p className="text-sm text-muted-foreground">{lead.empresa || "No proporcionado"}</p>
            </div>
            <div>
              <label className="text-sm font-medium">Plan de interés</label>
              <p className="text-sm text-muted-foreground">{lead.plan_interes || "No especificado"}</p>
            </div>
            <div>
              <label className="text-sm font-medium">Fecha de creación</label>
              <p className="text-sm text-muted-foreground">
                {formatDateTime(lead.created_at)}
              </p>
            </div>
          </div>

          {/* Estado y notas */}
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Estado</label>
              <select
                value={estado}
                onChange={(e) => setEstado(e.target.value as any)}
                className="w-full px-3 py-2 rounded-md border border-input bg-background"
              >
                <option value="NUEVO">Nuevo</option>
                <option value="CONTACTADO">Contactado</option>
                <option value="CALIFICADO">Calificado</option>
                <option value="CONVERTIDO">Convertido</option>
                <option value="DESCARTADO">Descartado</option>
              </select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Notas</label>
              <textarea
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                placeholder="Agrega notas sobre este lead..."
                rows={4}
                className="w-full px-3 py-2 rounded-md border border-input bg-background resize-none"
              />
            </div>
          </div>

          {/* Conversación */}
          <div>
            <h3 className="text-sm font-medium mb-3">Conversación con Santi</h3>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : conversacion ? (
              <div className="border rounded-lg p-4 space-y-3 max-h-96 overflow-y-auto bg-muted/50">
                {conversacion.mensajes.map((mensaje: any) => (
                  <div
                    key={mensaje.id}
                    className={`flex ${mensaje.tipo === "USER" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[75%] rounded-lg px-3 py-2 ${
                        mensaje.tipo === "USER" ? "bg-primary text-primary-foreground" : "bg-background"
                      }`}
                    >
                      <p className="text-sm">{mensaje.contenido}</p>
                      <span className="text-xs opacity-70">
                        {new Date(mensaje.created_at).toLocaleTimeString("es-AR")}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No hay conversación disponible</p>
            )}
          </div>

          {/* Acciones */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={handleUpdate}>Guardar cambios</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
