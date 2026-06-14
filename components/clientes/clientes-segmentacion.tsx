"use client"

import { useState } from "react"
import useSWR from "swr"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Star,
  RefreshCw,
  UserCheck,
  Sparkles,
  UserX,
  AlertTriangle,
  Users,
  BarChart3,
  CheckCircle,
} from "lucide-react"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"
import { EmptyState } from "@/components/ui/empty-state"
import { useCurrency } from "@/contexts/currency-context"
import { formatPhoneForWhatsApp } from "@/lib/notifications/whatsapp-templates"

const fetcher = (url: string) => fetch(url).then(res => res.json())

const SEGMENT_CONFIG = {
  VIP: { label: "VIP", icon: Star, color: "bg-primary/10 text-primary border-primary/20" },
  FRECUENTE: { label: "Frecuente", icon: RefreshCw, color: "bg-info-50 text-info-700 dark:bg-info/15 border-info-200" },
  REGULAR: { label: "Regular", icon: UserCheck, color: "bg-success-50 text-success-700 dark:bg-success/15 border-success-200" },
  NUEVO: { label: "Nuevo", icon: Sparkles, color: "bg-info-50 text-info-600 dark:bg-info/10 border-info-200" },
  INACTIVO: { label: "Inactivo", icon: UserX, color: "bg-muted text-muted-foreground border-border" },
} as const

type SegmentKey = keyof typeof SEGMENT_CONFIG

const TABS = [
  { id: "top", label: "Top Clientes", icon: Star },
  { id: "riesgo", label: "En Riesgo", icon: AlertTriangle },
  { id: "adquisicion", label: "Adquisición", icon: Users },
  { id: "frecuencia", label: "Frecuencia", icon: BarChart3 },
] as const

