"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useModal } from "@/contexts/modal-context"
import { formatDate, formatCurrency } from "@/lib/utils"
import {
  ArrowLeft,
  FileText,
  Shield,
  User,
  Calendar,
  CreditCard,
  Package,
  XCircle,
  Download,
} from "lucide-react"
import Link from "next/link"

interface VentaItem {
  id: string
  inventarioId: string | null
  inventario?: { nombre: string; codigo: string } | null
  descripcion: string
  cantidad: number
  precioUnitario: number
  subtotal: number
  diasGarantia: number
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
  metodoPago: string
  estado: string
  observaciones: string | null
  createdAt: string
}

const metodoPagoLabels: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  TARJETA: "Tarjeta",
}

interface VentaDetailProps {
  ventaId: string
}

export function VentaDetail({ ventaId }: VentaDetailProps) {
  const router = useRouter()
  const { confirm, showError, showSuccess } = useModal()
  const [venta, setVenta] = useState<VentaDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [anulando, setAnulando] = useState(false)

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
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">Venta no encontrada</p>
        <Link href="/ventas">
          <Button variant="link">Volver a ventas</Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">
                Venta V{String(venta.numeroVenta).padStart(4, "0")}
              </h1>
              <Badge variant={venta.estado === "COMPLETADA" ? "success" : "destructive"}>
                {venta.estado === "COMPLETADA" ? "Completada" : "Anulada"}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {formatDate(venta.createdAt)} - {metodoPagoLabels[venta.metodoPago]}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => window.open(`/api/ventas/${ventaId}/pdf`, "_blank")}
          >
            <Download className="mr-2 h-4 w-4" />
            Comprobante
          </Button>
          {venta.estado === "COMPLETADA" && (
            <Button
              variant="destructive"
              onClick={handleAnular}
              disabled={anulando}
            >
              <XCircle className="mr-2 h-4 w-4" />
              {anulando ? "Anulando..." : "Anular"}
            </Button>
          )}
        </div>
      </div>

      {/* Grid de información */}
      <div className="grid gap-6 lg:grid-cols-3">
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
              {formatCurrency(venta.total)}
            </div>
            {venta.descuento > 0 && (
              <div className="text-sm text-muted-foreground">
                Descuento: {formatCurrency(venta.descuento)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Items */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Productos ({venta.items.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
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
                      <td className="py-3 text-right">{formatCurrency(item.precioUnitario)}</td>
                      <td className="py-3 text-right font-medium">{formatCurrency(item.subtotal)}</td>
                      <td className="py-3 text-center">
                        {item.diasGarantia > 0 ? (
                          <Badge variant="outline" className="text-green-600">
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
                  <td className="py-3 text-right">{formatCurrency(venta.subtotal)}</td>
                  <td colSpan={2}></td>
                </tr>
                {venta.descuento > 0 && (
                  <tr>
                    <td colSpan={3} className="py-1 text-right text-destructive">
                      Descuento:
                    </td>
                    <td className="py-1 text-right text-destructive">
                      -{formatCurrency(venta.descuento)}
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                )}
                <tr className="bg-muted/50">
                  <td colSpan={3} className="py-3 text-right text-lg font-bold">
                    Total:
                  </td>
                  <td className="py-3 text-right text-lg font-bold text-primary">
                    {formatCurrency(venta.total)}
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
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
                    className="rounded-lg border bg-green-50 p-4 dark:bg-green-950/20"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="font-mono text-sm font-medium text-green-700 dark:text-green-400">
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
