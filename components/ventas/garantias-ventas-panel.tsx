"use client"

import useSWR from "swr"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  ShieldOff,
  Clock,
  AlertTriangle,
} from "lucide-react"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"
import { useCurrency } from "@/contexts/currency-context"
import { formatPhoneForWhatsApp } from "@/lib/notifications/whatsapp-templates"
import { EmptyState } from "@/components/ui/empty-state"

const fetcher = (url: string) => fetch(url).then(res => res.json())

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function GarantiasVentasPanel({ open, onOpenChange }: Props) {
  const { formatDate, pais } = useCurrency()

  const { data, isLoading } = useSWR(
    open ? "/api/reportes/garantias-ventas" : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000 }
  )

  const formatWhatsAppLink = (telefono: string) =>
    `https://wa.me/${formatPhoneForWhatsApp(telefono, pais)}`

  const porVencer7 = data?.porVencer?.filter((g: any) => g.diasRestantes <= 7) || []
  const porVencer15 = data?.porVencer?.filter((g: any) => g.diasRestantes > 7 && g.diasRestantes <= 15) || []
  const porVencer30 = data?.porVencer?.filter((g: any) => g.diasRestantes > 15) || []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-4xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Gestión de Garantías de Ventas
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-4">
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              {[...Array(4)].map((_, i) => (
                <Card key={i}><CardContent className="p-3"><div className="h-10 bg-muted animate-pulse rounded" /></CardContent></Card>
              ))}
            </div>
            <div className="h-48 bg-muted animate-pulse rounded" />
          </div>
        ) : !data || data.error ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Error al cargar datos</p>
        ) : (
          <div className="space-y-5">
            {/* Summary */}
            <div className={`grid gap-3 grid-cols-2 ${data.resumen.totalAnuladas > 0 ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
              <Card>
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-success-50 dark:bg-success/15">
                    <ShieldCheck className="h-4 w-4 text-success" />
                  </div>
                  <div>
                    <div className="text-lg font-bold">{data.resumen.totalActivas}</div>
                    <div className="text-[10px] text-muted-foreground">Activas</div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-warning-50 dark:bg-warning/15">
                    <ShieldAlert className="h-4 w-4 text-warning" />
                  </div>
                  <div>
                    <div className="text-lg font-bold">{data.porVencer?.length || 0}</div>
                    <div className="text-[10px] text-muted-foreground">Por Vencer (30d)</div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-destructive/10">
                    <ShieldX className="h-4 w-4 text-destructive" />
                  </div>
                  <div>
                    <div className="text-lg font-bold">{data.resumen.totalReclamadas}</div>
                    <div className="text-[10px] text-muted-foreground">Reclamadas</div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <div className="text-lg font-bold">{data.resumen.totalVencidas}</div>
                    <div className="text-[10px] text-muted-foreground">Vencidas</div>
                  </div>
                </CardContent>
              </Card>
              {/* Solo aparece cuando hay algo que contar: sin devoluciones el
                  panel se queda en cuatro tarjetas parejas. */}
              {data.resumen.totalAnuladas > 0 && (
                <Card>
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-muted">
                      <ShieldOff className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="text-lg font-bold">{data.resumen.totalAnuladas}</div>
                      <div className="text-[10px] text-muted-foreground">Anuladas por devolución</div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Por Vencer */}
            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-warning" />
                Garantías por Vencer
              </h3>

              {data.porVencer?.length === 0 ? (
                <EmptyState icon={ShieldCheck} title="Sin garantías por vencer" variant="success" />
              ) : (
                <div className="space-y-3">
                  {/* 7 días */}
                  {porVencer7.length > 0 && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                      <div className="text-xs font-semibold text-destructive mb-2">
                        Vencen en 7 días ({porVencer7.length})
                      </div>
                      <div className="space-y-2">
                        {porVencer7.map((g: any) => (
                          <GarantiaItem key={g.id} garantia={g} formatDate={formatDate} formatWhatsAppLink={formatWhatsAppLink} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 15 días */}
                  {porVencer15.length > 0 && (
                    <div className="rounded-lg border border-warning/30 bg-warning-50/50 p-3">
                      <div className="text-xs font-semibold text-warning mb-2">
                        Vencen en 15 días ({porVencer15.length})
                      </div>
                      <div className="space-y-2">
                        {porVencer15.map((g: any) => (
                          <GarantiaItem key={g.id} garantia={g} formatDate={formatDate} formatWhatsAppLink={formatWhatsAppLink} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 30 días */}
                  {porVencer30.length > 0 && (
                    <div className="rounded-lg border border-border p-3">
                      <div className="text-xs font-semibold text-muted-foreground mb-2">
                        Vencen en 30 días ({porVencer30.length})
                      </div>
                      <div className="space-y-2">
                        {porVencer30.map((g: any) => (
                          <GarantiaItem key={g.id} garantia={g} formatDate={formatDate} formatWhatsAppLink={formatWhatsAppLink} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Tasa de Reclamo */}
            {data.tasaReclamo?.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-3">Tasa de Reclamo por Producto</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="pb-2 pr-2">Producto</th>
                        <th className="pb-2 pr-2 text-right">Garantías</th>
                        <th className="pb-2 pr-2 text-right">Reclamos</th>
                        <th className="pb-2 text-right">Tasa</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.tasaReclamo.map((p: any, i: number) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="py-2 pr-2 font-medium">{p.producto}</td>
                          <td className="py-2 pr-2 text-right">{p.totalGarantias}</td>
                          <td className="py-2 pr-2 text-right">{p.totalReclamadas}</td>
                          <td className="py-2 text-right">
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${
                                p.tasaReclamo > 10 ? "border-destructive text-destructive" :
                                p.tasaReclamo > 5 ? "border-warning text-warning" :
                                "border-success text-success"
                              }`}
                            >
                              {p.tasaReclamo}%
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Reclamos Recientes */}
            {data.reclamosRecientes?.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-3">Reclamos Recientes</h3>
                <div className="space-y-2">
                  {data.reclamosRecientes.map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0">
                      <div>
                        <span className="font-medium">{r.producto}</span>
                        <span className="text-muted-foreground ml-2">- {r.clienteNombre}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>V{String(r.numeroVenta).padStart(4, "0")}</span>
                        <span>{formatDate(r.fechaReclamo)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function GarantiaItem({ garantia: g, formatDate, formatWhatsAppLink }: {
  garantia: any
  formatDate: (d: string) => string
  formatWhatsAppLink: (t: string) => string
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] shrink-0">G-{g.numeroGarantia}</Badge>
          <span className="font-medium truncate">{g.producto}</span>
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {g.clienteNombre} - V{String(g.numeroVenta).padStart(4, "0")} - Vence: {formatDate(g.fechaVencimiento)}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Badge variant={g.diasRestantes <= 7 ? "destructive" : "secondary"} className="text-[10px]">
          {g.diasRestantes}d
        </Badge>
        {g.clienteTelefono && (
          <a
            href={formatWhatsAppLink(g.clienteTelefono)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-success hover:text-success/80"
            title="Notificar por WhatsApp"
          >
            <WhatsAppIcon className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </div>
  )
}
