"use client"

import { useState, useMemo, useEffect } from "react"
import useSWR from "swr"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  CalendarDays,
  CalendarRange,
  Calendar as CalendarIcon,
  List,
  AlertCircle,
  Truck,
  CheckCircle2,
  Clock,
} from "lucide-react"
import {
  format,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  addDays,
  addWeeks,
  subWeeks,
  addMonths,
  subMonths,
  isToday,
  isSameMonth,
  parseISO,
} from "date-fns"
import { es } from "date-fns/locale"
import { TurnoFormDialog } from "./turno-form-dialog"
import { TurnoDetailSheet } from "./turno-detail-sheet"
import { TurnoBlock } from "./turno-block"
import type { TurnoConRelaciones } from "@/types"

const fetcher = (u: string) => fetch(u).then(r => r.json())

const WEEKDAYS_SHORT = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]
const HOUR_START = 7
const HOUR_END = 21
const HOUR_HEIGHT = 56 // px por hora
const TOTAL_HEIGHT = (HOUR_END - HOUR_START) * HOUR_HEIGHT

type Vista = "dia" | "semana" | "mes" | "lista"

interface TurnosResp { turnos: TurnoConRelaciones[] }

function turnoStylePx(t: TurnoConRelaciones): React.CSSProperties {
  const ini = parseISO(t.inicio)
  const finDate = t.fin ? parseISO(t.fin) : new Date(ini.getTime() + 60 * 60 * 1000)
  const inicioMin = ini.getHours() * 60 + ini.getMinutes()
  const finMin = Math.max(
    inicioMin + 25,
    finDate.getHours() * 60 + finDate.getMinutes(),
  )
  const startOffsetMin = HOUR_START * 60
  const top = ((inicioMin - startOffsetMin) / 60) * HOUR_HEIGHT
  const height = Math.max(24, ((finMin - inicioMin) / 60) * HOUR_HEIGHT - 2)
  return { top: `${top}px`, height: `${height}px` }
}

