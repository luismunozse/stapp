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
  Trash2,
  Phone,
  Mail,
  Globe,
  ExternalLink,
  Search,
  Package,
  ShoppingCart,
  Calendar,
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

interface ProveedorStats {
  productosCount: number
  ordenesCount: number
  totalComprado: number
  ultimaCompra: string | null
}

type StatsMap = Record<string, ProveedorStats>
type SortKey = "nombre" | "totalComprado" | "productos" | "ultimaCompra"
type EstadoFilter = "todos" | "activos" | "inactivos"

const fetcher = (url: string) => fetch(url).then(res => res.json())

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })
}

export function ProveedoresList() {
  const { confirm } = useModal()
  const { formatPrice } = useCurrency()
  const [showForm, setShowForm] = useState(false)
  const [editingProveedor, setEditingProveedor] = useState<Proveedor | null>(null)
  const [search, setSearch] = useState("")
  const [estadoFilter, setEstadoFilter] = useState<EstadoFilter>("activos")
  const [sortBy, setSortBy] = useState<SortKey>("nombre")

  const { data: proveedores = [], isLoading: loading, mutate } = useSWR<Proveedor[]>(
    "/api/proveedores", fetcher,
    { revalidateOnFocus: false, dedupingInterval: 5000 }
  )

  const { data: statsMap = {} } = useSWR<StatsMap>(
    "/api/proveedores/stats", fetcher,
    { revalidateOnFocus: false, dedupingInterval: 5000 }
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const out = proveedores.filter((p) => {
      if (estadoFilter === "activos" && !p.activo) return false
      if (estadoFilter === "inactivos" && p.activo) return false
      if (q) {
        const hay = `${p.nombre} ${p.telefono || ""} ${p.email || ""} ${p.whatsapp || ""}`.toLowerCase()
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
        case "nombre":
        default:
          return a.nombre.localeCompare(b.nombre, "es")
      }
    })
    return out
  }, [proveedores, statsMap, search, estadoFilter, sortBy])

  const handleDelete = async (id: string, nombre: string) => {
    const s = statsMap[id]
    const refs = (s?.productosCount || 0) + (s?.ordenesCount || 0)
    const confirmed = await confirm({
      title: "Eliminar proveedor",
      description: refs > 0
        ? `"${nombre}" tiene ${s?.productosCount || 0} productos y ${s?.ordenesCount || 0} órdenes asociadas. ¿Eliminar igualmente?`
        : `¿Eliminar "${nombre}"? Esta acción no se puede deshacer.`,
      confirmText: "Eliminar",
      variant: "danger",
    })
    if (!confirmed) return
    const res = await fetch(`/api/proveedores/${id}`, { method: "DELETE" })
    if (res.ok) mutate()
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
            </SelectContent>
          </Select>
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
          <CardContent className="py-8 text-center text-muted-foreground">
            {proveedores.length === 0
              ? "No hay proveedores registrados. Agregá uno para comenzar."
              : "Sin resultados con los filtros aplicados."}
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
                      className="flex-1 min-w-0 group"
                    >
                      <CardTitle className="text-sm sm:text-base flex items-center gap-2 group-hover:text-primary transition-colors">
                        <span className="truncate">{proveedor.nombre}</span>
                        {!proveedor.activo && (
                          <Badge variant="secondary" className="text-[10px] shrink-0">Inactivo</Badge>
                        )}
                      </CardTitle>
                    </Link>
                    <div className="flex gap-1 shrink-0">
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
                        onClick={() => handleDelete(proveedor.id, proveedor.nombre)}
                        title="Eliminar"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
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
