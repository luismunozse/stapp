"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useSearchParams, useRouter } from "next/navigation"
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
  LayoutGrid,
  LayoutList,
  FileText,
  Wrench,
  Paperclip,
  MessageCircle,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useCurrency } from "@/contexts/currency-context"
import { CotizacionForm } from "@/components/cotizaciones/cotizacion-form"
import { CotizacionApprovalDialog } from "@/components/cotizaciones/cotizacion-approval-dialog"
import { ConvertirVentaDialog } from "@/components/cotizaciones/convertir-venta-dialog"
import { OrdenSelector, type OrdenLite } from "@/components/cotizaciones/orden-selector"
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
  clienteTelefono?: string | null
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
  origen?: string | null
  tipo?: "ORDEN" | "PRESUPUESTO"
  equipo?: {
    dispositivo: string
    tipoDispositivoId?: string | null
    tipoDispositivo?: string | null
    marca?: string | null
    modelo?: string | null
    color?: string | null
    imei?: string | null
    numeroSerie?: string | null
    problemaReportado: string
  } | null
  checklist?: {
    templateId: string
    tipoDispositivoId?: string | null
    valores: Record<string, boolean | string | null>
    notas?: string | null
  } | null
  convertidaAOrdenId?: string | null
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
  const [showTipoSelector, setShowTipoSelector] = useState(false)
  const [formTipo, setFormTipo] = useState<"ORDEN" | "PRESUPUESTO">("ORDEN")
  const [editingCotizacion, setEditingCotizacion] = useState<Cotizacion | null>(null)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)
  const [convertingOrdenId, setConvertingOrdenId] = useState<string | null>(null)
  const [approvingCotizacion, setApprovingCotizacion] = useState<Cotizacion | null>(null)
  const [convertingCotizacion, setConvertingCotizacion] = useState<Cotizacion | null>(null)
  const [linkingCotizacion, setLinkingCotizacion] = useState<Cotizacion | null>(null)
  const [linkOrdenId, setLinkOrdenId] = useState<string | null>(null)
  const [linkLoading, setLinkLoading] = useState(false)
  const formRef = useRef<HTMLDivElement | null>(null)
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [estadoFilter, setEstadoFilter] = useState("TODOS")
  const [page, setPage] = useState(1)
  const [viewMode, setViewMode] = useState<"cards" | "list">("cards")

  // Persistir preferencia de vista
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("cotizaciones-view-mode") : null
    if (saved === "list" || saved === "cards") setViewMode(saved)
  }, [])
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("cotizaciones-view-mode", viewMode)
  }, [viewMode])
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

  // Scroll form into view when opening create/edit
  useEffect(() => {
    if (showForm || editingCotizacion) {
      requestAnimationFrame(() => {
        formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      })
    }
  }, [showForm, editingCotizacion])

  const openEditForm = useCallback((cotizacion: Cotizacion) => {
    setShowForm(false)
    setShowTipoSelector(false)
    setEditingCotizacion(cotizacion)
  }, [])

  const openCreateForm = useCallback((tipo: "ORDEN" | "PRESUPUESTO") => {
    setEditingCotizacion(null)
    setFormTipo(tipo)
    setShowTipoSelector(false)
    setShowForm(true)
  }, [])

  const swrKey = `/api/cotizaciones?page=${page}&limit=20&estado=${estadoFilter}&search=${encodeURIComponent(debouncedSearch)}`
  const { data: response, isLoading: loading, mutate } = useSWR<PaginatedResponse>(
    swrKey,
    fetcher,
    {
      revalidateOnFocus: true,
      dedupingInterval: 5000,
      // Polling cada 30s mientras el tab esté visible — captura nuevas
      // cotizaciones del catálogo público sin esperar focus o F5.
      refreshInterval: 30000,
      refreshWhenHidden: false,
      refreshWhenOffline: false,
    }
  )

  // Auto-abrir cotización cuando llega ?abrir=<id> (deeplink de notificaciones).
  // Fetcha individualmente porque puede no estar en la página actual.
  const searchParams = useSearchParams()
  const router = useRouter()
  const abrirIdRef = useRef<string | null>(null)
  useEffect(() => {
    const abrirId = searchParams?.get("abrir")
    if (!abrirId || abrirIdRef.current === abrirId) return
    abrirIdRef.current = abrirId
    void (async () => {
      try {
        const res = await fetch(`/api/cotizaciones/${abrirId}`)
        if (!res.ok) {
          return
        }
        const cot = await res.json()
        setEditingCotizacion(cot as Cotizacion)
      } catch {
        /* silent */
      } finally {
        // Limpiar query param para que no se reabra en próximos renders
        const params = new URLSearchParams(searchParams?.toString() ?? "")
        params.delete("abrir")
        router.replace(`/cotizaciones${params.toString() ? `?${params.toString()}` : ""}`, { scroll: false })
      }
    })()
  }, [searchParams, router])

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
        await fetch(`/api/cotizaciones/${cotizacion.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ estado: "ENVIADA" }),
        })
        mutate()
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
    } catch {
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

  const handleConvertirOrden = async (cotizacion: Cotizacion) => {
    const confirmed = await confirm({
      title: "Convertir a orden",
      description: `Se creará una nueva orden de servicio con los datos de ${cotizacion.numeroCotizacion}. ¿Continuar?`,
      confirmText: "Crear orden",
      cancelText: "Cancelar",
      variant: "info",
    })
    if (!confirmed) return

    setConvertingOrdenId(cotizacion.id)
    try {
      const res = await fetch(`/api/cotizaciones/${cotizacion.id}/convertir-orden`, {
        method: "POST",
      })
      if (!res.ok) {
        const err = await res.json()
        await showError(err.error || "Error al convertir en orden")
        return
      }
      const data = await res.json()
      await showSuccess(`Orden ${data.codigoOrden} creada`)
      mutate()
    } catch {
      await showError("Error al convertir en orden")
    } finally {
      setConvertingOrdenId(null)
    }
  }

  const handleVincularOrden = async () => {
    if (!linkingCotizacion || !linkOrdenId) return
    setLinkLoading(true)
    try {
      const res = await fetch(`/api/cotizaciones/${linkingCotizacion.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ordenId: linkOrdenId }),
      })
      if (!res.ok) {
        const err = await res.json()
        await showError(err.error || "Error al vincular orden")
        return
      }
      await showSuccess("Cotización vinculada a la orden")
      setLinkingCotizacion(null)
      setLinkOrdenId(null)
      mutate()
    } catch {
      await showError("Error al vincular orden")
    } finally {
      setLinkLoading(false)
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
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Receipt className="h-6 w-6" />
          Cotizaciones
        </h1>
        {!showForm && !editingCotizacion && (
          <Button onClick={() => setShowTipoSelector(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Nueva Cotización
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por número o cliente..."
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
        <div className="flex border rounded-lg overflow-hidden">
          <Button
            variant={viewMode === "cards" ? "default" : "ghost"}
            size="sm"
            className="rounded-none"
            onClick={() => setViewMode("cards")}
            title="Vista de tarjetas"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "list" ? "default" : "ghost"}
            size="sm"
            className="rounded-none"
            onClick={() => setViewMode("list")}
            title="Vista de lista"
          >
            <LayoutList className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Selector de tipo */}
      <Dialog open={showTipoSelector} onOpenChange={setShowTipoSelector}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>¿Qué tipo de cotización querés crear?</DialogTitle>
            <DialogDescription>
              Elegí el tipo según el escenario. Podés convertir un presupuesto en orden más tarde.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2 pt-2">
            <button
              type="button"
              className="text-left p-4 border rounded-lg hover:border-primary hover:bg-muted/50 transition-colors"
              onClick={() => openCreateForm("ORDEN")}
            >
              <div className="flex items-center gap-2 font-medium mb-1">
                <Wrench className="h-4 w-4 text-primary" />
                Cotización de orden
              </div>
              <p className="text-xs text-muted-foreground">
                Para piezas/servicios sobre un equipo ya ingresado al taller. Requiere
                firma del cliente al aprobar y reserva stock.
              </p>
            </button>
            <button
              type="button"
              className="text-left p-4 border rounded-lg hover:border-primary hover:bg-muted/50 transition-colors"
              onClick={() => openCreateForm("PRESUPUESTO")}
            >
              <div className="flex items-center gap-2 font-medium mb-1">
                <FileText className="h-4 w-4 text-primary" />
                Presupuesto
              </div>
              <p className="text-xs text-muted-foreground">
                Documento plano para presentar (seguro, empresa). Incluye datos del
                equipo y checklist. Sin firma. Luego se puede convertir en orden.
              </p>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Form */}
      <div ref={formRef}>
        {showForm && !editingCotizacion && (
          <CotizacionForm
            key={`new-${formTipo}`}
            tipo={formTipo}
            onClose={() => setShowForm(false)}
            onSuccess={() => {
              setShowForm(false)
              mutate()
            }}
          />
        )}

        {editingCotizacion && (
          <CotizacionForm
            key={`edit-${editingCotizacion.id}`}
            tipo={editingCotizacion.tipo || "ORDEN"}
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
              equipo: editingCotizacion.equipo || undefined,
              checklist: editingCotizacion.checklist || undefined,
            }}
            onClose={() => setEditingCotizacion(null)}
            onSuccess={() => {
              setEditingCotizacion(null)
              mutate()
            }}
          />
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Card key={`skeleton-${i}`}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="h-5 w-28 bg-muted animate-pulse rounded" />
                  <div className="h-5 w-20 bg-muted animate-pulse rounded" />
                </div>
                <div className="h-4 w-48 bg-muted animate-pulse rounded" />
                <div className="h-3 w-36 bg-muted animate-pulse rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : cotizaciones.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 px-4">
            <div className="flex items-center justify-center w-16 h-16 mb-4 rounded-full bg-muted">
              <Receipt className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">
              {!debouncedSearch && estadoFilter === "TODOS"
                ? "Todavía no hay cotizaciones"
                : "Sin resultados"}
            </h3>
            <p className="text-sm text-muted-foreground text-center max-w-sm mb-4">
              {!debouncedSearch && estadoFilter === "TODOS"
                ? "Creá tu primera cotización para enviar presupuestos a tus clientes."
                : "No se encontraron cotizaciones con los filtros aplicados."}
            </p>
            {!debouncedSearch && estadoFilter === "TODOS" && (
              <Button onClick={() => setShowForm(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Nueva Cotización
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Result count */}
          <div className="text-sm text-muted-foreground">
            {total} cotizacion{total !== 1 ? "es" : ""} encontrada{total !== 1 ? "s" : ""}
          </div>

          {viewMode === "list" ? (
            /* ========== VISTA LISTA ========== */
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3 font-medium">Numero</th>
                      <th className="text-left p-3 font-medium">Estado</th>
                      <th className="text-left p-3 font-medium hidden sm:table-cell">Cliente</th>
                      <th className="text-left p-3 font-medium hidden md:table-cell">Orden</th>
                      <th className="text-left p-3 font-medium hidden md:table-cell">Fecha</th>
                      <th className="text-right p-3 font-medium">Total</th>
                      <th className="text-center p-3 font-medium">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cotizaciones.map((cotizacion) => {
                      const config = estadoConfig[cotizacion.estado] || estadoConfig.BORRADOR
                      const Icon = config.icon
                      const canEdit = cotizacion.estado === "BORRADOR"
                      const canSend = ["BORRADOR", "ENVIADA"].includes(cotizacion.estado)
                      const canDelete = cotizacion.estado !== "ACEPTADA"
                      return (
                        <tr key={cotizacion.id} className="border-b hover:bg-muted/30 transition-colors">
                          <td className="p-3 font-medium">
                            <div className="flex items-center gap-2 flex-wrap">
                              {cotizacion.numeroCotizacion}
                              {cotizacion.tipo === "PRESUPUESTO" && (
                                <Badge variant="outline" className="text-[10px] border-purple-300 text-purple-700">
                                  Presupuesto
                                </Badge>
                              )}
                              {cotizacion.origen === "CATALOGO_PUBLICO" && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-900 dark:text-emerald-300 gap-1"
                                  title="Solicitud generada desde el catálogo público"
                                >
                                  <ShoppingCart className="h-2.5 w-2.5" />
                                  Catálogo
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="p-3">
                            <Badge className={config.color}>
                              <Icon className="mr-1 h-3 w-3" />
                              {config.label}
                            </Badge>
                          </td>
                          <td className="p-3 hidden sm:table-cell">{cotizacion.clienteNombre || "-"}</td>
                          <td className="p-3 hidden md:table-cell text-muted-foreground">
                            {cotizacion.ordenNumero ? `#${cotizacion.ordenNumero}` : "-"}
                          </td>
                          <td className="p-3 hidden md:table-cell text-muted-foreground">
                            {formatDate(cotizacion.createdAt)}
                          </td>
                          <td className="p-3 text-right font-medium">{formatPrice(cotizacion.total)}</td>
                          <td className="p-3">
                            <div className="flex items-center justify-center gap-1 flex-wrap">
                              {canEdit && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openEditForm(cotizacion)}
                                  title="Editar"
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                              )}
                              {canSend && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleSend(cotizacion)}
                                  disabled={sendingId === cotizacion.id || !cotizacion.clienteEmail}
                                  title={!cotizacion.clienteEmail ? "Sin email del cliente" : "Enviar por email"}
                                >
                                  <Send className="h-4 w-4" />
                                </Button>
                              )}
                              {cotizacion.estado === "ENVIADA" && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-green-600 hover:text-green-700"
                                    onClick={() => setApprovingCotizacion(cotizacion)}
                                    title="Aprobar con firma"
                                  >
                                    <PenTool className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-red-600 hover:text-red-700"
                                    onClick={() => handleUpdateEstado(cotizacion.id, "RECHAZADA")}
                                    title="Rechazar"
                                  >
                                    <XCircle className="h-4 w-4" />
                                  </Button>
                                </>
                              )}
                              {cotizacion.estado === "ACEPTADA" && cotizacion.tipo !== "PRESUPUESTO" && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-green-600 hover:text-green-700"
                                  onClick={() => setConvertingCotizacion(cotizacion)}
                                  title="Convertir a venta"
                                >
                                  <ShoppingCart className="h-4 w-4" />
                                </Button>
                              )}
                              {cotizacion.tipo === "PRESUPUESTO" && !cotizacion.convertidaAOrdenId && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-blue-600 hover:text-blue-700"
                                  onClick={() => handleConvertirOrden(cotizacion)}
                                  disabled={convertingOrdenId === cotizacion.id}
                                  title="Convertir a orden"
                                >
                                  <Wrench className="h-4 w-4" />
                                </Button>
                              )}
                              {cotizacion.tipo !== "PRESUPUESTO" && !cotizacion.ordenId && ["BORRADOR", "ENVIADA"].includes(cotizacion.estado) && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-blue-600 hover:text-blue-700"
                                  onClick={() => { setLinkOrdenId(null); setLinkingCotizacion(cotizacion) }}
                                  title="Vincular a orden existente"
                                >
                                  <Paperclip className="h-4 w-4" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDownloadPDF(cotizacion)}
                                title="Descargar PDF"
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                              {cotizacion.publicToken && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleShare(cotizacion)}
                                  title="Compartir link"
                                >
                                  <Link2 className="h-4 w-4" />
                                </Button>
                              )}
                              {cotizacion.publicToken && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-green-600 hover:text-green-700"
                                  onClick={() => handleShareWhatsApp(cotizacion)}
                                  title={cotizacion.clienteTelefono ? "Compartir por WhatsApp al cliente" : "Compartir por WhatsApp"}
                                >
                                  <MessageCircle className="h-4 w-4" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDuplicate(cotizacion)}
                                disabled={duplicatingId === cotizacion.id}
                                title="Duplicar"
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                              {canDelete && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => handleDelete(cotizacion.id)}
                                  title="Eliminar"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
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
                      <div className="flex items-center gap-3 flex-wrap">
                        <CardTitle className="text-base">
                          {cotizacion.numeroCotizacion}
                        </CardTitle>
                        <Badge className={config.color}>
                          <Icon className="mr-1 h-3 w-3" />
                          {config.label}
                        </Badge>
                        {cotizacion.tipo === "PRESUPUESTO" && (
                          <Badge variant="outline" className="text-xs border-purple-300 text-purple-700">
                            <FileText className="mr-1 h-3 w-3" />
                            Presupuesto
                          </Badge>
                        )}
                        {cotizacion.origen === "CATALOGO_PUBLICO" && (
                          <Badge
                            variant="outline"
                            className="text-xs border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-900 dark:text-emerald-300 gap-1"
                            title="Solicitud generada desde el catálogo público"
                          >
                            <ShoppingCart className="mr-0.5 h-3 w-3" />
                            Catálogo
                          </Badge>
                        )}
                        {cotizacion.ordenNumero && (
                          <Badge variant="outline" className="text-xs">
                            Orden #{cotizacion.ordenNumero}
                          </Badge>
                        )}
                        {cotizacion.convertidaAOrdenId && (
                          <Badge variant="outline" className="text-xs border-green-300 text-green-700">
                            Convertida a orden
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
                          onClick={() => openEditForm(cotizacion)}
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
                      {cotizacion.estado === "ACEPTADA" && cotizacion.tipo !== "PRESUPUESTO" && (
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
                      {cotizacion.tipo === "PRESUPUESTO" && !cotizacion.convertidaAOrdenId && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-blue-600 hover:text-blue-700"
                          onClick={() => handleConvertirOrden(cotizacion)}
                          disabled={convertingOrdenId === cotizacion.id}
                        >
                          <Wrench className="mr-2 h-3 w-3" />
                          {convertingOrdenId === cotizacion.id ? "Creando orden..." : "Convertir a orden"}
                        </Button>
                      )}
                      {cotizacion.tipo !== "PRESUPUESTO" && !cotizacion.ordenId && ["BORRADOR", "ENVIADA"].includes(cotizacion.estado) && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-blue-600 hover:text-blue-700"
                          onClick={() => { setLinkOrdenId(null); setLinkingCotizacion(cotizacion) }}
                        >
                          <Paperclip className="mr-2 h-3 w-3" />
                          Vincular a orden
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
                      {cotizacion.publicToken && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-green-600 hover:text-green-700"
                          onClick={() => handleShareWhatsApp(cotizacion)}
                        >
                          <MessageCircle className="mr-2 h-3 w-3" />
                          WhatsApp
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
          )}

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

      {/* Vincular a orden Dialog */}
      <Dialog
        open={!!linkingCotizacion}
        onOpenChange={(open) => {
          if (!open) {
            setLinkingCotizacion(null)
            setLinkOrdenId(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Vincular cotización a orden</DialogTitle>
            <DialogDescription>
              Asociá {linkingCotizacion?.numeroCotizacion} a una orden de servicio existente.
              El presupuesto de la orden se recalcula al confirmar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <OrdenSelector
              value={linkOrdenId}
              onChange={(id, _orden: OrdenLite | null) => setLinkOrdenId(id)}
              disabled={linkLoading}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => { setLinkingCotizacion(null); setLinkOrdenId(null) }}
                disabled={linkLoading}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleVincularOrden}
                disabled={!linkOrdenId || linkLoading}
              >
                {linkLoading ? "Vinculando..." : "Vincular"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