export function AgendaView() {
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === "ADMIN"

  const [vista, setVista] = useState<Vista>("semana")
  const [cursor, setCursor] = useState(new Date())
  const [filterTecnico, setFilterTecnico] = useState<string>("_todos_")
  const [filterEstado, setFilterEstado] = useState<string>("_todos_")
  const [filterTipo, setFilterTipo] = useState<string>("_todos_")

  const [formOpen, setFormOpen] = useState(false)
  const [editTurno, setEditTurno] = useState<TurnoConRelaciones | null>(null)
  const [detailTurno, setDetailTurno] = useState<TurnoConRelaciones | null>(null)
  const [defaultInicio, setDefaultInicio] = useState<Date | null>(null)

  // Rango según vista
  const { rangeStart, rangeEnd, days } = useMemo(() => {
    if (vista === "dia") {
      return { rangeStart: cursor, rangeEnd: cursor, days: [cursor] }
    }
    if (vista === "mes") {
      const mStart = startOfMonth(cursor)
      const mEnd = endOfMonth(cursor)
      const gridStart = startOfWeek(mStart, { weekStartsOn: 1 })
      const gridEnd = endOfWeek(mEnd, { weekStartsOn: 1 })
      const arr: Date[] = []
      let d = gridStart
      while (d <= gridEnd) {
        arr.push(d)
        d = addDays(d, 1)
      }
      return { rangeStart: gridStart, rangeEnd: gridEnd, days: arr }
    }
    const start = startOfWeek(cursor, { weekStartsOn: 1 })
    const end = endOfWeek(cursor, { weekStartsOn: 1 })
    return {
      rangeStart: start,
      rangeEnd: end,
      days: Array.from({ length: 7 }, (_, i) => addDays(start, i)),
    }
  }, [vista, cursor])

  const desde = format(rangeStart, "yyyy-MM-dd")
  const hasta = format(rangeEnd, "yyyy-MM-dd")

  const queryParts = [`desde=${desde}`, `hasta=${hasta}`]
  if (filterTecnico !== "_todos_") queryParts.push(`tecnicoId=${filterTecnico}`)
  if (filterEstado !== "_todos_") queryParts.push(`estado=${filterEstado}`)

  const { data, isLoading, mutate } = useSWR<TurnosResp>(
    `/api/turnos?${queryParts.join("&")}`,
    fetcher,
    { revalidateOnFocus: true, refreshInterval: 60000 },
  )

  // Stats globales (semana actual visible)
  const { data: statsData } = useSWR<TurnosResp>(
    `/api/turnos?desde=${format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd")}&hasta=${format(endOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd")}`,
    fetcher,
    { refreshInterval: 120000 },
  )

  const { data: tecnicosData } = useSWR<any>(
    isAdmin ? "/api/tecnicos" : null,
    fetcher,
  )
  const tecnicos: { id: string; nombre: string }[] = useMemo(() => {
    return Array.isArray(tecnicosData) ? tecnicosData : (tecnicosData?.tecnicos || [])
  }, [tecnicosData])

  const turnosFiltrados = useMemo(() => {
    const all = data?.turnos || []
    if (filterTipo === "_todos_") return all
    return all.filter(t => t.tipo === filterTipo)
  }, [data, filterTipo])

  const turnosPorDia = useMemo(() => {
    const map = new Map<string, TurnoConRelaciones[]>()
    for (const t of turnosFiltrados) {
      const key = format(parseISO(t.inicio), "yyyy-MM-dd")
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(t)
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.inicio.localeCompare(b.inicio))
    }
    return map
  }, [turnosFiltrados])

  const stats = useMemo(() => {
    const all = statsData?.turnos || []
    const hoyKey = format(new Date(), "yyyy-MM-dd")
    const hoy = all.filter(t => format(parseISO(t.inicio), "yyyy-MM-dd") === hoyKey && t.estado !== "cancelado")
    const enCamino = all.filter(t => t.estado === "en_camino")
    const realizados = all.filter(t => t.estado === "realizado" || t.estado === "orden_generada")
    const sinAsignar = all.filter(t => !t.tecnicoId && t.estado !== "cancelado" && t.estado !== "no_show")
    return {
      hoy: hoy.length,
      enCamino: enCamino.length,
      realizados: realizados.length,
      sinAsignar: sinAsignar.length,
    }
  }, [statsData])

  // Navegación
  const onPrev = () => setCursor(
    vista === "dia" ? addDays(cursor, -1)
    : vista === "mes" ? subMonths(cursor, 1)
    : subWeeks(cursor, 1),
  )
  const onNext = () => setCursor(
    vista === "dia" ? addDays(cursor, 1)
    : vista === "mes" ? addMonths(cursor, 1)
    : addWeeks(cursor, 1),
  )
  const onHoy = () => setCursor(new Date())

  const handleNuevoSlot = (day: Date, hour?: number) => {
    setEditTurno(null)
    const d = new Date(day)
    if (hour !== undefined) {
      d.setHours(hour, 0, 0, 0)
    } else {
      d.setHours(9, 0, 0, 0)
    }
    setDefaultInicio(d)
    setFormOpen(true)
  }

  const handleEditFromDetail = (t: TurnoConRelaciones) => {
    setDetailTurno(null)
    setEditTurno(t)
    setDefaultInicio(null)
    setFormOpen(true)
  }

  const horas = useMemo(() => {
    const arr: number[] = []
    for (let h = HOUR_START; h < HOUR_END; h++) arr.push(h)
    return arr
  }, [])

  const labelRango = useMemo(() => {
    if (vista === "dia") {
      return format(cursor, "EEEE d 'de' MMMM yyyy", { locale: es })
    }
    if (vista === "mes") {
      return format(cursor, "MMMM yyyy", { locale: es })
    }
    const start = startOfWeek(cursor, { weekStartsOn: 1 })
    const end = endOfWeek(cursor, { weekStartsOn: 1 })
    const sameMonth = start.getMonth() === end.getMonth()
    if (sameMonth) {
      return `${format(start, "d")} – ${format(end, "d 'de' MMMM yyyy", { locale: es })}`
    }
    return `${format(start, "d 'de' MMM", { locale: es })} – ${format(end, "d 'de' MMM yyyy", { locale: es })}`
  }, [cursor, vista])

  return (
    <div className="space-y-4">
      {/* Stats chips */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatCard icon={<CalendarDays className="h-4 w-4" />} label="Hoy" value={stats.hoy} tone="blue" />
        <StatCard icon={<Truck className="h-4 w-4" />} label="En camino" value={stats.enCamino} tone="amber" />
        <StatCard icon={<CheckCircle2 className="h-4 w-4" />} label="Realizados" value={stats.realizados} tone="emerald" sub="semana" />
        <StatCard icon={<AlertCircle className="h-4 w-4" />} label="Sin técnico" value={stats.sinAsignar} tone="red" sub="semana" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={onPrev} aria-label="Anterior" className="h-9 w-9">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onHoy} className="h-9">Hoy</Button>
          <Button variant="outline" size="icon" onClick={onNext} aria-label="Siguiente" className="h-9 w-9">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium capitalize ml-3">{labelRango}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border bg-card p-0.5">
            <VistaBtn active={vista === "dia"} onClick={() => setVista("dia")} icon={<Clock className="h-3.5 w-3.5" />} label="Día" />
            <VistaBtn active={vista === "semana"} onClick={() => setVista("semana")} icon={<CalendarRange className="h-3.5 w-3.5" />} label="Semana" />
            <VistaBtn active={vista === "mes"} onClick={() => setVista("mes")} icon={<CalendarIcon className="h-3.5 w-3.5" />} label="Mes" />
            <VistaBtn active={vista === "lista"} onClick={() => setVista("lista")} icon={<List className="h-3.5 w-3.5" />} label="Lista" />
          </div>

          {isAdmin && (
            <Select value={filterTecnico} onValueChange={setFilterTecnico}>
              <SelectTrigger className="w-[160px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_todos_">Todos los técnicos</SelectItem>
                {tecnicos.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={filterTipo} onValueChange={setFilterTipo}>
            <SelectTrigger className="w-[140px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_todos_">Todos los tipos</SelectItem>
              <SelectItem value="visita_diagnostico">Diagnóstico</SelectItem>
              <SelectItem value="reparacion_onsite">Reparación on-site</SelectItem>
              <SelectItem value="retiro">Retiro</SelectItem>
              <SelectItem value="entrega">Entrega</SelectItem>
              <SelectItem value="mantenimiento">Mantenimiento</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filterEstado} onValueChange={setFilterEstado}>
            <SelectTrigger className="w-[140px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_todos_">Todos los estados</SelectItem>
              <SelectItem value="agendado">Agendado</SelectItem>
              <SelectItem value="confirmado">Confirmado</SelectItem>
              <SelectItem value="en_camino">En camino</SelectItem>
              <SelectItem value="realizado">Realizado</SelectItem>
              <SelectItem value="orden_generada">Con orden</SelectItem>
              <SelectItem value="cancelado">Cancelado</SelectItem>
              <SelectItem value="no_show">No se presentó</SelectItem>
            </SelectContent>
          </Select>

          <Button onClick={() => handleNuevoSlot(new Date())}>
            <Plus className="mr-2 h-4 w-4" />
            Nuevo turno
          </Button>
        </div>
      </div>

      {/* Vista */}
      {vista === "lista" ? (
        <ListaView
          days={days}
          turnosPorDia={turnosPorDia}
          isLoading={isLoading}
          onClick={(t) => setDetailTurno(t)}
          onNuevo={(d) => handleNuevoSlot(d)}
        />
      ) : vista === "mes" ? (
        <MesView
          cursor={cursor}
          days={days}
          turnosPorDia={turnosPorDia}
          isLoading={isLoading}
          onTurnoClick={(t) => setDetailTurno(t)}
          onDayClick={(d) => { setCursor(d); setVista("dia") }}
          onNuevoEnDia={(d) => handleNuevoSlot(d)}
        />
      ) : (
        <TimelineView
          vista={vista}
          days={days}
          horas={horas}
          turnosPorDia={turnosPorDia}
          isLoading={isLoading}
          onTurnoClick={(t) => setDetailTurno(t)}
          onSlotClick={handleNuevoSlot}
        />
      )}

      <TurnoFormDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditTurno(null) }}
        onSaved={() => mutate()}
        turno={editTurno}
        defaultInicio={defaultInicio}
      />

      <TurnoDetailSheet
        open={!!detailTurno}
        onClose={() => setDetailTurno(null)}
        turno={detailTurno}
        onChanged={() => { mutate(); setDetailTurno(null) }}
        onEdit={handleEditFromDetail}
      />
    </div>
  )
}

