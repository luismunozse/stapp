"use client"

import { useState, useEffect, useCallback } from "react"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Receipt,
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
  Link2,
  Search,
  Copy,
  ChevronLeft,
  ChevronRight,
  ShoppingCart,
  Eye,
  BookmarkPlus,
} from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { CotizacionForm } from "@/components/cotizaciones/cotizacion-form"
import { CotizacionApprovalDialog } from "@/components/cotizaciones/cotizacion-approval-dialog"
import { ConvertirVentaDialog } from "@/components/cotizaciones/convertir-venta-dialog"
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
  clienteNombre?: string | null
  clienteEmail?: string | null
  clienteId?: string | null
  ordenId?: string | null
  ordenNumero?: number | null
  sectorId?: string | null
  terminos?: string | null
  descuentoGlobalTipo?: string | null
  descuentoGlobalValor?: number | null
  ivaPorcentaje?: number | null
  vistoAt?: string | null
  vistoCount?: number
  motivoRechazo?: string | null
  items: {
    id: string
    descripcion: string
    cantidad: number
    precioUnitario: number
    subtotal: number
    unidad?: string
    descuentoTipo?: string
    descuentoValor?: number
  }[]
}

interface PaginatedResponse {
  data: Cotizacion[]
  total: number
  page: number
  limit: number
  totalPages: number
}

const estadoConfig: Record<string, { label: string; icon: typeof Clock; color: string }> = {
  BORRADOR: { label: "Borrador", icon: Edit, color: "bg-gray-100 text-gray-800" },
  ENVIADA: { label: "Enviada", icon: Mail, color: "bg-blue-100 text-blue-800" },
  ACEPTADA: { label: "Aceptada", icon: CheckCircle, color: "bg-green-100 text-green-800" },
  RECHAZADA: { label: "Rechazada", icon: XCircle, color: "bg-red-100 text-red-800" },
}

const fetcher = (url: string) => fetch(url).then(res => res.json())

