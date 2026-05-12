"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Plus,
  Edit,
  Archive,
  Phone,
  Mail,
  Globe,
  ExternalLink,
  Search,
  Package,
  ShoppingCart,
  Calendar,
  ArchiveRestore,
  Star,
  Truck,
} from "lucide-react"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"
import { ProveedorForm } from "./proveedor-form"
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
  razonSocial?: string | null
  cuit?: string | null
  condicionIva?: string | null
  ingresosBrutos?: string | null
  condicionPago?: string | null
  diasPago?: number | null
  leadTimeDias?: number | null
  pedidoMinimo?: number | null
  rating?: number | null
  tags?: string[] | null
  logoUrl?: string | null
  createdAt: string
  updatedAt: string
}

interface ProveedorStats {
  productosCount: number
  ordenesCount: number
  totalComprado: number
  ultimaCompra: string | null
}

type StatsMap = Record<string, ProveedorStats>
type SortKey = "nombre" | "totalComprado" | "productos" | "ultimaCompra" | "rating"
type EstadoFilter = "todos" | "activos" | "inactivos"

const fetcher = (url: string) => fetch(url).then(res => res.json())

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })
}

export function ProveedoresList() {
  const { formatPrice } = useCurrency()
  const [showForm, setShowForm] = useState(false)
  const [editingProveedor, setEditingProveedor] = useState<Proveedor | null>(null)
  const [search, setSearch] = useState("")
  const [estadoFilter, setEstadoFilter] = useState<EstadoFilter>("activos")
  const [sortBy, setSortBy] = useState<SortKey>("nombre")
  const [tagFilter, setTagFilter] = useState<string>("__all__")

  const { data: proveedores = [], isLoading: loading, mutate } = useSWR<Proveedor[]>(
    "/api/proveedores", fetcher,
    { revalidateOnFocus: false, dedupingInterval: 5000 }
  )

  const { data: statsMap = {} } = useSWR<StatsMap>(
    "/api/proveedores/stats", fetcher,
    { revalidateOnFocus: false, dedupingInterval: 5000 }
  )

  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const p of proveedores) {
      for (const t of p.tags || []) set.add(t)
    }
    return Array.from(set).sort()
  }, [proveedores])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const out = proveedores.filter((p) => {
      if (estadoFilter === "activos" && !p.activo) return false
      if (estadoFilter === "inactivos" && p.activo) return false
      if (tagFilter !== "__all__" && !(p.tags || []).includes(tagFilter)) return false
      if (q) {
        const hay = `${p.nombre} ${p.razonSocial || ""} ${p.cuit || ""} ${p.telefono || ""} ${p.email || ""} ${p.whatsapp || ""} ${(p.tags || []).join(" ")}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })

    out.sort((a, b) => {
      const sa = statsMap[a.id]
      const sb = statsMap[b.id]
      switch (sortBy) {
        case "totalComprado":
          return (sb?.totalComprado || 0) - (sa?.totalComprado || 0)
        case "productos":
          return (sb?.productosCount || 0) - (sa?.productosCount || 0)
        case "ultimaCompra": {
          const ta = sa?.ultimaCompra ? new Date(sa.ultimaCompra).getTime() : 0
          const tb = sb?.ultimaCompra ? new Date(sb.ultimaCompra).getTime() : 0
          return tb - ta
        }
        case "rating":
          return (b.rating ?? 0) - (a.rating ?? 0)
        case "nombre":
        default:
          return a.nombre.localeCompare(b.nombre, "es")
      }
    })
    return out
  }, [proveedores, statsMap, search, estadoFilter, sortBy, tagFilter])

  const handleToggleActivo = async (id: string, activo: boolean) => {
    await fetch(`/api/proveedores/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo: !activo }),
    })
    mutate()
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center justify-between">
        <div className="flex flex-col sm:flex-row gap-2 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre, email, teléfono..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <Select value={estadoFilter} onValueChange={(v) => setEstadoFilter(v as EstadoFilter)}>
            <SelectTrigger className="w-full sm:w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="activos">Activos</SelectItem>
              <SelectItem value="inactivos">Inactivos</SelectItem>
              <SelectItem value="todos">Todos</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="nombre">Nombre (A-Z)</SelectItem>
              <SelectItem value="totalComprado">Más comprado</SelectItem>
              <SelectItem value="productos">Más productos</SelectItem>
              <SelectItem value="ultimaCompra">Compra reciente</SelectItem>
              <SelectItem value="rating">Mejor rating</SelectItem>
            </SelectContent>
          </Select>
          {allTags.length > 0 && (
            <Select value={tagFilter} onValueChange={setTagFilter}>
              <SelectTrigger className="w-full sm:w-[160px]">
                <SelectValue placeholder="Tag" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos los tags</SelectItem>
                {allTags.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <Button onClick={() => { setEditingProveedor(null); setShowForm(true) }}>
          <Plus className="mr-2 h-4 w-4" />
          Nuevo Proveedor
        </Button>
      </div>

      {showForm && (
        <ProveedorForm
          proveedor={editingProveedor}
          onClose={() => {
            setShowForm(false)
            setEditingProveedor(null)
          }}
          onSuccess={() => {
            setShowForm(false)
            setEditingProveedor(null)
            mutate()
          }}
        />
      )}

      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Cargando...</div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            {proveedores.length === 0 ? (
              <>
                <div className="mx-auto h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                  <Package className="h-8 w-8 text-primary" />
                </div>
                <div className="space-y-1">
                  <h3 className="font-semibold text-base">Empezá a registrar tus proveedores</h3>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                    Llevá un control de contactos, precios, condiciones de pago y órdenes de compra. Vinculá items de inventario y compará precios entre proveedores.
                  </p>
                </div>
                <div className="flex gap-2 justify-center flex-wrap pt-2">
                  <Button onClick={() => { setEditingProveedor(null); setShowForm(true) }}>
                    <Plus className="mr-2 h-4 w-4" />
                    Crear primer proveedor
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground pt-2">
                  Tip: cargá el CUIT y condición IVA para facturación A.
                </p>
              </>
            ) : (
              <>
                <div className="mx-auto h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                  <Search className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="space-y-1">
                  <h3 className="font-semibold text-sm">Sin resultados</h3>
                  <p className="text-xs text-muted-foreground">
                    Ningún proveedor coincide con los filtros aplicados.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSearch("")
                    setEstadoFilter("todos")
                    setTagFilter("__all__")
                  }}
                >
                  Limpiar filtros
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((proveedor) => {
            const s = statsMap[proveedor.id]
            return (
              <Card key={proveedor.id} className={!proveedor.activo ? "opacity-60" : ""}>
                <CardHeader className="p-3 sm:p-4 pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/proveedores/${proveedor.id}`}
                      className="flex items-start gap-2 flex-1 min-w-0 group"
                    >
                      <div className="h-10 w-10 rounded-md border bg-muted/30 flex items-center justify-center overflow-hidden shrink-0">
                        {proveedor.logoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={proveedor.logoUrl} alt={proveedor.nombre} className="h-full w-full object-contain" />
                        ) : (
                          <Package className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                      <CardTitle className="text-sm sm:text-base flex items-center gap-2 group-hover:text-primary transition-colors">
                        <span className="truncate">{proveedor.nombre}</span>
                        {!proveedor.activo && (
                          <Badge variant="secondary" className="text-[10px] shrink-0">Inactivo</Badge>
                        )}
                      </CardTitle>
                      <div className="flex items-center gap-2 flex-wrap mt-0.5">
                        {proveedor.rating != null && (
                          <span className="flex items-center gap-0.5">
                            {[1, 2, 3, 4, 5].map((n) => (
                              <Star
                                key={n}
                                className={`h-3 w-3 ${n <= proveedor.rating! ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30"}`}
                              />
                            ))}
                          </span>
                        )}
                        {proveedor.cuit && (
                          <span className="text-[11px] text-muted-foreground font-mono">
                            {proveedor.cuit}
                          </span>
                        )}
                        {proveedor.leadTimeDias != null && (
                          <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
                            <Truck className="h-3 w-3" />
                            {proveedor.leadTimeDias}d
                          </span>
                        )}
                      </div>
                      {proveedor.tags && proveedor.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {proveedor.tags.slice(0, 4).map((t) => (
                            <Badge key={t} variant="outline" className="text-[9px] px-1 py-0">
                              {t}
                            </Badge>
                          ))}
                          {proveedor.tags.length > 4 && (
                            <span className="text-[10px] text-muted-foreground">+{proveedor.tags.length - 4}</span>
                          )}
                        </div>
                      )}
                      </div>
                    </Link>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        asChild
                        title="Nueva orden de compra"
                      >
                        <Link href={`/ordenes-compra?nueva=1&proveedorId=${proveedor.id}`}>
                          <ShoppingCart className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => {
                          setEditingProveedor(proveedor)
                          setShowForm(true)
                        }}
                        title="Editar"
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleToggleActivo(proveedor.id, proveedor.activo)}
                        title={proveedor.activo ? "Archivar" : "Reactivar"}
                      >
                        {proveedor.activo ? (
                          <Archive className="h-3.5 w-3.5" />
                        ) : (
                          <ArchiveRestore className="h-3.5 w-3.5 text-emerald-600" />
                        )}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-3 sm:p-4 pt-0 space-y-3">
                  {/* KPIs */}
                  <Link
                    href={`/proveedores/${proveedor.id}`}
                    className="grid grid-cols-3 gap-1 -mx-1 px-1 py-2 rounded-md hover:bg-muted/50 transition-colors"
                  >
                    <Kpi
                      icon={<Package className="h-3 w-3" />}
                      label="Items"
                      value={s ? s.productosCount.toLocaleString("es-AR") : "—"}
                    />
                    <Kpi
                      icon={<ShoppingCart className="h-3 w-3" />}
                      label="Comprado"
                      value={s ? formatPrice(s.totalComprado) : "—"}
                    />
                    <Kpi
                      icon={<Calendar className="h-3 w-3" />}
                      label="Última"
                      value={s?.ultimaCompra ? formatDate(s.ultimaCompra) : "—"}
                    />
                  </Link>

                  {/* Contacto compacto */}
                  <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs">
                    {proveedor.telefono && (
                      <a
                        href={`tel:${proveedor.telefono}`}
                        className="flex items-center gap-1 hover:text-primary"
                      >
                        <Phone className="h-3 w-3 text-muted-foreground" />
                        {proveedor.telefono}
                      </a>
                    )}
                    {proveedor.whatsapp && (
                      <a
                        href={`https://wa.me/${proveedor.whatsapp}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-green-600 hover:text-green-700"
                      >
                        <WhatsAppIcon className="h-3 w-3" />
                        WhatsApp
                      </a>
                    )}
                    {proveedor.email && (
                      <a
                        href={`mailto:${proveedor.email}`}
                        className="flex items-center gap-1 hover:text-primary min-w-0 max-w-full"
                      >
                        <Mail className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="truncate">{proveedor.email}</span>
                      </a>
                    )}
                    {proveedor.website && (
                      <a
                        href={proveedor.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-primary hover:underline"
                      >
                        <Globe className="h-3 w-3" />
                        Web
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                    {!proveedor.telefono && !proveedor.whatsapp && !proveedor.email && !proveedor.website && (
                      <span className="text-muted-foreground italic">Sin datos de contacto</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Kpi({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="text-xs font-semibold truncate">{value}</div>
    </div>
  )
}
