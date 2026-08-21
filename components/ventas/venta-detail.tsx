"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useModal } from "@/contexts/modal-context"
import { useCurrency } from "@/contexts/currency-context"
import { PaymentStatusBadge } from "@/components/ui/badge"
import {
  ArrowLeft,
  FileText,
  Shield,
  ShoppingCart,
  User,
  Calendar,
  CreditCard,
  Package,
  XCircle,
  Download,
  Pencil,
  Plus,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Banknote,
  ArrowRightLeft,
  Wallet,
  MoreHorizontal,
  RotateCcw,
} from "lucide-react"
import Link from "next/link"
import { EmptyState } from "@/components/ui/empty-state"
import { StatusBanner } from "@/components/ui/status-banner"
import { VentaEstadoBadge } from "@/components/ventas/venta-estado-badge"
import { WhatsAppDialog } from "@/components/ordenes/whatsapp-dialog"
import { VentaEditForm } from "@/components/ventas/venta-edit-form"
import { DevolucionForm } from "@/components/ventas/devolucion-form"
import { PagosHistorial } from "@/components/facturacion/pagos-historial"
import { VentaPagoForm } from "@/components/ventas/venta-pago-form"
import type { MetodoPagoVenta } from "@/lib/notifications/types"

interface VentaItem {
  id: string
  inventarioId: string | null
  inventario?: { nombre: string; codigo: string } | null
  descripcion: string
  cantidad: number
  precioUnitario: number
  subtotal: number
  diasGarantia: number
  descuento: number
  tipoDescuento: "MONTO" | "PORCENTAJE"
  porcentajeDescuento: number
}

interface Garantia {
  id: string
  numeroGarantia: string
  itemVentaId: string
  diasValidez: number
  fechaInicio: string
  fechaVencimiento: string
  estado: string
}

interface Pago {
  id: string
  monto: number
  metodoPago: string
  referencia?: string
  fecha: string
  observaciones?: string
  cuotas?: number | null
  recargoPorcentaje?: number | null
  montoOriginal?: number | null
  costoFinancieroPorcentaje?: number | null
  costoFinancieroMonto?: number | null
}

interface DevolucionItem {
  id: string
  itemVentaId: string
  inventarioId: string | null
  cantidad: number
  precioUnitario: number
  subtotal: number
  restaurarStock: boolean
}

interface Devolucion {
  id: string
  numeroDevolucion: string
  motivo: string
  tipo: string
  montoDevolucion: number
  estado: string
  observaciones: string | null
  items: DevolucionItem[]
  createdAt: string
}

interface VentaDetail {
  id: string
  numeroVenta: number
  clienteId: string | null
  clienteNombre: string
  clienteTelefono: string | null
  vendedor: { id: string; nombre: string; email: string } | null
  items: VentaItem[]
  garantias: Garantia[]
  subtotal: number
  descuento: number
  total: number
  montoAbonado: number
  estadoPago: string
  metodoPago: string
  estado: string
  observaciones: string | null
  createdAt: string
  pagos: Pago[]
  devoluciones?: Devolucion[]
  facturaId: string | null
}

const metodoPagoLabels: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  TARJETA: "Tarjeta",
  TARJETA_DEBITO: "Tarjeta Débito",
  TARJETA_CREDITO: "Tarjeta Crédito",
  MERCADOPAGO: "MercadoPago",
  CUENTA_CORRIENTE: "Cuenta Corriente",
  OTRO: "Otro",
}

interface VentaDetailProps {
  ventaId: string
}

interface Organization {
  id: string
  slug: string
  nombre: string
}

