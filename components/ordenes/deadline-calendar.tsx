"use client"

import { useState } from "react"
import useSWR from "swr"
import { CalendarClock, AlertTriangle, Clock, ArrowRight, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { OrderStatusBadge } from "@/components/ui/badge"
import { useCurrency } from "@/contexts/currency-context"
import Link from "next/link"

const fetcher = (url: string) => fetch(url).then(res => res.json())

interface CompromisoOrden {
  id: string
  numeroOrden: number
  codigoOrden?: string
  dispositivo: string
  tipoDispositivo: string
  marca?: string
  estado: string
  fechaPrometida: string
  fechaIngreso: string
  presupuesto?: number
  cliente: { id: string; nombre: string; telefono?: string } | null
  tecnico: { id: string; nombre: string } | null
}

interface CompromisosData {
  vencidas: CompromisoOrden[]
  hoy: CompromisoOrden[]
  manana: CompromisoOrden[]
  totalUrgentes: number
}

function OrdenRow({ orden, tipo, formatDate, onClose }: {
  orden: CompromisoOrden
  tipo: "vencida" | "hoy" | "manana"
  formatDate: (d: Date | string | null | undefined) => string
  onClose: () => void
}) {
  const codigo = orden.codigoOrden || `#${orden.numeroOrden}`

  return (
    <Link
      href={`/ordenes/${orden.id}`}
      onClick={onClose}
      className="group flex items-center gap-3 p-3 rounded-lg border transition-colors hover:bg-accent/50"
    >
      {/* Indicator */}
      <div className={`shrink-0 w-1 h-12 rounded-full ${
        tipo === "vencida" ? "bg-red-500" :
        tipo === "hoy" ? "bg-orange-500" :
        "bg-blue-500"
      }`} />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-semibold text-sm text-primary">{codigo}</span>
          <OrderStatusBadge status={orden.estado} className="text-[10px] px-1.5 py-0" />
        </div>
        <p className="text-sm truncate">{orden.dispositivo}{orden.marca ? ` - ${orden.marca}` : ""}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-muted-foreground truncate">
            {orden.cliente?.nombre || "Sin cliente"}
          </span>
          {orden.tecnico && (
            <>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs text-muted-foreground truncate">{orden.tecnico.nombre}</span>
            </>
          )}
        </div>
      </div>

      {/* Date + arrow */}
      <div className="shrink-0 flex items-center gap-2">
        <span className={`text-xs font-medium ${
          tipo === "vencida" ? "text-red-600 dark:text-red-400" :
          tipo === "hoy" ? "text-orange-600 dark:text-orange-400" :
          "text-blue-600 dark:text-blue-400"
        }`}>
          {formatDate(orden.fechaPrometida)}
        </span>
        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </Link>
  )
}

function SectionHeader({ icon: Icon, title, count, colorClass }: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  count: number
  colorClass: string
}) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <div className={`flex items-center justify-center w-6 h-6 rounded-full ${colorClass}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${colorClass}`}>
        {count}
      </span>
    </div>
  )
}

export function DeadlineCalendar() {
  const [open, setOpen] = useState(false)
  const { formatDate } = useCurrency()

  const { data, isLoading } = useSWR<CompromisosData>(
    "/api/ordenes/compromisos",
    fetcher,
    { revalidateOnFocus: true, refreshInterval: 60000 }
  )

  const totalUrgentes = data?.totalUrgentes || 0
  const hasVencidas = (data?.vencidas?.length || 0) > 0

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="relative"
        onClick={() => setOpen(true)}
        aria-label={`Compromisos de entrega${totalUrgentes > 0 ? ` (${totalUrgentes} urgentes)` : ""}`}
      >
        <CalendarClock className={`h-5 w-5 ${hasVencidas ? "text-red-500" : ""}`} />
        {totalUrgentes > 0 && (
          <span className={`absolute -top-1 -right-1 h-4 min-w-4 px-0.5 rounded-full text-[10px] font-medium flex items-center justify-center ${
            hasVencidas
              ? "bg-red-500 text-white"
              : "bg-orange-500 text-white"
          }`}>
            {totalUrgentes > 99 ? "99+" : totalUrgentes}
          </span>
        )}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-primary" />
              Compromisos de entrega
            </DialogTitle>
            <DialogDescription>
              Reparaciones comprometidas para hoy, mañana y vencidas
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto -mx-6 px-6 space-y-5">
            {isLoading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
                ))}
              </div>
            ) : !data || (data.vencidas.length === 0 && data.hoy.length === 0 && data.manana.length === 0) ? (
              <div className="py-12 text-center">
                <CalendarClock className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">No hay compromisos pendientes</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Las órdenes con fecha prometida aparecerán aquí</p>
              </div>
            ) : (
              <>
                {/* Vencidas */}
                {data.vencidas.length > 0 && (
                  <div>
                    <SectionHeader
                      icon={AlertTriangle}
                      title="Vencidas"
                      count={data.vencidas.length}
                      colorClass="bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400"
                    />
                    <div className="space-y-2">
                      {data.vencidas.map((orden) => (
                        <OrdenRow
                          key={orden.id}
                          orden={orden}
                          tipo="vencida"
                          formatDate={formatDate}
                          onClose={() => setOpen(false)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Hoy */}
                {data.hoy.length > 0 && (
                  <div>
                    <SectionHeader
                      icon={Clock}
                      title="Hoy"
                      count={data.hoy.length}
                      colorClass="bg-orange-100 text-orange-600 dark:bg-orange-950 dark:text-orange-400"
                    />
                    <div className="space-y-2">
                      {data.hoy.map((orden) => (
                        <OrdenRow
                          key={orden.id}
                          orden={orden}
                          tipo="hoy"
                          formatDate={formatDate}
                          onClose={() => setOpen(false)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Mañana */}
                {data.manana.length > 0 && (
                  <div>
                    <SectionHeader
                      icon={ArrowRight}
                      title="Mañana"
                      count={data.manana.length}
                      colorClass="bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400"
                    />
                    <div className="space-y-2">
                      {data.manana.map((orden) => (
                        <OrdenRow
                          key={orden.id}
                          orden={orden}
                          tipo="manana"
                          formatDate={formatDate}
                          onClose={() => setOpen(false)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer summary */}
          {data && (data.vencidas.length > 0 || data.hoy.length > 0 || data.manana.length > 0) && (
            <div className="flex items-center justify-between pt-3 border-t -mx-6 px-6">
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                {data.vencidas.length > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                    {data.vencidas.length} vencida{data.vencidas.length !== 1 ? "s" : ""}
                  </span>
                )}
                {data.hoy.length > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-orange-500" />
                    {data.hoy.length} hoy
                  </span>
                )}
                {data.manana.length > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    {data.manana.length} mañana
                  </span>
                )}
              </div>
              <Link
                href="/ordenes"
                onClick={() => setOpen(false)}
                className="text-xs text-primary hover:underline font-medium"
              >
                Ver todas
              </Link>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
