"use client"

import { useState } from "react"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  FileText,
  Plus,
  Send,
  Edit,
  Trash2,
  CheckCircle,
  XCircle,
  Clock,
  Mail,
  PenTool,
  Download,
  Share2,
  Link2,
} from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { CotizacionForm } from "./cotizacion-form"
import { CotizacionApprovalDialog } from "./cotizacion-approval-dialog"
import { SignatureDisplay } from "@/components/firma/signature-display"
import { useModal } from "@/contexts/modal-context"

interface Cotizacion {
  id: string
  numeroCotizacion: string
  estado: string
  fechaVencimiento: string | null
  notas: string | null
  subtotal: number
  iva: number
  total: number
  createdAt: string
  publicToken: string | null
  firmaAprobacion: string | null
  firmaMime: string | null
  fechaAprobacion: string | null
  items: {
    id: string
    descripcion: string
    cantidad: number
    precioUnitario: number
    subtotal: number
  }[]
}

interface CotizacionListProps {
  ordenId: string
  clienteEmail?: string | null
}

const estadoConfig: Record<string, { label: string; icon: typeof Clock; color: string }> = {
  BORRADOR: { label: "Borrador", icon: Edit, color: "bg-gray-100 text-gray-800" },
  ENVIADA: { label: "Enviada", icon: Mail, color: "bg-blue-100 text-blue-800" },
  ACEPTADA: { label: "Aceptada", icon: CheckCircle, color: "bg-green-100 text-green-800" },
  RECHAZADA: { label: "Rechazada", icon: XCircle, color: "bg-red-100 text-red-800" },
}

