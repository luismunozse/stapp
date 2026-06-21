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
  Copy,
} from "lucide-react"

import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"
import { useCurrency } from "@/contexts/currency-context"
import { CotizacionForm } from "./cotizacion-form"
import { CotizacionApprovalDialog } from "./cotizacion-approval-dialog"
import { SignatureDisplay } from "@/components/firma/signature-display"
import { useModal } from "@/contexts/modal-context"
import { EmptyState } from "@/components/ui/empty-state"

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
  clienteNombre?: string | null
  clienteTelefono?: string | null
  items: {
    id: string
    descripcion: string
    cantidad: number
    precioUnitario: number
    subtotal: number
  }[]
}

interface RepuestoOrden {
  id: string
  inventarioId?: string | null
  inventario?: { id: string; nombre: string; stock: number } | null
  nombre?: string
  cantidad: number
  precioUnitario: number
}

interface CotizacionListProps {
  ordenId: string
  clienteEmail?: string | null
  readOnly?: boolean
  repuestos?: RepuestoOrden[]
}

const estadoConfig: Record<string, { label: string; icon: typeof Clock; color: string }> = {
  BORRADOR: { label: "Borrador", icon: Edit, color: "bg-muted text-muted-foreground" },
  ENVIADA: { label: "Enviada", icon: Mail, color: "bg-info-50 text-info-700 dark:bg-info/15 dark:text-info-500" },
  ACEPTADA: { label: "Aceptada", icon: CheckCircle, color: "bg-success-50 text-success-700 dark:bg-success/15 dark:text-success-500" },
  RECHAZADA: { label: "Rechazada", icon: XCircle, color: "bg-destructive/10 text-destructive" },
}

