"use client"

import { useState, useMemo } from "react"
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
  Clock,
  User,
  Wrench,
  MapPin,
  FileText,
} from "lucide-react"
import {
  format,
  startOfWeek,
  endOfWeek,
  addDays,
  addWeeks,
  subWeeks,
  isToday,
  isSameDay,
  parseISO,
} from "date-fns"
import { es } from "date-fns/locale"
import { TurnoFormDialog } from "./turno-form-dialog"
import { TurnoDetailSheet } from "./turno-detail-sheet"
import type { EstadoTurno, TipoTurno, TurnoConRelaciones } from "@/types"

const fetcher = (u: string) => fetch(u).then(r => r.json())

const TIPO_LABELS: Record<TipoTurno, string> = {
  visita_diagnostico: "Diagnóstico",
  reparacion_onsite: "Reparación on-site",
  retiro: "Retiro",
  entrega: "Entrega",
  mantenimiento: "Mantenimiento",
}

const ESTADO_DOT_COLORS: Record<EstadoTurno, string> = {
  agendado: "bg-blue-500",
  confirmado: "bg-cyan-500",
  en_camino: "bg-amber-500",
  realizado: "bg-emerald-500",
  orden_generada: "bg-violet-500",
  cancelado: "bg-zinc-400",
  no_show: "bg-red-500",
}

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]

