"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ArrowLeft,
  Edit,
  Trash2,
  Phone,
  Mail,
  MapPin,
  Globe,
  ExternalLink,
  Package,
  ShoppingCart,
  DollarSign,
  Calendar,
  Plus,
  AlertTriangle,
} from "lucide-react"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"
import { ProveedorForm } from "./proveedor-form"
import { useModal } from "@/contexts/modal-context"
import { useCurrency } from "@/contexts/currency-context"

interface Proveedor {
  id: string
  nombre: string
  telefono?: string | null
  whatsapp?: string | null
  email?: string | null
  direccion?: string | null
  website?: string | null
  notas?: string | null
  activo: boolean
  createdAt: string
  updatedAt: string
}

interface Stats {
  productosCount: number
  valorCostoStock: number
  valorVentaStock: number
  itemsSinStock: number
  itemsBajoStock: number
  ordenesCount: number
  ordenesAbiertas: number
  totalComprado: number
  ultimaCompra: string | null
}

interface InventarioItem {
  id: string
  codigo: string
  nombre: string
  stock: number
  precioCompra?: number | null
  precioVenta?: number | null
  stockMinimo?: number | null
}

interface OrdenCompra {
  id: string
  numeroOC: string
  estado: string
  fechaEmision: string
  fechaRecepcionEsperada?: string | null
  total: number
}

const fetcher = (url: string) => fetch(url).then(r => r.json())

const ESTADO_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  BORRADOR: { label: "Borrador", variant: "outline" },
  ENVIADA: { label: "Enviada", variant: "secondary" },
  RECIBIDA_PARCIAL: { label: "Parcial", variant: "secondary" },
  RECIBIDA: { label: "Recibida", variant: "default" },
  CANCELADA: { label: "Cancelada", variant: "destructive" },
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })
}