// ============================================
// Subcomponentes
// ============================================

function VistaBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`
        inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors
        ${active ? "bg-primary text-primary-foreground" : "hover:bg-accent"}
      `}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

function StatCard({
  icon, label, value, tone, sub,
}: {
  icon: React.ReactNode
  label: string
  value: number
  tone: "blue" | "amber" | "emerald" | "red"
  sub?: string
}) {
  const tones = {
    blue: "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 border-blue-200/50 dark:border-blue-900/50",
    amber: "bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 border-amber-200/50 dark:border-amber-900/50",
    emerald: "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 border-emerald-200/50 dark:border-emerald-900/50",
    red: "bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300 border-red-200/50 dark:border-red-900/50",
  }
  return (
    <div className={`rounded-lg border p-3 ${tones[tone]}`}>
      <div className="flex items-center gap-1.5 text-xs font-medium opacity-80">
        {icon}
        {label}
        {sub && <span className="text-[10px] opacity-70 ml-auto">{sub}</span>}
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  )
}

function TimelineView({
  vista, days, horas, turnosPorDia, isLoading, onTurnoClick, onSlotClick,
}: {
  vista: Vista
  days: Date[]
  horas: number[]
  turnosPorDia: Map<string, TurnoConRelaciones[]>
  isLoading: boolean
  onTurnoClick: (t: TurnoConRelaciones) => void
  onSlotClick: (day: Date, hour: number) => void
}) {
  // Marcador "ahora"
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(t)
  }, [])

  const nowOffsetPx = useMemo(() => {
    const h = now.getHours()
    const m = now.getMinutes()
    if (h < HOUR_START || h >= HOUR_END) return null
    const min = h * 60 + m
    return ((min - HOUR_START * 60) / 60) * HOUR_HEIGHT
  }, [now])

  return (
    <div className="border rounded-lg bg-card overflow-hidden">
      {/* Header con días */}
      <div className="grid border-b bg-muted/30" style={{ gridTemplateColumns: `48px repeat(${days.length}, 1fr)` }}>
        <div />
        {days.map((day) => {
          const today = isToday(day)
          return (
            <div key={day.toISOString()} className="px-2 py-2 text-center border-l">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                {WEEKDAYS_SHORT[(day.getDay() + 6) % 7]}
              </div>
              <div className={`text-base font-semibold ${today ? "text-primary" : ""}`}>
                {format(day, "d")}
              </div>
            </div>
          )
        })}
      </div>

      {/* Grid horario */}
      <div className="relative overflow-auto" style={{ maxHeight: "min(70vh, 700px)" }}>
        {isLoading && (
          <div className="absolute inset-0 z-10 bg-background/60 backdrop-blur-sm flex items-center justify-center text-sm text-muted-foreground">
            Cargando…
          </div>
        )}
        <div
          className="grid relative"
          style={{
            gridTemplateColumns: `48px repeat(${days.length}, 1fr)`,
            height: `${TOTAL_HEIGHT}px`,
          }}
        >
          {/* Columna de horas */}
          <div className="relative">
            {horas.map((h) => (
              <div
                key={h}
                className="absolute left-0 right-0 text-[10px] text-muted-foreground pr-1 text-right"
                style={{ top: `${(h - HOUR_START) * HOUR_HEIGHT - 5}px` }}
              >
                {h.toString().padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {/* Columnas día */}
          {days.map((day) => {
            const key = format(day, "yyyy-MM-dd")
            const turnos = turnosPorDia.get(key) || []
            const today = isToday(day)
            return (
              <div key={key} className="relative border-l">
                {/* Grid lines */}
                {horas.map((h) => (
                  <div
                    key={h}
                    className="absolute left-0 right-0 border-t border-border/50 hover:bg-accent/30 cursor-pointer"
                    style={{ top: `${(h - HOUR_START) * HOUR_HEIGHT}px`, height: `${HOUR_HEIGHT}px` }}
                    onClick={() => onSlotClick(day, h)}
                    title={`Crear turno a las ${h}:00`}
                  />
                ))}
                {/* Línea "ahora" */}
                {today && nowOffsetPx != null && (
                  <div
                    className="absolute left-0 right-0 z-10 pointer-events-none"
                    style={{ top: `${nowOffsetPx}px` }}
                  >
                    <div className="h-px bg-red-500" />
                    <div className="absolute -left-1 -top-1 w-2 h-2 rounded-full bg-red-500" />
                  </div>
                )}
                {/* Turnos */}
                {turnos.map((t) => (
                  <TurnoBlock
                    key={t.id}
                    turno={t}
                    onClick={() => onTurnoClick(t)}
                    style={turnoStylePx(t)}
                    variant="calendar"
                    compact={vista === "semana"}
                  />
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function MesView({
  cursor, days, turnosPorDia, isLoading, onTurnoClick, onDayClick, onNuevoEnDia,
}: {
  cursor: Date
  days: Date[]
  turnosPorDia: Map<string, TurnoConRelaciones[]>
  isLoading: boolean
  onTurnoClick: (t: TurnoConRelaciones) => void
  onDayClick: (day: Date) => void
  onNuevoEnDia: (day: Date) => void
}) {
  const weeks: Date[][] = useMemo(() => {
    const out: Date[][] = []
    for (let i = 0; i < days.length; i += 7) {
      out.push(days.slice(i, i + 7))
    }
    return out
  }, [days])

  const ESTADO_DOT: Record<string, string> = {
    agendado: "bg-blue-500",
    confirmado: "bg-cyan-500",
    en_camino: "bg-amber-500",
    realizado: "bg-emerald-500",
    orden_generada: "bg-violet-500",
    cancelado: "bg-zinc-400",
    no_show: "bg-red-500",
  }

  return (
    <div className="border rounded-lg bg-card overflow-hidden relative">
      {isLoading && (
        <div className="absolute inset-0 z-10 bg-background/60 backdrop-blur-sm flex items-center justify-center text-sm text-muted-foreground">
          Cargando…
        </div>
      )}
      {/* Header días */}
      <div className="grid grid-cols-7 border-b bg-muted/30">
        {WEEKDAYS_SHORT.map((d) => (
          <div key={d} className="px-2 py-2 text-center text-[10px] text-muted-foreground uppercase tracking-wide border-l first:border-l-0">
            {d}
          </div>
        ))}
      </div>

      {/* Grid semanas */}
      <div className="grid grid-cols-7 auto-rows-fr">
        {weeks.flat().map((day) => {
          const key = format(day, "yyyy-MM-dd")
          const turnos = turnosPorDia.get(key) || []
          const isCurMonth = isSameMonth(day, cursor)
          const today = isToday(day)
          const maxVisible = 3
          const visibles = turnos.slice(0, maxVisible)
          const extra = turnos.length - maxVisible

          return (
            <div
              key={key}
              className={`
                border-l border-t first:border-l-0 min-h-[110px] flex flex-col
                ${isCurMonth ? "bg-card" : "bg-muted/20"}
                ${today ? "ring-2 ring-inset ring-primary/40" : ""}
              `}
            >
              <button
                type="button"
                onClick={() => onDayClick(day)}
                className="flex items-center justify-between px-1.5 py-1 hover:bg-accent/40 transition-colors"
              >
                <span className={`
                  text-xs font-semibold
                  ${!isCurMonth ? "text-muted-foreground/50" : ""}
                  ${today ? "text-primary" : ""}
                `}>
                  {format(day, "d")}
                </span>
                {turnos.length > 0 && (
                  <span className="text-[9px] text-muted-foreground">{turnos.length}</span>
                )}
              </button>

              <div className="flex-1 px-1 pb-1 space-y-0.5 overflow-hidden">
                {visibles.map((t) => {
                  const clienteNombre = t.cliente?.nombre || t.clienteSnapshot?.nombre || "Sin cliente"
                  return (
                    <button
                      key={t.id}
                      onClick={() => onTurnoClick(t)}
                      className={`
                        w-full flex items-center gap-1 px-1 py-0.5 rounded text-[10px]
                        hover:bg-accent transition-colors text-left
                      `}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ESTADO_DOT[t.estado] || "bg-zinc-400"}`} />
                      <span className="font-medium shrink-0">{format(parseISO(t.inicio), "HH:mm")}</span>
                      <span className="truncate opacity-80">{clienteNombre}</span>
                    </button>
                  )
                })}
                {extra > 0 && (
                  <button
                    onClick={() => onDayClick(day)}
                    className="w-full text-left px-1 text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    +{extra} más
                  </button>
                )}
                {turnos.length === 0 && isCurMonth && (
                  <button
                    onClick={() => onNuevoEnDia(day)}
                    className="w-full opacity-0 hover:opacity-100 transition-opacity text-[10px] text-muted-foreground hover:text-primary text-left px-1"
                  >
                    + agregar
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ListaView({
  days, turnosPorDia, isLoading, onClick, onNuevo,
}: {
  days: Date[]
  turnosPorDia: Map<string, TurnoConRelaciones[]>
  isLoading: boolean
  onClick: (t: TurnoConRelaciones) => void
  onNuevo: (day: Date) => void
}) {
  const diasConData = days.filter(d => (turnosPorDia.get(format(d, "yyyy-MM-dd")) || []).length > 0)

  if (isLoading) {
    return <div className="text-center py-12 text-sm text-muted-foreground">Cargando…</div>
  }
  if (diasConData.length === 0) {
    return (
      <div className="border rounded-lg bg-card p-12 text-center">
        <CalendarDays className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm text-muted-foreground mb-3">Sin turnos en este rango</p>
        <Button size="sm" onClick={() => onNuevo(new Date())}>
          <Plus className="mr-1 h-3 w-3" />
          Crear turno
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {diasConData.map((day) => {
        const key = format(day, "yyyy-MM-dd")
        const turnos = turnosPorDia.get(key) || []
        return (
          <div key={key} className="border rounded-lg bg-card overflow-hidden">
            <div className="px-4 py-2 bg-muted/40 border-b flex items-center justify-between">
              <h3 className="text-sm font-semibold capitalize">
                {format(day, "EEEE d 'de' MMMM", { locale: es })}
              </h3>
              <span className="text-xs text-muted-foreground">{turnos.length} turno{turnos.length !== 1 ? "s" : ""}</span>
            </div>
            {turnos.map((t) => (
              <TurnoBlock key={t.id} turno={t} onClick={() => onClick(t)} variant="list" />
            ))}
          </div>
        )
      })}
    </div>
  )
}