export function AgendaView() {
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === "ADMIN"

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [filterTecnico, setFilterTecnico] = useState<string>("_todos_")
  const [filterEstado, setFilterEstado] = useState<string>("_todos_")
  const [selectedDay, setSelectedDay] = useState<Date | null>(new Date())

  const [formOpen, setFormOpen] = useState(false)
  const [editTurno, setEditTurno] = useState<TurnoConRelaciones | null>(null)
  const [detailTurno, setDetailTurno] = useState<TurnoConRelaciones | null>(null)
  const [defaultInicio, setDefaultInicio] = useState<Date | null>(null)

  const desde = format(weekStart, "yyyy-MM-dd")
  const hasta = format(endOfWeek(weekStart, { weekStartsOn: 1 }), "yyyy-MM-dd")

  const queryParts = [`desde=${desde}`, `hasta=${hasta}`]
  if (filterTecnico !== "_todos_") queryParts.push(`tecnicoId=${filterTecnico}`)
  if (filterEstado !== "_todos_") queryParts.push(`estado=${filterEstado}`)

  const { data, isLoading, mutate } = useSWR<{ turnos: TurnoConRelaciones[] }>(
    `/api/turnos?${queryParts.join("&")}`,
    fetcher,
    { revalidateOnFocus: true, refreshInterval: 60000 },
  )

  const { data: tecnicosData } = useSWR<any>(
    isAdmin ? "/api/tecnicos" : null,
    fetcher,
  )
  const tecnicos: { id: string; nombre: string }[] = useMemo(() => {
    return Array.isArray(tecnicosData) ? tecnicosData : (tecnicosData?.tecnicos || [])
  }, [tecnicosData])

  const turnos = data?.turnos || []

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  }, [weekStart])

  const turnosPorDia = useMemo(() => {
    const map = new Map<string, TurnoConRelaciones[]>()
    for (const t of turnos) {
      const key = format(parseISO(t.inicio), "yyyy-MM-dd")
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(t)
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.inicio.localeCompare(b.inicio))
    }
    return map
  }, [turnos])

  const turnosSeleccionados = useMemo(() => {
    if (!selectedDay) return []
    return turnosPorDia.get(format(selectedDay, "yyyy-MM-dd")) || []
  }, [selectedDay, turnosPorDia])

  const handleNuevo = (paraFecha?: Date) => {
    setEditTurno(null)
    setDefaultInicio(paraFecha || selectedDay || new Date())
    setFormOpen(true)
  }

  const handleEditFromDetail = (t: TurnoConRelaciones) => {
    setDetailTurno(null)
    setEditTurno(t)
    setDefaultInicio(null)
    setFormOpen(true)
  }

  return (
    <div className="space-y-4">
      {/* Filtros + acciones */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setWeekStart(subWeeks(weekStart, 1))}
            aria-label="Semana anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const today = new Date()
              setWeekStart(startOfWeek(today, { weekStartsOn: 1 }))
              setSelectedDay(today)
            }}
          >
            Hoy
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setWeekStart(addWeeks(weekStart, 1))}
            aria-label="Semana siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium capitalize ml-2">
            {format(weekStart, "MMMM yyyy", { locale: es })}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
          <Select value={filterEstado} onValueChange={setFilterEstado}>
            <SelectTrigger className="w-[140px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_todos_">Todos</SelectItem>
              <SelectItem value="agendado">Agendado</SelectItem>
              <SelectItem value="confirmado">Confirmado</SelectItem>
              <SelectItem value="en_camino">En camino</SelectItem>
              <SelectItem value="realizado">Realizado</SelectItem>
              <SelectItem value="orden_generada">Con orden</SelectItem>
              <SelectItem value="cancelado">Cancelado</SelectItem>
              <SelectItem value="no_show">No se presentó</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => handleNuevo()}>
            <Plus className="mr-2 h-4 w-4" />
            Nuevo turno
          </Button>
        </div>
      </div>

      {/* Grilla semana */}
      <div className="border rounded-lg overflow-hidden bg-card">
        <div className="grid grid-cols-7 border-b">
          {days.map((day, i) => {
            const key = format(day, "yyyy-MM-dd")
            const turnosDelDia = turnosPorDia.get(key) || []
            const isSelected = selectedDay && isSameDay(day, selectedDay)
            const today = isToday(day)

            return (
              <button
                key={key}
                onClick={() => setSelectedDay(day)}
                className={`
                  p-3 text-left border-r last:border-r-0 transition-colors min-h-[80px]
                  ${isSelected ? "bg-primary/10" : "hover:bg-accent/40"}
                  ${today ? "font-semibold" : ""}
                `}
              >
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-xs text-muted-foreground">{WEEKDAYS[i]}</span>
                  <span className={`text-lg ${today ? "text-primary" : ""}`}>
                    {format(day, "d")}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {turnosDelDia.slice(0, 6).map((t) => (
                    <span
                      key={t.id}
                      className={`w-2 h-2 rounded-full ${ESTADO_DOT_COLORS[t.estado]}`}
                    />
                  ))}
                  {turnosDelDia.length > 6 && (
                    <span className="text-[10px] text-muted-foreground">+{turnosDelDia.length - 6}</span>
                  )}
                </div>
                {turnosDelDia.length > 0 && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {turnosDelDia.length} turno{turnosDelDia.length !== 1 ? "s" : ""}
                  </p>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Lista del día seleccionado */}
      {selectedDay && (
        <div className="border rounded-lg bg-card">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h3 className="font-semibold capitalize">
              {format(selectedDay, "EEEE d 'de' MMMM", { locale: es })}
            </h3>
            <Button size="sm" variant="outline" onClick={() => {
              const d = new Date(selectedDay)
              d.setHours(9, 0, 0, 0)
              handleNuevo(d)
            }}>
              <Plus className="mr-1 h-3 w-3" />
              Agregar
            </Button>
          </div>
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Cargando...</div>
          ) : turnosSeleccionados.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              <CalendarDays className="h-8 w-8 mx-auto mb-2 opacity-40" />
              Sin turnos para este día
            </div>
          ) : (
            <div className="divide-y">
              {turnosSeleccionados.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setDetailTurno(t)}
                  className="w-full text-left p-4 hover:bg-accent/40 transition-colors flex gap-3 items-start"
                >
                  <div className={`shrink-0 w-1 h-12 rounded-full ${ESTADO_DOT_COLORS[t.estado]}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap mb-1">
                      <span className="font-medium text-sm flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        {format(parseISO(t.inicio), "HH:mm")}
                        {t.fin && ` — ${format(parseISO(t.fin), "HH:mm")}`}
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-muted">
                        {TIPO_LABELS[t.tipo]}
                      </span>
                      {t.orden && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300 flex items-center gap-1">
                          <FileText className="h-3 w-3" />
                          {t.orden.codigoOrden || `#${t.orden.numeroOrden}`}
                        </span>
                      )}
                    </div>
                    <p className="text-sm flex items-center gap-1 truncate">
                      <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      {t.cliente?.nombre || t.clienteSnapshot?.nombre || "Sin cliente"}
                    </p>
                    {t.tecnico && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Wrench className="h-3 w-3" />
                        {t.tecnico.nombre}
                      </p>
                    )}
                    {t.direccion && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
                        <MapPin className="h-3 w-3 shrink-0" />
                        {t.direccion}
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
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
