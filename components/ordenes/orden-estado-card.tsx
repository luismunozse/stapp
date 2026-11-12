"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { Clock, AlertTriangle, Timer, Pencil, ArrowRight, ChevronDown } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { todayInTimeZone } from "@/lib/timezone"
import { getTransicionesPosibles, ESTADO_LABELS } from "@/lib/orden-state-machine"
import { siguienteEstado, type AccionEstado } from "@/lib/ordenes/siguiente-estado"
import type { EstadoOrden } from "@/types"

interface OrdenEstadoCardProps {
  estado: EstadoOrden
  fechaIngreso: string | Date
  fechaPrometida?: string | Date | null
  fechaCompletado?: string | Date | null
  updating: boolean
  onUpdateEstado: (estado: EstadoOrden) => void
  esRetiro?: boolean
  /** Persists the promised date (YYYY-MM-DD, or null to clear). Resolves true on success. */
  onUpdateFechaPrometida?: (fecha: string | null) => Promise<boolean>
  /**
   * El paso que la ficha empuja (sale de `accionPrincipalOrden`, según estado y
   * rol). null: ninguno, todo queda en "Cambiar estado…". Sin pasarlo, el paso
   * siguiente del estado.
   */
  accionPrincipal?: AccionEstado | null
  /** Quien mira no puede cambiar el estado (técnico sin la orden asignada). */
  soloLectura?: boolean
}

function ElapsedTime({ since }: { since: string | Date }) {
  const start = new Date(since)
  const now = new Date()
  const diffMs = now.getTime() - start.getTime()
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffHours / 24)
  const remainingHours = diffHours % 24

  if (diffDays > 0) {
    return <span>{diffDays}d {remainingHours}h</span>
  }
  if (diffHours > 0) {
    return <span>{diffHours}h</span>
  }
  const diffMinutes = Math.floor(diffMs / (1000 * 60))
  return <span>{diffMinutes}m</span>
}

