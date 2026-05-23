"use client"

import { useState, useEffect, use } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  ArrowLeft,
  TrendingUp,
  Mail,
  Calendar,
  ShoppingCart,
  CheckCircle,
  DollarSign,
  Edit,
  Trash2,
  Wallet,
  BadgePercent,
} from "lucide-react"
import { VendedorForm } from "@/components/vendedores/vendedor-form"
import { LiquidarComisionesDialog } from "@/components/vendedores/liquidar-comisiones-dialog"
import { useModal } from "@/contexts/modal-context"

interface Venta {
  id: string
  total: string
  estado: string
  fecha: string
}

interface VendedorDetalle {
  id: string
  nombre: string
  email: string
  telefono: string | null
  activo: boolean
  porcentajeComision: number
  createdAt: string
  ventasCompletadas: number
  ventasTotal: number
  montoTotalVentas: number
  comisionDevengada: number
  comisionPagada: number
  comisionPendiente: number
  ventas: Venta[]
}

const estadoVentaColors: Record<string, string> = {
  COMPLETADA: "bg-green-100 text-green-800",
  ANULADA: "bg-red-100 text-red-800",
}

const estadoVentaLabels: Record<string, string> = {
  COMPLETADA: "Completada",
  ANULADA: "Anulada",
}

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