export function CotizacionList({ ordenId, clienteEmail, readOnly = false, repuestos = [] }: CotizacionListProps) {
  const { formatPrice, formatDate } = useCurrency()
  const [showForm, setShowForm] = useState(false)
  const [prefillFromRepuestos, setPrefillFromRepuestos] = useState(false)
  const [editingCotizacion, setEditingCotizacion] = useState<Cotizacion | null>(null)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [approvingCotizacion, setApprovingCotizacion] = useState<Cotizacion | null>(null)
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)
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
        void showError(error.error || "Error al actualizar estado")
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
    const wasBorador = cotizacion.estado === "BORRADOR"

    // Si está en BORRADOR, cambiar a ENVIADA para que sea visible en seguimiento
    if (wasBorador) {
      try {
        const res = await fetch(`/api/cotizaciones/${cotizacion.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ estado: "ENVIADA" }),
        })
        if (res.ok) {
          mutate() // Refresh list
        }
      } catch {
        // Continue with share even if state change fails
      }
    }

    try {
      await navigator.clipboard.writeText(url)
      await showSuccess(wasBorador
        ? "Cotizacion enviada como presupuesto. Link copiado al portapapeles."
        : "Link copiado al portapapeles")
    } catch {
      // Fallback
      prompt("Copiar este link:", url)
    }
  }

  const handleShareWhatsApp = async (cotizacion: Cotizacion) => {
    if (!cotizacion.publicToken) return
    const url = `${window.location.origin}/cotizacion/${cotizacion.publicToken}`
    const nombre = cotizacion.clienteNombre || "cliente"
    const total = formatPrice(Number(cotizacion.total || 0))
    const mensaje =
      `Hola ${nombre}, te comparto la cotización ${cotizacion.numeroCotizacion}. ` +
      `Total: ${total}. ` +
      `Podés verla acá: ${url}`

    if (cotizacion.estado === "BORRADOR") {
      try {
        const res = await fetch(`/api/cotizaciones/${cotizacion.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ estado: "ENVIADA" }),
        })
        if (res.ok) mutate()
      } catch {
        // continuar igual
      }
    }

    const telefono = (cotizacion.clienteTelefono || "").replace(/\D/g, "")
    let waUrl: string
    if (telefono) {
      const normalized = telefono.startsWith("54") ? telefono : `54${telefono}`
      waUrl = `https://wa.me/${normalized}?text=${encodeURIComponent(mensaje)}`
    } else {
      waUrl = `https://wa.me/?text=${encodeURIComponent(mensaje)}`
    }
    window.open(waUrl, "_blank", "noopener,noreferrer")
  }

  const handleDownloadPDF = async (cotizacion: Cotizacion) => {
    try {
      const res = await fetch(`/api/cotizaciones/${cotizacion.id}/pdf`)
      if (!res.ok) {
        await showError("Error al abrir PDF")
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      window.open(url, "_blank")
    } catch (error) {
      console.error("Error opening PDF:", error)
      await showError("Error al abrir PDF")
    }
  }

  const handleDuplicate = async (cotizacion: Cotizacion) => {
    setDuplicatingId(cotizacion.id)
    try {
      const res = await fetch(`/api/cotizaciones/${cotizacion.id}/duplicar`, { method: "POST" })
      if (!res.ok) {
        const error = await res.json()
        await showError(error.error || "Error al duplicar cotizacion")
        return
      }
      const data = await res.json()
      await showSuccess(`Cotizacion ${data.numeroCotizacion} creada como borrador`)
      mutate()
    } catch {
      await showError("Error al duplicar cotizacion")
    } finally {
      setDuplicatingId(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="rounded-lg border bg-card p-4 space-y-2">
            <div className="flex justify-between">
              <div className="h-4 bg-muted animate-pulse rounded w-1/4" />
              <div className="h-4 bg-muted animate-pulse rounded w-16" />
            </div>
            <div className="h-3 bg-muted animate-pulse rounded w-2/3" />
            <div className="h-3 bg-muted animate-pulse rounded w-1/3" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Cotizaciones ({cotizaciones.length})
        </h3>
        {!readOnly && !showForm && !editingCotizacion && (
          <div className="flex gap-2">
            {repuestos.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => { setPrefillFromRepuestos(true); setShowForm(true) }}>
                <Plus className="mr-2 h-4 w-4" />
                Desde Repuestos
              </Button>
            )}
            <Button size="sm" onClick={() => { setPrefillFromRepuestos(false); setShowForm(true) }}>
              <Plus className="mr-2 h-4 w-4" />
              Nueva Cotización
            </Button>
          </div>
        )}
      </div>

      {showForm && (
        <CotizacionForm
          ordenId={ordenId}
          onClose={() => { setShowForm(false); setPrefillFromRepuestos(false) }}
          onSuccess={() => {
            setShowForm(false)
            setPrefillFromRepuestos(false)
            mutate()
          }}
          {...(prefillFromRepuestos && repuestos.length > 0 ? {
            initialData: {
              id: "",
              items: repuestos.map(r => ({
                descripcion: r.inventario?.nombre || r.nombre || "",
                cantidad: r.cantidad,
                precioUnitario: r.precioUnitario,
                unidad: "Unidad",
                descuentoTipo: "porcentaje",
                descuentoValor: 0,
                inventarioId: r.inventarioId || null,
              })),
            },
          } : {})}
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
        <EmptyState
          icon={FileText}
          title="No hay cotizaciones para esta orden"
          variant="search"
        />
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
                    {!readOnly && canEdit && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditingCotizacion(cotizacion)}
                      >
                        <Edit className="mr-2 h-3 w-3" />
                        Editar
                      </Button>
                    )}
                    {!readOnly && cotizacion.estado === "ENVIADA" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-success-600 hover:text-success-700"
                          onClick={() => setApprovingCotizacion(cotizacion)}
                        >
                          <PenTool className="mr-2 h-3 w-3" />
                          Aprobar con Firma
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:text-destructive/80"
                          onClick={() => handleUpdateEstado(cotizacion.id, "RECHAZADA")}
                        >
                          <XCircle className="mr-2 h-3 w-3" />
                          Rechazar
                        </Button>
                      </>
                    )}
                    {!readOnly && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDuplicate(cotizacion)}
                        disabled={duplicatingId === cotizacion.id}
                      >
                        <Copy className="mr-2 h-3 w-3" />
                        {duplicatingId === cotizacion.id ? "Duplicando..." : "Duplicar"}
                      </Button>
                    )}
                    {!readOnly && canDelete && (
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
                      title="Ver PDF"
                    >
                      <Download className="mr-2 h-3 w-3" />
                      PDF
                    </Button>
                    {cotizacion.publicToken && (
                      <Button
                        size="sm"
                        variant={cotizacion.estado === "BORRADOR" ? "default" : "ghost"}
                        onClick={() => handleShare(cotizacion)}
                        title={cotizacion.estado === "BORRADOR" ? "Enviar como presupuesto y copiar link" : "Copiar link publico"}
                      >
                        {cotizacion.estado === "BORRADOR" ? (
                          <><Send className="mr-2 h-3 w-3" />Enviar y compartir</>
                        ) : (
                          <><Link2 className="mr-2 h-3 w-3" />Compartir</>
                        )}
                      </Button>
                    )}
                    {cotizacion.publicToken && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-success-600 hover:text-success-700"
                        onClick={() => handleShareWhatsApp(cotizacion)}
                        title={cotizacion.clienteTelefono ? "Compartir por WhatsApp al cliente" : "Compartir por WhatsApp"}
                      >
                        <WhatsAppIcon className="mr-2 h-3 w-3" />
                        WhatsApp
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}

          {cotizaciones.length > 1 && (
            <div className="flex items-center justify-between border-t pt-3 px-1 mt-1">
              <span className="text-sm font-medium text-muted-foreground">
                Total ({cotizaciones.length} cotizaciones)
              </span>
              <span className="text-lg font-bold">
                {formatPrice(cotizaciones.reduce((sum, c) => sum + c.total, 0))}
              </span>
            </div>
          )}
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