export function OrdenEstadoCard({
  estado,
  fechaIngreso,
  fechaPrometida,
  fechaCompletado,
  updating,
  onUpdateEstado,
  esRetiro = false,
  onUpdateFechaPrometida,
  accionPrincipal: accionPrincipalProp,
  soloLectura = false,
}: OrdenEstadoCardProps) {
  const { formatDate, timezone } = useCurrency()
  const [editingFecha, setEditingFecha] = useState(false)
  const [fechaDraft, setFechaDraft] = useState("")
  const [savingFecha, setSavingFecha] = useState(false)
  const [menuAbierto, setMenuAbierto] = useState(false)

  const transicionesPosibles = getTransicionesPosibles(estado)
  const esTerminal = transicionesPosibles.length === 0
  const accionPrincipal = accionPrincipalProp === undefined ? siguienteEstado(estado) : accionPrincipalProp
  const otrasTransiciones = transicionesPosibles.filter((t) => t !== accionPrincipal?.estado)

  const fechaPrometidaVencida = fechaPrometida && new Date(fechaPrometida) < new Date() && estado !== "ENTREGADO" && estado !== "ENTREGADO_SIN_REPARACION" && estado !== "ENTREGADO_SIN_COBRO" && estado !== "CANCELADO" && estado !== "SIN_REPARACION"

  const showElapsed = estado !== "ENTREGADO" && estado !== "ENTREGADO_SIN_REPARACION" && estado !== "ENTREGADO_SIN_COBRO" && estado !== "CANCELADO" && estado !== "SIN_REPARACION"

  const puedeEditarFecha = !!onUpdateFechaPrometida && showElapsed

  const startEditFecha = () => {
    // Same calendar day that formatDate displays for the stored instant.
    setFechaDraft(fechaPrometida ? todayInTimeZone(timezone, new Date(fechaPrometida)) : "")
    setEditingFecha(true)
  }

  const commitFecha = async (value: string | null) => {
    if (!onUpdateFechaPrometida) return
    setSavingFecha(true)
    try {
      if (await onUpdateFechaPrometida(value)) setEditingFecha(false)
    } finally {
      setSavingFecha(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Estado
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {esTerminal || soloLectura ? (
          <div className={`text-sm font-medium text-center py-2 px-3 rounded-md ${esRetiro ? "bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800" : "bg-muted"}`}>
            {esRetiro ? "Retirado sin reparación" : ESTADO_LABELS[estado]}
          </div>
        ) : (
          <div className="space-y-2">
            {accionPrincipal && (
              <Button
                className="w-full"
                size="lg"
                loading={updating}
                onClick={() => onUpdateEstado(accionPrincipal.estado)}
                disabled={updating}
              >
                {accionPrincipal.label}
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            )}
            {otrasTransiciones.length > 0 && (
              <Popover open={menuAbierto} onOpenChange={setMenuAbierto}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full h-11" disabled={updating}>
                    {accionPrincipal ? "Más estados…" : "Cambiar estado…"}
                    <ChevronDown className="h-4 w-4 ml-2" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" collisionPadding={16} className="w-[var(--radix-popover-trigger-width)] p-1">
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">Actual: {ESTADO_LABELS[estado]}</div>
                  <DropdownMenuSeparator />
                  {otrasTransiciones.map((key) => (
                    <DropdownMenuItem
                      key={key}
                      onClick={() => {
                        setMenuAbierto(false)
                        onUpdateEstado(key)
                      }}
                    >
                      {ESTADO_LABELS[key]}
                    </DropdownMenuItem>
                  ))}
                </PopoverContent>
              </Popover>
            )}
          </div>
        )}

        {fechaPrometidaVencida && (
          <div className="flex items-center gap-2 p-2 rounded-md bg-destructive/10 border border-destructive/25 text-xs">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive-text shrink-0" />
            <span className="text-destructive-text font-medium">
              Fecha prometida vencida
            </span>
          </div>
        )}

        {showElapsed && (
          <div className="flex items-center gap-2 p-2 rounded-md bg-muted text-xs">
            <Timer className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">En este estado hace</span>
            <span className="font-medium ml-auto">
              <ElapsedTime since={fechaIngreso} />
            </span>
          </div>
        )}

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Ingreso</span>
            <span>{formatDate(fechaIngreso)}</span>
          </div>
          {editingFecha ? (
            <div className="space-y-2" onKeyDown={(e) => { if (e.key === "Escape") setEditingFecha(false) }}>
              {/* No fixed id: the card is mounted twice (mobile + desktop). */}
              <span className="text-muted-foreground">Prometida</span>
              <Input
                aria-label="Fecha prometida"
                type="date"
                value={fechaDraft}
                onChange={(e) => setFechaDraft(e.target.value)}
                disabled={savingFecha}
                autoFocus
              />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={savingFecha} onClick={() => commitFecha(fechaDraft || null)}>
                  Guardar
                </Button>
                <Button size="sm" variant="outline" disabled={savingFecha} onClick={() => setEditingFecha(false)}>
                  Cancelar
                </Button>
                {fechaPrometida && (
                  <Button size="sm" variant="ghost" disabled={savingFecha} onClick={() => commitFecha(null)}>
                    Quitar
                  </Button>
                )}
              </div>
            </div>
          ) : fechaPrometida ? (
            <div className="flex justify-between items-center">
              <span className={`text-muted-foreground ${fechaPrometidaVencida ? "text-red-600 dark:text-red-400" : ""}`}>Prometida</span>
              <span className="flex items-center gap-1.5">
                <span className={fechaPrometidaVencida ? "text-red-600 dark:text-red-400 font-medium" : ""}>
                  {formatDate(fechaPrometida)}
                </span>
                {puedeEditarFecha && (
                  <button
                    type="button"
                    aria-label="Editar fecha prometida"
                    onClick={startEditFecha}
                    className="-m-1.5 rounded p-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </span>
            </div>
          ) : puedeEditarFecha ? (
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Prometida</span>
              <button type="button" onClick={startEditFecha} className="text-xs text-primary hover:underline">
                Agregar
              </button>
            </div>
          ) : null}
          {fechaCompletado && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Completado</span>
              <span>{formatDate(fechaCompletado)}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