export function ProveedorDetail({ proveedorId }: { proveedorId: string }) {
  const router = useRouter()
  const { confirm } = useModal()
  const { formatPrice } = useCurrency()
  const [editing, setEditing] = useState(false)

  const { data: proveedor, mutate: mutateProv, isLoading } = useSWR<Proveedor>(
    `/api/proveedores/${proveedorId}`,
    fetcher,
    { revalidateOnFocus: false }
  )
  const { data: stats } = useSWR<Stats>(
    `/api/proveedores/${proveedorId}/stats`,
    fetcher,
    { revalidateOnFocus: false }
  )
  const { data: inventarioResp } = useSWR<{ data: InventarioItem[] } | InventarioItem[]>(
    `/api/inventario?proveedorId=${proveedorId}&limit=100`,
    fetcher,
    { revalidateOnFocus: false }
  )
  const inventario: InventarioItem[] = Array.isArray(inventarioResp)
    ? inventarioResp
    : inventarioResp?.data || []

  const { data: ocResp } = useSWR<{ data: OrdenCompra[] }>(
    `/api/ordenes-compra?proveedorId=${proveedorId}&limit=20`,
    fetcher,
    { revalidateOnFocus: false }
  )
  const ordenes: OrdenCompra[] = ocResp?.data || []

  const handleDelete = async () => {
    if (!proveedor) return
    const ok = await confirm({
      title: "Eliminar proveedor",
      description:
        (stats?.productosCount || 0) + (stats?.ordenesCount || 0) > 0
          ? `Este proveedor tiene ${stats?.productosCount || 0} productos y ${stats?.ordenesCount || 0} órdenes asociadas. ¿Eliminar igualmente?`
          : "¿Estás seguro de eliminar este proveedor?",
      confirmText: "Eliminar",
      variant: "danger",
    })
    if (!ok) return
    const res = await fetch(`/api/proveedores/${proveedorId}`, { method: "DELETE" })
    if (res.ok) router.push("/proveedores")
  }

  const handleToggleActivo = async () => {
    if (!proveedor) return
    await fetch(`/api/proveedores/${proveedorId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo: !proveedor.activo }),
    })
    mutateProv()
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  if (!proveedor) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Proveedor no encontrado.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/proveedores"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold truncate">{proveedor.nombre}</h1>
              {!proveedor.activo && <Badge variant="secondary">Inactivo</Badge>}
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Alta: {formatDate(proveedor.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Edit className="h-4 w-4 mr-2" />Editar
          </Button>
          <Button variant="outline" size="sm" onClick={handleToggleActivo}>
            {proveedor.activo ? "Archivar" : "Reactivar"}
          </Button>
          <Button variant="outline" size="sm" onClick={handleDelete}>
            <Trash2 className="h-4 w-4 mr-2 text-destructive" />Eliminar
          </Button>
        </div>
      </div>

      {editing && (
        <ProveedorForm
          proveedor={proveedor}
          onClose={() => setEditing(false)}
          onSuccess={() => {
            setEditing(false)
            mutateProv()
          }}
        />
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icon={<Package className="h-4 w-4" />}
          label="Productos"
          value={stats?.productosCount.toLocaleString("es-AR") ?? "—"}
          sub={
            stats && (stats.itemsSinStock > 0 || stats.itemsBajoStock > 0) ? (
              <span className="flex items-center gap-1 text-amber-600 text-[11px]">
                <AlertTriangle className="h-3 w-3" />
                {stats.itemsSinStock > 0 && `${stats.itemsSinStock} sin stock`}
                {stats.itemsSinStock > 0 && stats.itemsBajoStock > 0 && " · "}
                {stats.itemsBajoStock > 0 && `${stats.itemsBajoStock} bajo stock`}
              </span>
            ) : null
          }
        />
        <KpiCard
          icon={<DollarSign className="h-4 w-4" />}
          label="Total comprado"
          value={stats ? formatPrice(stats.totalComprado) : "—"}
        />
        <KpiCard
          icon={<ShoppingCart className="h-4 w-4" />}
          label="Órdenes de compra"
          value={stats?.ordenesCount.toLocaleString("es-AR") ?? "—"}
          sub={stats && stats.ordenesAbiertas > 0 ? `${stats.ordenesAbiertas} abiertas` : null}
        />
        <KpiCard
          icon={<Calendar className="h-4 w-4" />}
          label="Última compra"
          value={stats?.ultimaCompra ? formatDate(stats.ultimaCompra) : "—"}
        />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="info">
        <TabsList>
          <TabsTrigger value="info">Información</TabsTrigger>
          <TabsTrigger value="productos">Productos ({stats?.productosCount ?? 0})</TabsTrigger>
          <TabsTrigger value="ordenes">Órdenes de compra ({stats?.ordenesCount ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="space-y-4">
          <Card>
            <CardContent className="p-4 sm:p-6 space-y-3">
              <h3 className="font-semibold text-sm">Contacto</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {proveedor.telefono && (
                  <a href={`tel:${proveedor.telefono}`} className="flex items-center gap-2 text-sm hover:text-primary">
                    <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                    {proveedor.telefono}
                  </a>
                )}
                {proveedor.whatsapp && (
                  <a
                    href={`https://wa.me/${proveedor.whatsapp}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-green-600 hover:text-green-700"
                  >
                    <WhatsAppIcon className="h-4 w-4 shrink-0" />
                    {proveedor.whatsapp}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {proveedor.email && (
                  <a href={`mailto:${proveedor.email}`} className="flex items-center gap-2 text-sm hover:text-primary min-w-0">
                    <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="truncate">{proveedor.email}</span>
                  </a>
                )}
                {proveedor.website && (
                  <a
                    href={proveedor.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-primary hover:underline min-w-0"
                  >
                    <Globe className="h-4 w-4 shrink-0" />
                    <span className="truncate">{proveedor.website}</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                )}
                {proveedor.direccion && (
                  <div className="flex items-start gap-2 text-sm sm:col-span-2">
                    <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    {proveedor.direccion}
                  </div>
                )}
              </div>
              {!proveedor.telefono && !proveedor.whatsapp && !proveedor.email && !proveedor.website && !proveedor.direccion && (
                <p className="text-sm text-muted-foreground italic">Sin datos de contacto</p>
              )}
            </CardContent>
          </Card>

          {proveedor.notas && (
            <Card>
              <CardContent className="p-4 sm:p-6">
                <h3 className="font-semibold text-sm mb-2">Notas</h3>
                <p className="text-sm whitespace-pre-wrap text-muted-foreground">{proveedor.notas}</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-4 sm:p-6">
              <h3 className="font-semibold text-sm mb-3">Valor del stock asociado</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-muted-foreground text-xs uppercase tracking-wide">A costo</div>
                  <div className="font-semibold">{stats ? formatPrice(stats.valorCostoStock) : "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs uppercase tracking-wide">A venta</div>
                  <div className="font-semibold text-emerald-600">{stats ? formatPrice(stats.valorVentaStock) : "—"}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="productos">
          <Card>
            <CardContent className="p-0">
              {inventario.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No hay productos asociados a este proveedor.
                </div>
              ) : (
                <div className="divide-y">
                  {inventario.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-2 p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate">{item.nombre}</div>
                        <div className="text-xs text-muted-foreground">{item.codigo}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm">
                          Stock: <span className={item.stock === 0 ? "text-destructive font-semibold" : "font-semibold"}>{item.stock}</span>
                        </div>
                        {item.precioCompra != null && (
                          <div className="text-xs text-muted-foreground">{formatPrice(item.precioCompra)}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <div className="mt-3 text-right">
            <Button variant="outline" size="sm" asChild>
              <Link href="/inventario">Ver inventario</Link>
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="ordenes">
          <Card>
            <CardContent className="p-0">
              {ordenes.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  Sin órdenes de compra registradas.
                </div>
              ) : (
                <div className="divide-y">
                  {ordenes.map((oc) => {
                    const badge = ESTADO_BADGE[oc.estado] || { label: oc.estado, variant: "outline" as const }
                    return (
                      <div
                        key={oc.id}
                        className="flex items-center justify-between gap-2 p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{oc.numeroOC}</span>
                            <Badge variant={badge.variant} className="text-[10px]">{badge.label}</Badge>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Emisión: {formatDate(oc.fechaEmision)}
                          </div>
                        </div>
                        <div className="text-sm font-semibold shrink-0">{formatPrice(oc.total)}</div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/ordenes-compra`}>
                Ver todas
              </Link>
            </Button>
            <Button size="sm" asChild>
              <Link href={`/ordenes-compra`}>
                <Plus className="h-4 w-4 mr-1" />Nueva OC
              </Link>
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function KpiCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-[11px] uppercase tracking-wide">
          {icon}
          {label}
        </div>
        <div className="mt-1 text-base sm:text-lg font-semibold truncate">{value}</div>
        {sub && <div className="text-xs mt-1">{sub}</div>}
      </CardContent>
    </Card>
  )
}