export function CotizacionList({ ordenId, clienteEmail }: CotizacionListProps) {
  const { formatPrice, formatDate } = useCurrency()
  const [showForm, setShowForm] = useState(false)
  const [editingCotizacion, setEditingCotizacion] = useState<Cotizacion | null>(null)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [approvingCotizacion, setApprovingCotizacion] = useState<Cotizacion | null>(null)
  const { confirm, showError, showSuccess, showWarning } = useModal()

  const fetcher = (url: string) => fetch(url).then(res => res.json())
  const { data: cotizaciones = [], isLoading: loading, mutate } = useSWR<Cotizacion[]>(
    `/api/cotizaciones?ordenId=${ordenId}`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 5000 }
  )

  const handleSend = async (cotizacionId: string) => {
    if (!clienteEmail) {
      await showWarning("El cliente no tiene email registrado")
      return
    }

    const confirmed = await confirm({
      title: "Enviar Cotización",
      description: "¿Enviar cotización al cliente por email?",
      confirmText: "Enviar",
      cancelText: "Cancelar",
      variant: "info",
    })

    if (!confirmed) return

    setSendingId(cotizacionId)
    try {
      const res = await fetch(`/api/cotizaciones/${cotizacionId}/enviar`, {
        method: "POST",
      })

      if (!res.ok) {
        const error = await res.json()
        await showError(error.error || "Error al enviar cotización")
        return
      }

      await showSuccess("Cotización enviada exitosamente")
      mutate()
    } catch (error) {
      console.error("Error:", error)
      await showError("Error al enviar cotización")
    } finally {
      setSendingId(null)
    }
  }

  const handleDelete = async (cotizacionId: string) => {
    const confirmed = await confirm({
      title: "Eliminar Cotización",
      description: "¿Estás seguro de eliminar esta cotización? Esta acción no se puede deshacer.",
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      variant: "danger",
    })

    if (!confirmed) return

    try {
      const res = await fetch(`/api/cotizaciones/${cotizacionId}`, {
        method: "DELETE",
      })

      if (!res.ok) {
        const error = await res.json()
        await showError(error.error || "Error al eliminar cotización")
        return
      }

      mutate()
    } catch (error) {
      console.error("Error:", error)
      await showError("Error al eliminar cotización")
    }
  }

  const handleUpdateEstado = async (cotizacionId: string, estado: string) => {
    try {
      const res = await fetch(`/api/cotizaciones/${cotizacionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado }),
      })

      if (!res.ok) {
        const error = await res.json()
        alert(error.error || "Error al actualizar estado")
        return
      }

      mutate()
    } catch (error) {
      console.error("Error:", error)
    }
  }

  const handleShare = async (cotizacion: Cotizacion) => {
    if (!cotizacion.publicToken) return
    const baseUrl = window.location.origin
    const url = `${baseUrl}/cotizacion/${cotizacion.publicToken}`
    try {
      await navigator.clipboard.writeText(url)
      await showSuccess("Link copiado al portapapeles")
    } catch {
      // Fallback
      prompt("Copiar este link:", url)
    }
  }

  const handleDownloadPDF = async (cotizacion: Cotizacion) => {
    try {
      const res = await fetch(`/api/cotizaciones/${cotizacion.id}/pdf`)
      if (!res.ok) {
        alert("Error al descargar PDF")
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${cotizacion.numeroCotizacion}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error("Error downloading PDF:", error)
      alert("Error al descargar PDF")
    }
  }

  if (loading) {
    return <div className="text-center py-4 text-muted-foreground">Cargando...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Cotizaciones ({cotizaciones.length})
        </h3>
        {!showForm && !editingCotizacion && (
          <Button size="sm" onClick={() => setShowForm(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Nueva Cotización
          </Button>
        )}
      </div>

      {showForm && (
        <CotizacionForm
          ordenId={ordenId}
          onClose={() => setShowForm(false)}
          onSuccess={() => {
            setShowForm(false)
            mutate()
          }}
        />
      )}

      {editingCotizacion && (
        <CotizacionForm
          ordenId={ordenId}
          initialData={{
            id: editingCotizacion.id,
            items: editingCotizacion.items,
            notas: editingCotizacion.notas,
            fechaVencimiento: editingCotizacion.fechaVencimiento,
          }}
          onClose={() => setEditingCotizacion(null)}
          onSuccess={() => {
            setEditingCotizacion(null)
            mutate()
          }}
        />
      )}

      {cotizaciones.length === 0 && !showForm ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          No hay cotizaciones para esta orden
        </p>
      ) : (
        <div className="space-y-3">
          {cotizaciones.map((cotizacion) => {
            const config = estadoConfig[cotizacion.estado] || estadoConfig.BORRADOR
            const Icon = config.icon
            const canEdit = cotizacion.estado === "BORRADOR"
            const canSend = ["BORRADOR", "ENVIADA"].includes(cotizacion.estado)
            const canDelete = cotizacion.estado !== "ACEPTADA"

            return (
              <Card key={cotizacion.id}>
                <CardHeader className="py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CardTitle className="text-base">
                        {cotizacion.numeroCotizacion}
                      </CardTitle>
                      <Badge className={config.color}>
                        <Icon className="mr-1 h-3 w-3" />
                        {config.label}
                      </Badge>
                    </div>
                    <div className="text-lg font-bold">
                      {formatPrice(cotizacion.total)}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="py-3 space-y-3">
                  <div className="text-sm text-muted-foreground flex flex-col sm:flex-row sm:gap-4">
                    <span>Creada: {formatDate(cotizacion.createdAt)}</span>
                    {cotizacion.fechaVencimiento && (
                      <span>
                        Válida hasta: {formatDate(cotizacion.fechaVencimiento)}
                      </span>
                    )}
                  </div>

                  {/* Items preview */}
                  <div className="text-sm">
                    <div className="font-medium mb-1">Items:</div>
                    <ul className="list-disc list-inside text-muted-foreground">
                      {cotizacion.items.slice(0, 3).map((item) => (
                        <li key={item.descripcion}>
                          {item.descripcion} x{item.cantidad} - {formatPrice(item.subtotal)}
                        </li>
                      ))}
                      {cotizacion.items.length > 3 && (
                        <li>... y {cotizacion.items.length - 3} más</li>
                      )}
                    </ul>
                  </div>

                  {/* Firma de aprobacion */}
                  {cotizacion.estado === "ACEPTADA" && cotizacion.firmaAprobacion && cotizacion.firmaMime && (
                    <div className="pt-2 border-t">
                      <SignatureDisplay
                        signature={cotizacion.firmaAprobacion}
                        mime={cotizacion.firmaMime}
                        label="Firma de Aprobacion"
                        date={cotizacion.fechaAprobacion}
                      />
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2 pt-2 border-t">
                    {canSend && (
                      !clienteEmail ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled
                          className="opacity-60"
                        >
                          <Mail className="mr-2 h-3 w-3" />
                          Sin email del cliente
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleSend(cotizacion.id)}
                          disabled={sendingId === cotizacion.id}
                        >
                          <Send className="mr-2 h-3 w-3" />
                          {sendingId === cotizacion.id ? "Enviando..." : "Enviar"}
                        </Button>
                      )
                    )}
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditingCotizacion(cotizacion)}
                      >
                        <Edit className="mr-2 h-3 w-3" />
                        Editar
                      </Button>
                    )}
                    {cotizacion.estado === "ENVIADA" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-green-600 hover:text-green-700"
                          onClick={() => setApprovingCotizacion(cotizacion)}
                        >
                          <PenTool className="mr-2 h-3 w-3" />
                          Aprobar con Firma
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => handleUpdateEstado(cotizacion.id, "RECHAZADA")}
                        >
                          <XCircle className="mr-2 h-3 w-3" />
                          Rechazar
                        </Button>
                      </>
                    )}
                    {canDelete && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleDelete(cotizacion.id)}
                      >
                        <Trash2 className="mr-2 h-3 w-3" />
                        Eliminar
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDownloadPDF(cotizacion)}
                      title="Descargar PDF"
                    >
                      <Download className="mr-2 h-3 w-3" />
                      PDF
                    </Button>
                    {cotizacion.publicToken && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleShare(cotizacion)}
                        title="Copiar link publico"
                      >
                        <Link2 className="mr-2 h-3 w-3" />
                        Compartir
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Approval Dialog */}
      {approvingCotizacion && (
        <CotizacionApprovalDialog
          open={!!approvingCotizacion}
          onClose={() => setApprovingCotizacion(null)}
          onSuccess={() => mutate()}
          cotizacion={approvingCotizacion}
        />
      )}
    </div>
  )
}
