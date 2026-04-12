"use client"

import { useState, useMemo } from "react"
import useSWR from "swr"
import { CalendarClock, ChevronRight, ChevronLeft } from "lucide-react"
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
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths, subMonths, isSameMonth, isSameDay, isToday } from "date-fns"
import { es } from "date-fns/locale"

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
  urgencia: "vencida" | "hoy" | "futuro"
  cliente: { id: string; nombre: string; telefono?: string } | null
  tecnico: { id: string; nombre: string } | null
}

interface CompromisosResponse {
  ordenes: CompromisoOrden[]
  totalVencidas: number
  totalHoy: number
  totalUrgentes: number
}

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]

export function DeadlineCalendar() {
  const [open, setOpen] = useState(false)
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const { formatDate } = useCurrency()

  // Calculate range for API query — include previous month's vencidas
  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const apiDesde = format(startOfMonth(subMonths(currentMonth, 6)), "yyyy-MM-dd")
  const apiHasta = format(monthEnd, "yyyy-MM-dd")

  const { data, isLoading } = useSWR<CompromisosResponse>(
    open ? `/api/ordenes/compromisos?desde=${apiDesde}&hasta=${apiHasta}` : null,
    fetcher,
    { revalidateOnFocus: true, refreshInterval: 60000 }
  )

  // Also fetch urgentes count for badge (always active)
  const { data: badgeData } = useSWR<CompromisosResponse>(
    "/api/ordenes/compromisos",
    fetcher,
    { revalidateOnFocus: true, refreshInterval: 60000 }
  )

  const totalUrgentes = badgeData?.totalUrgentes || 0
  const hasVencidas = (badgeData?.totalVencidas || 0) > 0

  // Group orders by date
  const ordersByDate = useMemo(() => {
    if (!data?.ordenes) return new Map<string, CompromisoOrden[]>()
    const map = new Map<string, CompromisoOrden[]>()
    for (const orden of data.ordenes) {
      const key = format(new Date(orden.fechaPrometida), "yyyy-MM-dd")
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(orden)
    }
    return map
  }, [data])

  // Vencidas that don't fall in the current month (accumulated)
  const vencidasPrevias = useMemo(() => {
    if (!data?.ordenes) return []
    return data.ordenes.filter(o => {
      const d = new Date(o.fechaPrometida)
      return o.urgencia === "vencida" && d < monthStart
    })
  }, [data, monthStart])

  // Build calendar grid
  const calendarDays = useMemo(() => {
    const start = startOfWeek(monthStart, { weekStartsOn: 1 })
    const end = endOfWeek(monthEnd, { weekStartsOn: 1 })
    const days: Date[] = []
    let day = start
    while (day <= end) {
      days.push(day)
      day = addDays(day, 1)
    }
    return days
  }, [monthStart, monthEnd])

  // Orders for selected date
  const selectedOrders = useMemo(() => {
    if (!selectedDate) return []
    if (selectedDate.getTime() === 0) return vencidasPrevias // Special: vencidas button
    const key = format(selectedDate, "yyyy-MM-dd")
    return ordersByDate.get(key) || []
  }, [selectedDate, ordersByDate, vencidasPrevias])

  const getDotsForDay = (day: Date) => {
    const key = format(day, "yyyy-MM-dd")
    const orders = ordersByDate.get(key)
    if (!orders || orders.length === 0) return null

    const hasVencida = orders.some(o => o.urgencia === "vencida")
    const hasHoy = orders.some(o => o.urgencia === "hoy")
    const hasFuturo = orders.some(o => o.urgencia === "futuro")

    return { hasVencida, hasHoy, hasFuturo, count: orders.length }
  }

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

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setSelectedDate(null) }}>
        <DialogContent className="sm:max-w-[540px] max-h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-5 pt-5 pb-3">
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-primary" />
              Compromisos de entrega
            </DialogTitle>
            <DialogDescription>
              Fechas prometidas de reparaciones activas
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto">
            {/* Calendar */}
            <div className="px-5 pb-3">
              {/* Month navigation */}
              <div className="flex items-center justify-between mb-3">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <h3 className="text-sm font-semibold capitalize">
                  {format(currentMonth, "MMMM yyyy", { locale: es })}
                </h3>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              {/* Weekday headers */}
              <div className="grid grid-cols-7 mb-1">
                {WEEKDAYS.map((d) => (
                  <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">
                    {d}
                  </div>
                ))}
              </div>

              {/* Day grid */}
              {isLoading ? (
                <div className="grid grid-cols-7 gap-px">
                  {Array.from({ length: 35 }).map((_, i) => (
                    <div key={i} className="h-10 bg-muted/30 animate-pulse rounded" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-7 gap-px">
                  {calendarDays.map((day) => {
                    const inMonth = isSameMonth(day, currentMonth)
                    const today = isToday(day)
                    const dots = getDotsForDay(day)
                    const isSelected = selectedDate && selectedDate.getTime() !== 0 && isSameDay(day, selectedDate)

                    return (
                      <button
                        key={day.toISOString()}
                        onClick={() => {
                          if (dots) setSelectedDate(day)
                          else setSelectedDate(null)
                        }}
                        className={`
                          relative flex flex-col items-center justify-center h-10 rounded-lg text-sm transition-colors
                          ${!inMonth ? "text-muted-foreground/30" : ""}
                          ${today && !isSelected ? "bg-accent font-semibold" : ""}
                          ${isSelected ? "bg-primary text-primary-foreground font-semibold" : ""}
                          ${inMonth && !today && !isSelected ? "hover:bg-accent/50" : ""}
                          ${dots ? "cursor-pointer" : "cursor-default"}
                        `}
                      >
                        <span className="text-xs">{format(day, "d")}</span>
                        {/* Dots indicator */}
                        {dots && (
                          <div className="flex items-center gap-0.5 mt-0.5">
                            {dots.hasVencida && <span className="w-1.5 h-1.5 rounded-full bg-red-500" />}
                            {dots.hasHoy && <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />}
                            {dots.hasFuturo && <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
                            {dots.count > 1 && (
                              <span className={`text-[8px] font-bold ml-0.5 ${isSelected ? "text-primary-foreground" : "text-muted-foreground"}`}>
                                {dots.count}
                              </span>
                            )}
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Legend + vencidas previas button */}
              <div className="flex items-center justify-between mt-3 pt-3 border-t">
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                    Vencida
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-orange-500" />
                    Hoy
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    Futuro
                  </span>
                </div>
                {vencidasPrevias.length > 0 && (
                  <button
                    onClick={() => setSelectedDate(new Date(0))}
                    className={`text-[11px] font-medium px-2 py-0.5 rounded-full transition-colors ${
                      selectedDate?.getTime() === 0
                        ? "bg-red-500 text-white"
                        : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900"
                    }`}
                  >
                    {vencidasPrevias.length} vencida{vencidasPrevias.length !== 1 ? "s" : ""} anteriores
                  </button>
                )}
              </div>
            </div>

            {/* Selected day detail */}
            {selectedDate && selectedOrders.length > 0 && (
              <div className="border-t bg-muted/20">
                <div className="px-5 py-3">
                  <h4 className="text-sm font-semibold mb-2">
                    {selectedDate.getTime() === 0
                      ? "Órdenes vencidas (meses anteriores)"
                      : format(selectedDate, "EEEE d 'de' MMMM", { locale: es })
                    }
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      ({selectedOrders.length} {selectedOrders.length === 1 ? "orden" : "órdenes"})
                    </span>
                  </h4>
                  <div className="space-y-2 max-h-[200px] overflow-y-auto">
                    {selectedOrders.map((orden) => (
                      <Link
                        key={orden.id}
                        href={`/ordenes/${orden.id}`}
                        onClick={() => setOpen(false)}
                        className="group flex items-center gap-3 p-2.5 rounded-lg border bg-card transition-colors hover:bg-accent/50"
                      >
                        <div className={`shrink-0 w-1 h-10 rounded-full ${
                          orden.urgencia === "vencida" ? "bg-red-500" :
                          orden.urgencia === "hoy" ? "bg-orange-500" :
                          "bg-blue-500"
                        }`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="font-semibold text-xs text-primary">
                              {orden.codigoOrden || `#${orden.numeroOrden}`}
                            </span>
                            <OrderStatusBadge status={orden.estado} className="text-[9px] px-1.5 py-0" />
                          </div>
                          <p className="text-xs truncate">
                            {orden.dispositivo}{orden.marca ? ` - ${orden.marca}` : ""}
                          </p>
                          <span className="text-[11px] text-muted-foreground truncate">
                            {orden.cliente?.nombre || "Sin cliente"}
                            {orden.tecnico ? ` · ${orden.tecnico.nombre}` : ""}
                          </span>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-5 py-3 border-t">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {data && (
                <span>{data.ordenes.length} compromiso{data.ordenes.length !== 1 ? "s" : ""} activo{data.ordenes.length !== 1 ? "s" : ""}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7"
                onClick={() => {
                  setCurrentMonth(new Date())
                  setSelectedDate(null)
                }}
              >
                Hoy
              </Button>
              <Link
                href="/ordenes"
                onClick={() => setOpen(false)}
                className="text-xs text-primary hover:underline font-medium"
              >
                Ver todas
              </Link>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