export function VentaDetail({ ventaId }: VentaDetailProps) {
  const router = useRouter()
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === "ADMIN"
  const { formatPrice, formatDate } = useCurrency()
  const { confirm, showError, showSuccess } = useModal()
  const [venta, setVenta] = useState<VentaDetail | null>(null)
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [loading, setLoading] = useState(true)
  const [anulando, setAnulando] = useState(false)
  const [generandoFactura, setGenerandoFactura] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDevolucionModal, setShowDevolucionModal] = useState(false)
  const [showPagoForm, setShowPagoForm] = useState(false)
  const [expandedPagos, setExpandedPagos] = useState(false)

  const fetchOrganization = async () => {
    try {
      const res = await fetch("/api/auth/user-organization")
      if (res.ok) {
        const data = await res.json()
        setOrganization(data.organization)
      }
    } catch (error) {
      console.error("Error fetching organization:", error)
    }
  }

  const fetchVenta = async () => {
    try {
      const res = await fetch(`/api/ventas/${ventaId}`)
      if (!res.ok) {
        if (res.status === 404) {
          router.push("/ventas")
          return
        }
        throw new Error("Error fetching venta")
      }
      const data = await res.json()
      setVenta(data)
    } catch (error) {
      console.error("Error:", error)
      await showError("Error al cargar la venta")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchVenta()
    fetchOrganization()
  }, [ventaId])

  const handleAnular = async () => {
    if (!venta) return

    const confirmed = await confirm({
      title: "Anular Venta",
      description: `¿Estás seguro de anular la venta V${String(venta.numeroVenta).padStart(4, "0")}? El stock será restaurado automáticamente.`,
      confirmText: "Anular",
      cancelText: "Cancelar",
      variant: "danger",
    })

    if (!confirmed) return

    setAnulando(true)
    try {
      const res = await fetch(`/api/ventas/${ventaId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: "ANULADA" }),
      })

      if (!res.ok) {
        const error = await res.json()
        await showError(error.error || "Error al anular la venta")
        return
      }

      await showSuccess("Venta anulada correctamente")
      fetchVenta()
    } catch (error) {
      console.error("Error:", error)
      await showError("Error al anular la venta")
    } finally {
      setAnulando(false)
    }
  }

  const handleGenerarFactura = async () => {
    if (!venta) return
    setGenerandoFactura(true)
    try {
      const res = await fetch("/api/facturacion/generar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ventaId: venta.id }),
      })
      if (!res.ok) {
        const data = await res.json()
        await showError(data.error || "Error al generar el remito")
        return
      }
      await showSuccess("Remito generado correctamente")
      fetchVenta()
    } catch (error) {
      console.error("Error:", error)
      await showError("Error al generar el remito")
    } finally {
      setGenerandoFactura(false)
    }
  }

  const getGarantiaForItem = (itemId: string) => {
    return venta?.garantias.find((g) => g.itemVentaId === itemId)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-muted-foreground">Cargando venta...</div>
      </div>
    )
  }

  if (!venta) {
    return (
      <>
        <EmptyState icon={ShoppingCart} title="Venta no encontrada" variant="error" />
        <Link href="/ventas">
          <Button variant="link">Volver a ventas</Button>
        </Link>
      </>
    )
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="shrink-0" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold sm:text-2xl">
              Venta V{String(venta.numeroVenta).padStart(4, "0")}
            </h1>
            <VentaEstadoBadge estado={venta.estado} />
          </div>
          <p className="text-sm text-muted-foreground">
            {formatDate(venta.createdAt)} - {metodoPagoLabels[venta.metodoPago]}
          </p>
        </div>
      </div>

      {/* Botones de acción - responsive */}
      <div className="flex flex-wrap gap-2">
        {venta.clienteTelefono && (
          <WhatsAppDialog
            context={{
              organizationId: organization?.id || "",
              organizationName: organization?.nombre || "",
              organizationSlug: organization?.slug,
              cliente: {
                id: venta.clienteId || "",
                nombre: venta.clienteNombre,
                telefono: venta.clienteTelefono,
              },
              venta: {
                id: venta.id,
                numeroVenta: venta.numeroVenta,
                total: venta.total,
                metodoPago: venta.metodoPago as MetodoPagoVenta,
                estado: venta.estado as "COMPLETADA" | "ANULADA",
                items: venta.items.map((item) => ({
                  descripcion: item.descripcion,
                  cantidad: item.cantidad,
                  diasGarantia: item.diasGarantia,
                })),
                garantias: venta.garantias.map((g) => ({
                  id: g.id,
                  numeroGarantia: g.numeroGarantia,
                  diasValidez: g.diasValidez,
                  fechaVencimiento: new Date(g.fechaVencimiento),
                })),
              },
            }}
          />
        )}
        <Button
          variant="outline"
          onClick={() => window.open(`/api/ventas/${ventaId}/pdf`, "_blank")}
        >
          <Download className="mr-2 h-4 w-4" />
          Comprobante
        </Button>
        {venta.estado === "COMPLETADA" && (
          <>
            {isAdmin && !venta.facturaId && (
              <Button
                variant="outline"
                onClick={handleGenerarFactura}
                disabled={generandoFactura}
              >
                <FileText className="mr-2 h-4 w-4" />
                {generandoFactura ? "Generando..." : "Generar remito"}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => setShowEditModal(true)}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Editar
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowDevolucionModal(true)}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Devolución
            </Button>
            <Button
              variant="destructive"
              onClick={handleAnular}
              disabled={anulando}
            >
              <XCircle className="mr-2 h-4 w-4" />
              {anulando ? "Anulando..." : "Anular"}
            </Button>
          </>
        )}
      </div>

      {/* Modal de edición */}
      {venta && (
        <VentaEditForm
          open={showEditModal}
          onOpenChange={setShowEditModal}
          venta={{
            id: venta.id,
            numeroVenta: venta.numeroVenta,
            clienteId: venta.clienteId,
            clienteNombre: venta.clienteNombre,
            clienteTelefono: venta.clienteTelefono,
            items: venta.items.map(item => ({
              id: item.id,
              inventarioId: item.inventarioId,
              descripcion: item.descripcion,
              cantidad: item.cantidad,
              precioUnitario: item.precioUnitario,
              diasGarantia: item.diasGarantia,
              descuento: item.descuento,
              tipoDescuento: item.tipoDescuento,
              porcentajeDescuento: item.porcentajeDescuento,
            })),
            descuento: venta.descuento,
            metodoPago: venta.metodoPago,
            observaciones: venta.observaciones,
          }}
          onSuccess={() => {
            fetchVenta()
          }}
        />
      )}

      {/* Modal de devolución */}
      {venta && (
        <DevolucionForm
          open={showDevolucionModal}
          onOpenChange={setShowDevolucionModal}
          venta={{
            id: venta.id,
            numeroVenta: venta.numeroVenta,
            total: venta.total,
            items: venta.items.map(item => ({
              id: item.id,
              inventarioId: item.inventarioId,
              descripcion: item.descripcion,
              cantidad: item.cantidad,
              precioUnitario: item.precioUnitario,
              descuento: item.descuento,
              tipoDescuento: item.tipoDescuento,
              porcentajeDescuento: item.porcentajeDescuento,
            })),
          }}
          onSuccess={() => fetchVenta()}
        />
      )}

      {/* Grid de información */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Cliente */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="h-4 w-4" />
              Cliente
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-medium">{venta.clienteNombre}</div>
            {venta.clienteTelefono && (
              <div className="text-sm text-muted-foreground">{venta.clienteTelefono}</div>
            )}
          </CardContent>
        </Card>

        {/* Vendedor */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="h-4 w-4" />
              Vendedor
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-medium">{venta.vendedor?.nombre || "N/A"}</div>
            {venta.vendedor?.email && (
              <div className="text-sm text-muted-foreground">{venta.vendedor.email}</div>
            )}
          </CardContent>
        </Card>

        {/* Total */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <CreditCard className="h-4 w-4" />
              Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">
              {formatPrice(venta.total)}
            </div>
            {venta.descuento > 0 && (
              <div className="text-sm text-muted-foreground">
                Descuento: {formatPrice(venta.descuento)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Sección de Pagos */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Pagos
            </CardTitle>
            <PaymentStatusBadge status={venta.estadoPago} showIcon />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Resumen financiero */}
          {(() => {
            const totalCostoFinanciero = (venta.pagos || []).reduce(
              (sum: number, p: Pago) => sum + (p.costoFinancieroMonto || 0), 0
            )
            return (
              <>
                <div className="grid grid-cols-3 gap-2 sm:gap-4 p-3 bg-muted rounded-lg">
                  <div>
                    <div className="text-xs text-muted-foreground">Total</div>
                    <div className="font-bold text-base sm:text-lg">{formatPrice(venta.total)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Abonado</div>
                    <div className="font-medium text-base sm:text-lg text-success">
                      {formatPrice(venta.montoAbonado || 0)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Pendiente</div>
                    <div className="font-medium text-base sm:text-lg text-destructive">
                      {formatPrice(venta.total - (venta.montoAbonado || 0))}
                    </div>
                  </div>
                </div>
                {totalCostoFinanciero > 0 && (
                  <div className="flex items-center justify-between p-2 bg-destructive/10 border border-destructive/25 rounded-lg text-sm">
                    <span className="text-muted-foreground">Costo terminales:</span>
                    <span className="text-destructive font-medium">-{formatPrice(totalCostoFinanciero)}</span>
                    <span className="text-muted-foreground">Ingreso real:</span>
                    <span className="font-bold">{formatPrice((venta.montoAbonado || 0) - totalCostoFinanciero)}</span>
                  </div>
                )}
              </>
            )
          })()}

          {/* Botón registrar pago si hay pendiente */}
          {venta.estadoPago !== "PAGADO" && venta.estadoPago !== "ANULADA" && venta.estado !== "ANULADA" && (
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 border border-dashed rounded-lg">
              <div>
                <div className="text-sm text-muted-foreground">Pendiente de pago</div>
                <div className="text-xl font-bold text-destructive">
                  {formatPrice(venta.total - (venta.montoAbonado || 0))}
                </div>
              </div>
              <Button
                onClick={() => setShowPagoForm(!showPagoForm)}
                variant={showPagoForm ? "outline" : "default"}
                className="w-full sm:w-auto"
              >
                <Plus className="mr-2 h-4 w-4" />
                Registrar Pago
              </Button>
            </div>
          )}

          {/* Formulario de pago */}
          {showPagoForm && (
            <VentaPagoForm
              ventaId={venta.id}
              total={venta.total}
              montoAbonado={venta.montoAbonado || 0}
              clienteId={venta.clienteId}
              onClose={() => setShowPagoForm(false)}
              onSuccess={() => {
                setShowPagoForm(false)
                fetchVenta()
              }}
            />
          )}

          {/* Historial de pagos */}
          {venta.pagos && venta.pagos.length > 0 && (
            <div>
              <Button
                variant="ghost"
                className="w-full justify-between"
                onClick={() => setExpandedPagos(!expandedPagos)}
              >
                <span>Historial de pagos ({venta.pagos.length})</span>
                {expandedPagos ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
              {expandedPagos && <PagosHistorial pagos={venta.pagos} />}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Items */}
      <Card>
        <CardHeader className="pb-2 sm:pb-6">
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Productos ({venta.items.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Vista mobile - Cards */}
          <div className="space-y-3 sm:hidden">
            {venta.items.map((item) => {
              const garantia = getGarantiaForItem(item.id)
              return (
                <div key={item.id} className="rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{item.descripcion}</div>
                      {item.inventario && (
                        <div className="text-xs text-muted-foreground">
                          Código: {item.inventario.codigo}
                        </div>
                      )}
                    </div>
                    {item.diasGarantia > 0 && (
                      <Badge variant="outline" className="shrink-0 text-success">
                        {item.diasGarantia}d
                      </Badge>
                    )}
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {item.cantidad} x {formatPrice(item.precioUnitario)}
                    </span>
                    <span className="font-medium">{formatPrice(item.subtotal)}</span>
                  </div>
                  {garantia && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 w-full"
                      onClick={() =>
                        window.open(
                          `/api/ventas/${ventaId}/garantia/${garantia.id}/pdf`,
                          "_blank"
                        )
                      }
                    >
                      <Shield className="mr-1 h-4 w-4" />
                      Certificado
                    </Button>
                  )}
                </div>
              )
            })}
            {/* Totales mobile */}
            <div className="rounded-lg border bg-muted/50 p-3">
              <div className="flex justify-between text-sm">
                <span>Subtotal:</span>
                <span>{formatPrice(venta.subtotal)}</span>
              </div>
              {venta.descuento > 0 && (
                <div className="flex justify-between text-sm text-destructive">
                  <span>Descuento:</span>
                  <span>-{formatPrice(venta.descuento)}</span>
                </div>
              )}
              <div className="mt-2 flex justify-between border-t pt-2 text-lg font-bold">
                <span>Total:</span>
                <span className="text-primary">{formatPrice(venta.total)}</span>
              </div>
            </div>
          </div>

          {/* Vista desktop - Tabla */}
          <div className="hidden sm:block">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left text-sm text-muted-foreground">
                    <th className="pb-2">Producto</th>
                    <th className="pb-2 text-center">Cantidad</th>
                    <th className="pb-2 text-right">Precio Unit.</th>
                    <th className="pb-2 text-right">Subtotal</th>
                    <th className="pb-2 text-center">Garantía</th>
                    <th className="pb-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {venta.items.map((item) => {
                    const garantia = getGarantiaForItem(item.id)
                    return (
                      <tr key={item.id} className="border-b last:border-0">
                        <td className="py-3">
                          <div className="font-medium">{item.descripcion}</div>
                          {item.inventario && (
                            <div className="text-xs text-muted-foreground">
                              Código: {item.inventario.codigo}
                            </div>
                          )}
                        </td>
                        <td className="py-3 text-center">{item.cantidad}</td>
                        <td className="py-3 text-right">{formatPrice(item.precioUnitario)}</td>
                        <td className="py-3 text-right font-medium">{formatPrice(item.subtotal)}</td>
                        <td className="py-3 text-center">
                          {item.diasGarantia > 0 ? (
                            <Badge variant="outline" className="text-success">
                              {item.diasGarantia} días
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className="py-3 text-right">
                          {garantia && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                window.open(
                                  `/api/ventas/${ventaId}/garantia/${garantia.id}/pdf`,
                                  "_blank"
                                )
                              }
                            >
                              <Shield className="mr-1 h-4 w-4" />
                              Certificado
                            </Button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t">
                    <td colSpan={3} className="py-3 text-right font-medium">
                      Subtotal:
                    </td>
                    <td className="py-3 text-right">{formatPrice(venta.subtotal)}</td>
                    <td colSpan={2}></td>
                  </tr>
                  {venta.descuento > 0 && (
                    <tr>
                      <td colSpan={3} className="py-1 text-right text-destructive">
                        Descuento:
                      </td>
                      <td className="py-1 text-right text-destructive">
                        -{formatPrice(venta.descuento)}
                      </td>
                      <td colSpan={2}></td>
                    </tr>
                  )}
                  <tr className="bg-muted/50">
                    <td colSpan={3} className="py-3 text-right text-lg font-bold">
                      Total:
                    </td>
                    <td className="py-3 text-right text-lg font-bold text-primary">
                      {formatPrice(venta.total)}
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Garantías */}
      {venta.garantias.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Certificados de Garantía ({venta.garantias.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {venta.garantias.map((garantia) => {
                const item = venta.items.find((i) => i.id === garantia.itemVentaId)
                return (
                  <div
                    key={garantia.id}
                    className="rounded-lg border bg-success-50 p-4 dark:bg-success/10"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="font-mono text-sm font-medium text-success-700 dark:text-success-500">
                        {garantia.numeroGarantia}
                      </span>
                      <Badge
                        variant={
                          garantia.estado === "ACTIVA"
                            ? "success"
                            : garantia.estado === "VENCIDA"
                            ? "secondary"
                            : "destructive"
                        }
                      >
                        {garantia.estado}
                      </Badge>
                    </div>
                    <div className="text-sm">
                      <p className="font-medium">{item?.descripcion}</p>
                      <p className="text-muted-foreground">
                        Vigencia: {garantia.diasValidez} días
                      </p>
                      <p className="text-muted-foreground">
                        Vence: {formatDate(garantia.fechaVencimiento)}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3 w-full"
                      onClick={() =>
                        window.open(
                          `/api/ventas/${ventaId}/garantia/${garantia.id}/pdf`,
                          "_blank"
                        )
                      }
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Descargar PDF
                    </Button>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Devoluciones */}
      {venta.devoluciones && venta.devoluciones.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5" />
              Devoluciones ({venta.devoluciones.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {venta.devoluciones.map((dev) => (
                <div
                  key={dev.id}
                  className="rounded-lg border p-4 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium">{dev.numeroDevolucion}</span>
                      <Badge variant={dev.tipo === "TOTAL" ? "destructive" : "secondary"}>
                        {dev.tipo}
                      </Badge>
                      <Badge variant={dev.estado === "COMPLETADA" ? "success" : "outline"}>
                        {dev.estado}
                      </Badge>
                    </div>
                    <div className="font-bold text-destructive">
                      -{formatPrice(dev.montoDevolucion)}
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    <span className="font-medium">Motivo:</span> {dev.motivo}
                  </div>
                  {dev.observaciones && (
                    <div className="text-sm text-muted-foreground">
                      {dev.observaciones}
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {formatDate(dev.createdAt)} — {dev.items.length} item(s) devueltos
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        window.open(
                          `/api/ventas/${ventaId}/devolucion/${dev.id}/pdf`,
                          "_blank"
                        )
                      }
                    >
                      <Download className="mr-1 h-3 w-3" />
                      Nota de crédito
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Observaciones */}
      {venta.observaciones && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Observaciones</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">{venta.observaciones}</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