export default function CotizacionesPage() {
  const { formatPrice, formatDate } = useCurrency()
  const [showForm, setShowForm] = useState(false)
  const [editingCotizacion, setEditingCotizacion] = useState<Cotizacion | null>(null)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)
  const [approvingCotizacion, setApprovingCotizacion] = useState<Cotizacion | null>(null)
  const [convertingCotizacion, setConvertingCotizacion] = useState<Cotizacion | null>(null)
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [estadoFilter, setEstadoFilter] = useState("TODOS")
  const [page, setPage] = useState(1)
  const { confirm, showError, showSuccess, showWarning } = useModal()

  // Debounce search 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1) // reset to page 1 on new search
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  // Reset page when estado filter changes
  useEffect(() => {
    setPage(1)
  }, [estadoFilter])

  const swrKey = `/api/cotizaciones?page=${page}&limit=20&estado=${estadoFilter}&search=${encodeURIComponent(debouncedSearch)}`
  const { data: response, isLoading: loading, mutate } = useSWR<PaginatedResponse>(
    swrKey,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 5000 }
  )

  const cotizaciones = response?.data || []
  const totalPages = response?.totalPages || 1
  const total = response?.total || 0

  const handleSend = async (cotizacion: Cotizacion) => {
    if (!cotizacion.clienteEmail) {
      await showWarning("El cliente no tiene email registrado")
      return
    }

    const confirmed = await confirm({
      title: "Enviar Cotizacion",
      description: "Enviar cotizacion al cliente por email?",
      confirmText: "Enviar",
      cancelText: "Cancelar",
      variant: "info",
    })
    if (!confirmed) return

    setSendingId(cotizacion.id)
    try {
      const res = await fetch(`/api/cotizaciones/${cotizacion.id}/enviar`, { method: "POST" })
      if (!res.ok) {
        const error = await res.json()
        await showError(error.error || "Error al enviar cotizacion")
        return
      }
      await showSuccess("Cotizacion enviada exitosamente")
      mutate()
    } catch {
      await showError("Error al enviar cotizacion")
    } finally {
      setSendingId(null)
    }
  }

  const handleDelete = async (cotizacionId: string) => {
    const confirmed = await confirm({
      title: "Eliminar Cotizacion",
      description: "Esta accion no se puede deshacer.",
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      variant: "danger",
    })
    if (!confirmed) return

    try {
      const res = await fetch(`/api/cotizaciones/${cotizacionId}`, { method: "DELETE" })
      if (!res.ok) {
        const error = await res.json()
        await showError(error.error || "Error al eliminar")
        return
      }
      mutate()
    } catch {
      await showError("Error al eliminar cotizacion")
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
        await showError(error.error || "Error al actualizar estado")
        return
      }
      mutate()
    } catch {
      await showError("Error al actualizar estado")
    }
  }

  const handleShare = async (cotizacion: Cotizacion) => {
    if (!cotizacion.publicToken) return
    const url = `${window.location.origin}/cotizacion/${cotizacion.publicToken}`
    try {
      await navigator.clipboard.writeText(url)
      await showSuccess("Link copiado al portapapeles")
    } catch {
      prompt("Copiar este link:", url)
    }
  }

  const handleDownloadPDF = async (cotizacion: Cotizacion) => {
    try {
      const res = await fetch(`/api/cotizaciones/${cotizacion.id}/pdf`)
      if (!res.ok) {
        await showError("Error al descargar PDF")
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
    } catch {
      await showError("Error al descargar PDF")
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

  const handleSaveAsTemplate = async (cotizacion: Cotizacion) => {
    const nombre = window.prompt("Nombre de la plantilla:")
    if (!nombre) return
    try {
      const res = await fetch("/api/cotizacion-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre,
          items: cotizacion.items.map((item) => ({
            descripcion: item.descripcion,
            cantidad: item.cantidad,
            precioUnitario: item.precioUnitario,
            unidad: item.unidad,
            descuentoTipo: item.descuentoTipo,
            descuentoValor: item.descuentoValor,
          })),
          notas: cotizacion.notas || undefined,
          terminos: cotizacion.terminos || undefined,
          descuentoGlobalTipo: cotizacion.descuentoGlobalTipo || undefined,
          descuentoGlobalValor: cotizacion.descuentoGlobalValor || undefined,
          ivaPorcentaje: cotizacion.ivaPorcentaje || undefined,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        await showError(err.error || "Error al guardar plantilla")
        return
      }
      await showSuccess(`Plantilla "${nombre}" guardada`)
    } catch {
      await showError("Error al guardar plantilla")
    }
  }

  return (
    <div className="container py-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Receipt className="h-6 w-6" />
          Cotizaciones
        </h1>
        {!showForm && !editingCotizacion && (
          <Button onClick={() => setShowForm(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Nueva Cotizacion
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por numero de cotizacion..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={estadoFilter} onValueChange={setEstadoFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="TODOS">Todos</SelectItem>
            <SelectItem value="BORRADOR">Borrador</SelectItem>
            <SelectItem value="ENVIADA">Enviada</SelectItem>
            <SelectItem value="ACEPTADA">Aceptada</SelectItem>
            <SelectItem value="RECHAZADA">Rechazada</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Form */}
      {showForm && (
        <CotizacionForm
          onClose={() => setShowForm(false)}
          onSuccess={() => {
            setShowForm(false)
            mutate()
          }}
        />
      )}

      {editingCotizacion && (
        <CotizacionForm
          ordenId={editingCotizacion.ordenId || undefined}
          initialData={{
            id: editingCotizacion.id,
            items: editingCotizacion.items,
            notas: editingCotizacion.notas,
            fechaVencimiento: editingCotizacion.fechaVencimiento,
            terminos: editingCotizacion.terminos || undefined,
            descuentoGlobalTipo: editingCotizacion.descuentoGlobalTipo || undefined,
            descuentoGlobalValor: editingCotizacion.descuentoGlobalValor || undefined,
            ivaPorcentaje: editingCotizacion.ivaPorcentaje || undefined,
            clienteId: editingCotizacion.clienteId || undefined,
            sectorId: editingCotizacion.sectorId || undefined,
          }}
          onClose={() => setEditingCotizacion(null)}
          onSuccess={() => {
            setEditingCotizacion(null)
            mutate()
          }}
        />
      )}

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : cotizaciones.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <Receipt className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">
              {!debouncedSearch && estadoFilter === "TODOS"
                ? "No hay cotizaciones. Crea la primera."
                : "No hay cotizaciones con ese filtro."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Result count */}
          <div className="text-sm text-muted-foreground">
            {total} cotizacion{total !== 1 ? "es" : ""} encontrada{total !== 1 ? "s" : ""}
          </div>

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
                      <div className="flex items-center gap-3 flex-wrap">
                        <CardTitle className="text-base">
                          {cotizacion.numeroCotizacion}
                        </CardTitle>
                        <Badge className={config.color}>
                          <Icon className="mr-1 h-3 w-3" />
                          {config.label}
                        </Badge>
                        {cotizacion.ordenNumero && (
                          <Badge variant="outline" className="text-xs">
                            Orden #{cotizacion.ordenNumero}
                          </Badge>
                        )}
                        {cotizacion.vistoAt && (
                          <Badge variant="outline" className="text-xs text-blue-600">
                            <Eye className="mr-1 h-3 w-3" />
                            Visto{(cotizacion.vistoCount || 0) > 1 ? ` (${cotizacion.vistoCount})` : ""}
                          </Badge>
                        )}
                      </div>
                      <div className="text-lg font-bold">
                        {formatPrice(cotizacion.total)}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="py-3 space-y-3">
                    <div className="text-sm text-muted-foreground flex flex-col sm:flex-row sm:gap-4">
                      {cotizacion.clienteNombre && (
                        <span>Cliente: {cotizacion.clienteNombre}</span>
                      )}
                      <span>Creada: {formatDate(cotizacion.createdAt)}</span>
                      {cotizacion.fechaVencimiento && (
                        <span>
                          Valida hasta: {formatDate(cotizacion.fechaVencimiento)}
                        </span>
                      )}
                    </div>

                    {/* Items preview */}
                    <div className="text-sm">
                      <div className="font-medium mb-1">Items:</div>
                      <ul className="list-disc list-inside text-muted-foreground">
                        {cotizacion.items.slice(0, 3).map((item) => (
                          <li key={item.id}>
                            {item.descripcion} x{item.cantidad} - {formatPrice(item.subtotal)}
                          </li>
                        ))}
                        {cotizacion.items.length > 3 && (
                          <li>... y {cotizacion.items.length - 3} mas</li>
                        )}
                      </ul>
                    </div>

                    {/* Desglose si hay descuento/IVA */}
                    {((cotizacion.descuentoGlobalValor || 0) > 0 || (cotizacion.ivaPorcentaje || 0) > 0) && (
                      <div className="text-xs text-muted-foreground flex gap-3">
                        {(cotizacion.descuentoGlobalValor || 0) > 0 && (
                          <span>
                            Dto: {cotizacion.descuentoGlobalTipo === "porcentaje"
                              ? `${cotizacion.descuentoGlobalValor}%`
                              : formatPrice(cotizacion.descuentoGlobalValor || 0)}
                          </span>
                        )}
                        {(cotizacion.ivaPorcentaje || 0) > 0 && (
                          <span>IVA: {cotizacion.ivaPorcentaje}%</span>
                        )}
                      </div>
                    )}

                    {/* Firma */}
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
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleSend(cotizacion)}
                          disabled={sendingId === cotizacion.id || !cotizacion.clienteEmail}
                          title={!cotizacion.clienteEmail ? "Sin email del cliente" : undefined}
                        >
                          <Send className="mr-2 h-3 w-3" />
                          {sendingId === cotizacion.id ? "Enviando..." : !cotizacion.clienteEmail ? "Sin email" : "Enviar"}
                        </Button>
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
                            Aprobar
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
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDuplicate(cotizacion)}
                        disabled={duplicatingId === cotizacion.id}
                      >
                        <Copy className="mr-2 h-3 w-3" />
                        {duplicatingId === cotizacion.id ? "Duplicando..." : "Duplicar"}
                      </Button>
                      {cotizacion.estado === "ACEPTADA" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-green-600 hover:text-green-700"
                          onClick={() => setConvertingCotizacion(cotizacion)}
                        >
                          <ShoppingCart className="mr-2 h-3 w-3" />
                          Convertir a Venta
                        </Button>
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
                      >
                        <Download className="mr-2 h-3 w-3" />
                        PDF
                      </Button>
                      {cotizacion.publicToken && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleShare(cotizacion)}
                        >
                          <Link2 className="mr-2 h-3 w-3" />
                          Compartir
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleSaveAsTemplate(cotizacion)}
                      >
                        <BookmarkPlus className="mr-2 h-3 w-3" />
                        Plantilla
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-sm text-muted-foreground">
                Pagina {page} de {totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Anterior
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  Siguiente
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
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

      {/* Convertir a Venta Dialog */}
      {convertingCotizacion && (
        <ConvertirVentaDialog
          open={!!convertingCotizacion}
          onClose={() => setConvertingCotizacion(null)}
          onSuccess={async (ventaId, numeroVenta) => {
            setConvertingCotizacion(null)
            await showSuccess(`Venta #${numeroVenta} creada exitosamente`)
            mutate()
          }}
          cotizacionId={convertingCotizacion.id}
          numeroCotizacion={convertingCotizacion.numeroCotizacion}
          items={convertingCotizacion.items}
          total={convertingCotizacion.total}
        />
      )}
    </div>
  )
}
