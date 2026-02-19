"use client"

import { useState, useEffect } from "react"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PaymentStatusBadge } from "@/components/ui/badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  FileText,
  Plus,
  ChevronDown,
  ChevronUp,
  Trash2,
  Ban,
} from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { PagoForm } from "./pago-form"
import { PagosHistorial } from "./pagos-historial"

type EstadoPagoType = "PENDIENTE" | "PAGADO_PARCIAL" | "PAGADO" | "ANULADA" | ""

export function FacturacionList() {
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === "ADMIN"
  const { formatPrice, formatDate } = useCurrency()

  const [facturas, setFacturas] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [estadoPago, setEstadoPago] = useState<EstadoPagoType>("")
  const [showPagoForm, setShowPagoForm] = useState<string | null>(null)
  const [expandedFactura, setExpandedFactura] = useState<string | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [voidDialogOpen, setVoidDialogOpen] = useState(false)
  const [selectedFactura, setSelectedFactura] = useState<any>(null)
  const [actionLoading, setActionLoading] = useState(false)

  const fetchFacturas = async () => {
    try {
      const params = new URLSearchParams()
      if (estadoPago) params.append("estadoPago", estadoPago)

      const res = await fetch(`/api/facturacion?${params.toString()}`, { cache: "no-store" })
      const data = await res.json()
      setFacturas(data)
    } catch (error) {
      console.error("Error fetching facturas:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchFacturas()
  }, [estadoPago])

  const toggleExpanded = (facturaId: string) => {
    setExpandedFactura(expandedFactura === facturaId ? null : facturaId)
  }

  const handleDeleteClick = (factura: any) => {
    setSelectedFactura(factura)
    setDeleteDialogOpen(true)
  }

  const handleVoidClick = (factura: any) => {
    setSelectedFactura(factura)
    setVoidDialogOpen(true)
  }

  const handleDelete = async () => {
    if (!selectedFactura) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/facturacion/${selectedFactura.id}`, {
        method: "DELETE",
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Error al eliminar factura")
      }
      setDeleteDialogOpen(false)
      setSelectedFactura(null)
      fetchFacturas()
    } catch (error) {
      console.error("Error deleting factura:", error)
      alert(error instanceof Error ? error.message : "Error al eliminar factura")
    } finally {
      setActionLoading(false)
    }
  }

  const handleVoid = async () => {
    if (!selectedFactura) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/facturacion/${selectedFactura.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estadoPago: "ANULADA" }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Error al anular factura")
      }
      setVoidDialogOpen(false)
      setSelectedFactura(null)
      fetchFacturas()
    } catch (error) {
      console.error("Error voiding factura:", error)
      alert(error instanceof Error ? error.message : "Error al anular factura")
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) {
    return <div className="text-center py-8">Cargando...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-4">
        <Select
          value={estadoPago || "all"}
          onValueChange={(value) => setEstadoPago(value === "all" ? "" : value as EstadoPagoType)}
        >
          <SelectTrigger className="w-full sm:w-auto sm:min-w-[200px]">
            <SelectValue placeholder="Todos los estados" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            <SelectItem value="PENDIENTE">Pendiente</SelectItem>
            <SelectItem value="PAGADO_PARCIAL">Pago Parcial</SelectItem>
            <SelectItem value="PAGADO">Pagado</SelectItem>
            <SelectItem value="ANULADA">Anulada</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {facturas.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No hay facturas registradas
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {facturas.map((factura) => {
            const pendiente = factura.total - (factura.montoAbonado || 0)
            const isExpanded = expandedFactura === factura.id
            const showingPagoForm = showPagoForm === factura.id

            return (
              <Card key={factura.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <FileText className="h-5 w-5" />
                        Factura {factura.numeroFactura}
                      </CardTitle>
                      <div className="text-sm text-muted-foreground mt-1">
                        Orden {factura.orden.codigoOrden || `#${factura.orden.numeroOrden}`} - {factura.orden.cliente.nombre}
                      </div>
                    </div>
                    <PaymentStatusBadge status={factura.estadoPago} showIcon />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">Fecha:</span>
                    {formatDate(factura.fecha)}
                  </div>

                  {/* Resumen financiero */}
                  <div className="grid grid-cols-3 gap-2 sm:gap-4 p-3 bg-muted rounded-lg">
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground">Total</div>
                      <div className="font-bold text-sm sm:text-lg truncate">{formatPrice(factura.total)}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground">Abonado</div>
                      <div className="font-medium text-sm sm:text-lg text-green-600 truncate">
                        {formatPrice(factura.montoAbonado || 0)}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground">Pendiente</div>
                      <div className="font-medium text-sm sm:text-lg text-red-600 truncate">
                        {formatPrice(factura.total - (factura.montoAbonado || 0))}
                      </div>
                    </div>
                  </div>

                  {/* Balance pendiente */}
                  {factura.estadoPago !== "PAGADO" && factura.estadoPago !== "ANULADA" && (
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 border border-dashed rounded-lg">
                      <div>
                        <div className="text-sm text-muted-foreground">Pendiente de pago</div>
                        <div className="text-xl font-bold text-red-600">
                          {formatPrice(pendiente)}
                        </div>
                      </div>
                      <Button
                        onClick={() => setShowPagoForm(showingPagoForm ? null : factura.id)}
                        variant={showingPagoForm ? "outline" : "default"}
                        className="w-full sm:w-auto"
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Registrar Pago
                      </Button>
                    </div>
                  )}

                  {/* Formulario de pago */}
                  {showingPagoForm && (
                    <PagoForm
                      facturaId={factura.id}
                      total={factura.total}
                      montoAbonado={factura.montoAbonado || 0}
                      onClose={() => setShowPagoForm(null)}
                      onSuccess={() => {
                        setShowPagoForm(null)
                        fetchFacturas()
                      }}
                    />
                  )}

                  {/* Historial de pagos */}
                  {factura.pagos && factura.pagos.length > 0 && (
                    <div>
                      <Button
                        variant="ghost"
                        className="w-full justify-between"
                        onClick={() => toggleExpanded(factura.id)}
                      >
                        <span>Historial de pagos ({factura.pagos.length})</span>
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </Button>
                      {isExpanded && <PagosHistorial pagos={factura.pagos} />}
                    </div>
                  )}

                  {/* Acciones de admin */}
                  {isAdmin && factura.estadoPago !== "ANULADA" && (
                    <div className="flex flex-wrap gap-2 pt-3 border-t">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleVoidClick(factura)}
                      >
                        <Ban className="mr-2 h-4 w-4" />
                        Anular
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDeleteClick(factura)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Eliminar
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Dialog de confirmación para eliminar */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Eliminar Factura"
        description={`¿Estás seguro de que deseas eliminar la factura ${selectedFactura?.numeroFactura}? Esta acción eliminará también todos los pagos asociados y no se puede deshacer.`}
        confirmText="Eliminar"
        cancelText="Cancelar"
        variant="danger"
        loading={actionLoading}
        onConfirm={handleDelete}
      />

      {/* Dialog de confirmación para anular */}
      <ConfirmDialog
        open={voidDialogOpen}
        onOpenChange={setVoidDialogOpen}
        title="Anular Factura"
        description={`¿Estás seguro de que deseas anular la factura ${selectedFactura?.numeroFactura}? La factura quedará registrada como anulada pero no se eliminará del sistema.`}
        confirmText="Anular"
        cancelText="Cancelar"
        variant="warning"
        loading={actionLoading}
        onConfirm={handleVoid}
      />
    </div>
  )
}