export default function VendedorDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === "ADMIN"
  const { confirm, showError } = useModal()
  const [vendedor, setVendedor] = useState<VendedorDetalle | null>(null)
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(false)
  const [liquidarOpen, setLiquidarOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    fetchVendedor()
  }, [id])

  const fetchVendedor = async () => {
    try {
      const res = await fetch(`/api/vendedores/${id}`)
      if (!res.ok) {
        router.push("/vendedores")
        return
      }
      const data = await res.json()
      setVendedor(data)
    } catch (error) {
      console.error("Error fetching vendedor:", error)
      router.push("/vendedores")
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (vendedor && vendedor.ventasTotal > 0) {
      await showError(`No se puede eliminar un vendedor con ${vendedor.ventasTotal} venta(s) asociada(s). Reasigne las ventas primero.`)
      return
    }

    const confirmed = await confirm({
      title: "Eliminar Vendedor",
      description: "¿Estás seguro de eliminar este vendedor? Esta acción no se puede deshacer.",
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      variant: "danger",
    })

    if (!confirmed) return

    setDeleting(true)
    try {
      const res = await fetch(`/api/vendedores/${id}`, { method: "DELETE" })
      if (res.ok) {
        router.push("/vendedores")
      } else {
        const data = await res.json()
        await showError(data.error || "Error al eliminar")
      }
    } catch (error) {
      console.error("Error deleting vendedor:", error)
      await showError("Error al eliminar vendedor")
    } finally {
      setDeleting(false)
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
      minimumFractionDigits: 0,
    }).format(amount)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (!vendedor) {
    return null
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3 sm:gap-4">
          <Button variant="ghost" size="icon" asChild className="shrink-0">
            <Link href="/vendedores">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-3xl font-bold truncate">{vendedor.nombre}</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">Detalle del vendedor</p>
          </div>
        </div>
        {isAdmin && (
          <div className="flex gap-2 pl-12 sm:pl-0">
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Edit className="mr-1.5 h-4 w-4" />
              Editar
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={deleting || vendedor.ventasTotal > 0}
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              <span className="hidden sm:inline">{deleting ? "Eliminando..." : "Eliminar"}</span>
              <span className="sm:hidden">{deleting ? "..." : "Eliminar"}</span>
            </Button>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid gap-3 sm:gap-6 grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="p-3 sm:p-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
              Información
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0 space-y-2 sm:space-y-3">
            <div className="flex items-center gap-2 min-w-0">
              <TrendingUp className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground shrink-0" />
              <span className="text-xs sm:text-sm truncate">{vendedor.nombre}</span>
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <Mail className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground shrink-0" />
              <span className="text-xs sm:text-sm truncate">{vendedor.email}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground shrink-0" />
              <span className="text-xs sm:text-sm">Desde {formatDate(vendedor.createdAt)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-3 sm:p-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground flex items-center gap-1.5 sm:gap-2">
              <ShoppingCart className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Total Ventas</span>
              <span className="sm:hidden">Ventas</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className="text-xl sm:text-3xl font-bold">{vendedor.ventasTotal}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-3 sm:p-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground flex items-center gap-1.5 sm:gap-2">
              <CheckCircle className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span>Completadas</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className="text-xl sm:text-3xl font-bold text-green-600">{vendedor.ventasCompletadas}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-3 sm:p-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground flex items-center gap-1.5 sm:gap-2">
              <DollarSign className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Monto Total</span>
              <span className="sm:hidden">Monto</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className="text-lg sm:text-2xl font-bold text-primary">
              {formatCurrency(vendedor.montoTotalVentas)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Comisiones */}
      <div className="grid gap-3 sm:gap-6 grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="p-3 sm:p-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground flex items-center gap-1.5 sm:gap-2">
              <BadgePercent className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span>Comisión actual</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className="text-lg sm:text-2xl font-bold">
              {vendedor.porcentajeComision}%
            </div>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
              Sobre el total de cada venta
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-3 sm:p-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground flex items-center gap-1.5 sm:gap-2">
              <Wallet className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span>Devengada</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className="text-lg sm:text-2xl font-bold">
              {formatCurrency(vendedor.comisionDevengada)}
            </div>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
              Ventas completadas
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-3 sm:p-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground flex items-center gap-1.5 sm:gap-2">
              <CheckCircle className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span>Pagada</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className="text-lg sm:text-2xl font-bold text-green-600">
              {formatCurrency(vendedor.comisionPagada)}
            </div>
          </CardContent>
        </Card>

        <Card className={vendedor.comisionPendiente > 0 ? "border-amber-300 dark:border-amber-800" : undefined}>
          <CardHeader className="p-3 sm:p-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground flex items-center gap-1.5 sm:gap-2">
              <DollarSign className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span>Pendiente</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0 space-y-2">
            <div className={`text-lg sm:text-2xl font-bold ${vendedor.comisionPendiente > 0 ? "text-amber-600" : "text-muted-foreground"}`}>
              {formatCurrency(vendedor.comisionPendiente)}
            </div>
            {isAdmin && vendedor.comisionPendiente > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="w-full h-7 text-xs"
                onClick={() => setLiquidarOpen(true)}
              >
                Liquidar
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Historial de Ventas */}
      <Card>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="text-base sm:text-lg">Historial de Ventas</CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0">
          {vendedor.ventas.length === 0 ? (
            <p className="text-center text-muted-foreground py-6 sm:py-8 text-sm">
              No hay ventas registradas para este vendedor
            </p>
          ) : (
            <div className="space-y-2 sm:space-y-3">
              {vendedor.ventas.map((venta) => (
                <Link
                  key={venta.id}
                  href={`/ventas/${venta.id}`}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 sm:p-4 border rounded-lg hover:bg-muted/50 transition-colors gap-2"
                >
                  <div className="flex items-center gap-2 sm:gap-4 min-w-0">
                    <ShoppingCart className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium text-sm">
                        {formatCurrency(parseFloat(venta.total || "0"))}
                      </div>
                      <div className="text-xs sm:text-sm text-muted-foreground">
                        {formatDate(venta.fecha)}
                      </div>
                    </div>
                  </div>
                  <Badge className={`text-[10px] sm:text-xs w-fit ${estadoVentaColors[venta.estado] || "bg-gray-100 text-gray-800"}`}>
                    {estadoVentaLabels[venta.estado] || venta.estado}
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <VendedorForm
        open={editOpen}
        onOpenChange={setEditOpen}
        vendedor={vendedor}
        onSuccess={fetchVendedor}
      />

      <LiquidarComisionesDialog
        open={liquidarOpen}
        onOpenChange={setLiquidarOpen}
        vendedorId={vendedor.id}
        vendedorNombre={vendedor.nombre}
        onLiquidated={fetchVendedor}
      />
    </div>
  )
}