type TabId = typeof TABS[number]["id"]

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ClientesSegmentacion({ open, onOpenChange }: Props) {
  const { formatPrice, formatDate, pais } = useCurrency()
  const [activeTab, setActiveTab] = useState<TabId>("top")
  const [selectedSegment, setSelectedSegment] = useState<SegmentKey | null>(null)

  const { data, isLoading } = useSWR(
    open ? "/api/reportes/clientes-analytics" : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000 }
  )

  const formatWhatsAppLink = (telefono: string) => {
    const formattedPhone = formatPhoneForWhatsApp(telefono, pais)
    return `https://wa.me/${formattedPhone}`
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-1rem)] sm:max-w-5xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Segmentación de Clientes</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-4">
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
              {[...Array(5)].map((_, i) => (
                <Card key={i}><CardContent className="p-3"><div className="h-12 bg-muted animate-pulse rounded" /></CardContent></Card>
              ))}
            </div>
            <div className="h-48 bg-muted animate-pulse rounded" />
          </div>
        ) : !data || data.error ? (
          <EmptyState icon={AlertTriangle} title="Error al cargar datos" variant="error" />
        ) : (
          <div className="space-y-4">
            {/* Segment Cards */}
            <div className="grid gap-2 grid-cols-2 lg:grid-cols-5">
              {(Object.entries(SEGMENT_CONFIG) as [SegmentKey, typeof SEGMENT_CONFIG[SegmentKey]][]).map(([key, config]) => {
                const Icon = config.icon
                const seg = data.segmentacion[key] || { count: 0, totalGastado: 0 }
                const isSelected = selectedSegment === key
                return (
                  <Card
                    key={key}
                    className={`cursor-pointer transition-all ${config.color} ${
                      isSelected ? "ring-2 ring-primary" : "hover:shadow-md"
                    }`}
                    onClick={() => setSelectedSegment(isSelected ? null : key)}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Icon className="h-3.5 w-3.5" />
                        <span className="text-xs font-semibold">{config.label}</span>
                      </div>
                      <div className="text-lg font-bold">{seg.count}</div>
                      <div className="text-[10px] opacity-75">{formatPrice(seg.totalGastado)}</div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>

            {/* Selected Segment Detail */}
            {selectedSegment && data.segmentacion[selectedSegment]?.clientes?.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">
                    Clientes {SEGMENT_CONFIG[selectedSegment].label} (Top 10)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1.5">
                    {data.segmentacion[selectedSegment].clientes.map((c: any, i: number) => (
                      <div key={c.id} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-4">{i + 1}</span>
                          <span className="font-medium">{c.nombre}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="text-muted-foreground">{c.totalCompras} compras</span>
                          <span className="font-medium">{formatPrice(c.totalGastado)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Tabs */}
            <div className="flex gap-1 border-b pb-1 overflow-x-auto scrollbar-hide">
              {TABS.map(tab => {
                const Icon = tab.icon
                return (
                  <Button
                    key={tab.id}
                    variant={activeTab === tab.id ? "default" : "ghost"}
                    size="sm"
                    className="text-xs gap-1.5 whitespace-nowrap shrink-0"
                    onClick={() => setActiveTab(tab.id)}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tab.label}
                    {tab.id === "riesgo" && data.clientesEnRiesgo?.length > 0 && (
                      <Badge variant="destructive" className="text-[9px] px-1 py-0 h-4 ml-1">
                        {data.clientesEnRiesgo.length}
                      </Badge>
                    )}
                  </Button>
                )
              })}
            </div>

            {/* Tab: Top Clientes */}
            {activeTab === "top" && (
              <div>
                {data.topClientes.length === 0 ? (
                  <EmptyState icon={Users} title="Sin datos" variant="search" />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="pb-2 pr-2">#</th>
                          <th className="pb-2 pr-2">Cliente</th>
                          <th className="pb-2 pr-2 text-right">Compras</th>
                          <th className="pb-2 pr-2 text-right">Total</th>
                          <th className="pb-2 pr-2 text-right">Ticket Prom.</th>
                          <th className="pb-2 text-right">Última Compra</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.topClientes.map((c: any, i: number) => (
                          <tr key={c.id} className="border-b last:border-0">
                            <td className="py-2 pr-2">
                              <span className={`text-xs font-bold ${
                                i === 0 ? "text-warning" : i === 1 ? "text-muted-foreground" : i === 2 ? "text-warning-700" : "text-muted-foreground"
                              }`}>
                                {i + 1}
                              </span>
                            </td>
                            <td className="py-2 pr-2 font-medium">{c.nombre}</td>
                            <td className="py-2 pr-2 text-right">{c.totalCompras}</td>
                            <td className="py-2 pr-2 text-right font-medium">{formatPrice(c.totalGastado)}</td>
                            <td className="py-2 pr-2 text-right">{formatPrice(c.ticketPromedio)}</td>
                            <td className="py-2 text-right text-muted-foreground">
                              <div>{formatDate(c.ultimaCompra)}</div>
                              <div className="text-[10px]">hace {c.diasDesdeUltimaCompra} días</div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Tab: En Riesgo */}
            {activeTab === "riesgo" && (
              <div>
                <p className="text-xs text-muted-foreground mb-3">
                  Clientes con 2+ compras que no compran hace 60-180 días
                </p>
                {data.clientesEnRiesgo.length === 0 ? (
                  <EmptyState icon={CheckCircle} title="Sin clientes en riesgo" variant="success" />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="pb-2 pr-2">Cliente</th>
                          <th className="pb-2 pr-2">Teléfono</th>
                          <th className="pb-2 pr-2 text-right">Compras</th>
                          <th className="pb-2 pr-2 text-right">Total</th>
                          <th className="pb-2 pr-2 text-right">Días Inactivo</th>
                          <th className="pb-2 text-center">Acción</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.clientesEnRiesgo.map((c: any) => (
                          <tr key={c.id} className={`border-b last:border-0 ${
                            c.diasInactivo > 120 ? "bg-destructive/5" : c.diasInactivo > 90 ? "bg-warning-50 dark:bg-warning/10" : ""
                          }`}>
                            <td className="py-2 pr-2 font-medium">{c.nombre}</td>
                            <td className="py-2 pr-2 text-muted-foreground">{c.telefono}</td>
                            <td className="py-2 pr-2 text-right">{c.totalCompras}</td>
                            <td className="py-2 pr-2 text-right">{formatPrice(c.totalGastado)}</td>
                            <td className="py-2 pr-2 text-right">
                              <Badge variant={c.diasInactivo > 120 ? "destructive" : "secondary"} className="text-[10px]">
                                {c.diasInactivo} días
                              </Badge>
                            </td>
                            <td className="py-2 text-center">
                              {c.telefono && (
                                <a
                                  href={formatWhatsAppLink(c.telefono)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs text-success-600 hover:text-success-700"
                                >
                                  <WhatsAppIcon className="h-3.5 w-3.5" />
                                </a>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Tab: Adquisición */}
            {activeTab === "adquisicion" && (
              <div>
                <p className="text-xs text-muted-foreground mb-3">Nuevos clientes por mes (últimos 6 meses)</p>
                <div className="space-y-2">
                  {data.adquisicionMensual.map((m: any) => {
                    const maxCount = Math.max(...data.adquisicionMensual.map((x: any) => x.count), 1)
                    const pct = (m.count / maxCount) * 100
                    return (
                      <div key={m.mes} className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-16">{m.mes}</span>
                        <div className="flex-1 h-6 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary/20 rounded-full flex items-center px-2"
                            style={{ width: `${Math.max(pct, 8)}%` }}
                          >
                            <span className="text-[10px] font-medium">{m.count}</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Tab: Frecuencia */}
            {activeTab === "frecuencia" && (
              <div>
                <p className="text-xs text-muted-foreground mb-3">Distribución de frecuencia de compra</p>
                <div className="space-y-2">
                  {data.frecuenciaCompra.map((f: any) => {
                    const maxCount = Math.max(...data.frecuenciaCompra.map((x: any) => x.count), 1)
                    const pct = (f.count / maxCount) * 100
                    return (
                      <div key={f.rango} className="flex items-center gap-3">
                        <span className="text-xs w-24">{f.rango}</span>
                        <div className="flex-1 h-6 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-info-200 dark:bg-info-600 rounded-full flex items-center px-2"
                            style={{ width: `${Math.max(pct, 8)}%` }}
                          >
                            <span className="text-[10px] font-medium">{f.count} clientes</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
