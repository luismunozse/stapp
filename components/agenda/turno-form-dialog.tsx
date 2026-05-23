"use client"

import { useState, useEffect, useMemo } from "react"
import useSWR from "swr"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ClienteSelector } from "@/components/cotizaciones/cliente-selector"
import { Loader2 } from "lucide-react"
import type { TipoTurno, TurnoConRelaciones } from "@/types"

const fetcher = (u: string) => fetch(u).then(r => r.json())

interface TurnoFormDialogProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
  turno?: TurnoConRelaciones | null
  defaultInicio?: Date | null
}

interface TecnicoOpt {
  id: string
  nombre: string
}

const TIPO_LABELS: Record<TipoTurno, string> = {
  visita_diagnostico: "Visita de diagnóstico",
  reparacion_onsite: "Reparación en sitio",
  retiro: "Retiro de equipo",
  entrega: "Entrega de equipo",
  mantenimiento: "Mantenimiento",
}

function toLocalInput(iso: string | Date | null | undefined): string {
  if (!iso) return ""
  const d = typeof iso === "string" ? new Date(iso) : iso
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function TurnoFormDialog({
  open,
  onClose,
  onSaved,
  turno,
  defaultInicio,
}: TurnoFormDialogProps) {
  const isEdit = !!turno
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [clienteId, setClienteId] = useState<string | null>(null)
  const [usarSnapshot, setUsarSnapshot] = useState(false)
  const [snapNombre, setSnapNombre] = useState("")
  const [snapTelefono, setSnapTelefono] = useState("")
  const [snapEmail, setSnapEmail] = useState("")
  const [tecnicoId, setTecnicoId] = useState<string>("")
  const [inicio, setInicio] = useState("")
  const [fin, setFin] = useState("")
  const [direccion, setDireccion] = useState("")
  const [tipo, setTipo] = useState<TipoTurno>("visita_diagnostico")
  const [tipoDispositivo, setTipoDispositivo] = useState("")
  const [marca, setMarca] = useState("")
  const [modelo, setModelo] = useState("")
  const [problemaReportado, setProblemaReportado] = useState("")
  const [notas, setNotas] = useState("")
  // Recurrencia
  const [recurrente, setRecurrente] = useState(false)
  const [recFrecuencia, setRecFrecuencia] = useState<"diaria" | "semanal" | "mensual">("semanal")
  const [recIntervalo, setRecIntervalo] = useState("1")
  const [recTotal, setRecTotal] = useState("4")
  // Disponibilidad
  const [dispCheck, setDispCheck] = useState<null | {
    disponible: boolean
    fueraDeHorario: boolean
    razonHorario?: string
    conflictos: Array<{ id: string; inicio: string; clienteNombre: string | null }>
  }>(null)

  const { data: tecnicosData } = useSWR<TecnicoOpt[] | { tecnicos?: TecnicoOpt[] }>(
    open ? "/api/tecnicos" : null,
    fetcher,
  )
  const tecnicos: TecnicoOpt[] = Array.isArray(tecnicosData)
    ? tecnicosData
    : (tecnicosData?.tecnicos || [])

  useEffect(() => {
    if (!open) return
    if (turno) {
      setClienteId(turno.clienteId)
      setUsarSnapshot(!turno.clienteId && !!turno.clienteSnapshot)
      setSnapNombre(turno.clienteSnapshot?.nombre || "")
      setSnapTelefono(turno.clienteSnapshot?.telefono || "")
      setSnapEmail(turno.clienteSnapshot?.email || "")
      setTecnicoId(turno.tecnicoId || "")
      setInicio(toLocalInput(turno.inicio))
      setFin(toLocalInput(turno.fin))
      setDireccion(turno.direccion || "")
      setTipo(turno.tipo)
      setTipoDispositivo(turno.tipoDispositivo || "")
      setMarca(turno.marca || "")
      setModelo(turno.modelo || "")
      setProblemaReportado(turno.problemaReportado || "")
      setNotas(turno.notas || "")
      setRecurrente(false)
      setRecFrecuencia("semanal")
      setRecIntervalo("1")
      setRecTotal("4")
    } else {
      setClienteId(null)
      setUsarSnapshot(false)
      setSnapNombre("")
      setSnapTelefono("")
      setSnapEmail("")
      setTecnicoId("")
      setInicio(toLocalInput(defaultInicio || new Date()))
      setFin("")
      setDireccion("")
      setTipo("visita_diagnostico")
      setTipoDispositivo("")
      setMarca("")
      setModelo("")
      setProblemaReportado("")
      setNotas("")
      setRecurrente(false)
      setRecFrecuencia("semanal")
      setRecIntervalo("1")
      setRecTotal("4")
    }
    setError(null)
    setDispCheck(null)
  }, [open, turno, defaultInicio])

  // Check disponibilidad cuando hay técnico + inicio
  useEffect(() => {
    if (!tecnicoId || !inicio) {
      setDispCheck(null)
      return
    }
    let cancelled = false
    const url = new URL("/api/turnos/disponibilidad", window.location.origin)
    url.searchParams.set("tecnicoId", tecnicoId)
    url.searchParams.set("inicio", new Date(inicio).toISOString())
    if (fin) url.searchParams.set("fin", new Date(fin).toISOString())
    if (turno?.id) url.searchParams.set("excludeTurnoId", turno.id)
    const t = setTimeout(() => {
      fetch(url.toString())
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (!cancelled && d) setDispCheck(d) })
        .catch(() => {})
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [tecnicoId, inicio, fin, turno?.id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!clienteId && !usarSnapshot) {
      setError("Seleccioná un cliente o marcá 'cliente nuevo (sin registrar)'")
      return
    }
    if (usarSnapshot && (!snapNombre.trim() || !snapTelefono.trim())) {
      setError("Cliente nuevo requiere nombre y teléfono")
      return
    }
    if (!inicio) {
      setError("Fecha y hora de inicio obligatoria")
      return
    }

    const payload: any = {
      tipo,
      inicio: new Date(inicio).toISOString(),
      fin: fin ? new Date(fin).toISOString() : undefined,
      direccion: direccion.trim() || undefined,
      tecnicoId: tecnicoId || undefined,
      tipoDispositivo: tipoDispositivo.trim() || undefined,
      marca: marca.trim() || undefined,
      modelo: modelo.trim() || undefined,
      problemaReportado: problemaReportado.trim() || undefined,
      notas: notas.trim() || undefined,
    }

    if (usarSnapshot) {
      payload.clienteSnapshot = {
        nombre: snapNombre.trim(),
        telefono: snapTelefono.trim(),
        email: snapEmail.trim() || null,
      }
    } else {
      payload.clienteId = clienteId
    }

    // Recurrencia (sólo al crear)
    if (!isEdit && recurrente) {
      const intervalo = parseInt(recIntervalo) || 1
      const total = parseInt(recTotal) || 1
      if (total < 2 || total > 52) {
        setError("Total de ocurrencias debe estar entre 2 y 52")
        return
      }
      payload.recurrencia = {
        frecuencia: recFrecuencia,
        intervalo,
        total,
      }
    }

    setSaving(true)
    try {
      const url = isEdit ? `/api/turnos/${turno!.id}` : "/api/turnos"
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || "Error al guardar turno")
      }
      onSaved()
      onClose()
    } catch (err: any) {
      setError(err.message || "Error inesperado")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar turno" : "Nuevo turno"}</DialogTitle>
          <DialogDescription>
            Agendá la visita; al realizarse podés generar la orden con los mismos datos.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Cliente */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Cliente</Label>
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => {
                  setUsarSnapshot(s => !s)
                  setClienteId(null)
                }}
              >
                {usarSnapshot ? "Buscar cliente existente" : "Cliente nuevo (sin registrar)"}
              </button>
            </div>
            {usarSnapshot ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Input
                  placeholder="Nombre / Razón social"
                  value={snapNombre}
                  onChange={(e) => setSnapNombre(e.target.value)}
                  required
                />
                <Input
                  placeholder="Teléfono"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={snapTelefono}
                  onChange={(e) => setSnapTelefono(e.target.value)}
                  required
                />
                <Input
                  placeholder="Email (opcional)"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={snapEmail}
                  onChange={(e) => setSnapEmail(e.target.value)}
                  className="sm:col-span-2"
                />
              </div>
            ) : (
              <ClienteSelector
                value={clienteId}
                onChange={(id) => setClienteId(id)}
              />
            )}
          </div>

          {/* Tipo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-sm">Tipo de turno</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as TipoTurno)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TIPO_LABELS) as TipoTurno[]).map((t) => (
                    <SelectItem key={t} value={t}>{TIPO_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm">Técnico asignado</Label>
              <Select value={tecnicoId || "_none_"} onValueChange={(v) => setTecnicoId(v === "_none_" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Sin asignar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none_">Sin asignar</SelectItem>
                  {tecnicos.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Fechas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-sm">Inicio *</Label>
              <Input
                type="datetime-local"
                value={inicio}
                onChange={(e) => setInicio(e.target.value)}
                required
              />
            </div>
            <div>
              <Label className="text-sm">Fin estimado</Label>
              <Input
                type="datetime-local"
                value={fin}
                onChange={(e) => setFin(e.target.value)}
              />
            </div>
          </div>

          {/* Dirección */}
          <div>
            <Label className="text-sm">Dirección de la visita</Label>
            <Input
              value={direccion}
              onChange={(e) => setDireccion(e.target.value)}
              placeholder="Av. Corrientes 1234, CABA"
            />
          </div>

          {/* Equipo */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-sm">Tipo de equipo</Label>
              <Input
                value={tipoDispositivo}
                onChange={(e) => setTipoDispositivo(e.target.value)}
                placeholder="Heladera industrial"
              />
            </div>
            <div>
              <Label className="text-sm">Marca</Label>
              <Input value={marca} onChange={(e) => setMarca(e.target.value)} />
            </div>
            <div>
              <Label className="text-sm">Modelo</Label>
              <Input value={modelo} onChange={(e) => setModelo(e.target.value)} />
            </div>
          </div>

          {/* Problema */}
          <div>
            <Label className="text-sm">Problema reportado</Label>
            <Textarea
              value={problemaReportado}
              onChange={(e) => setProblemaReportado(e.target.value)}
              rows={2}
              placeholder="No enfría, hace ruido al encender..."
            />
          </div>

          {/* Notas */}
          <div>
            <Label className="text-sm">Notas internas</Label>
            <Textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={2}
            />
          </div>

          {/* Recurrencia (solo al crear) */}
          {!isEdit && (
            <div className="border-t pt-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={recurrente}
                  onChange={(e) => setRecurrente(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <span className="text-sm font-medium">Repetir (mantenimiento periódico)</span>
              </label>
              {recurrente && (
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <div>
                    <Label className="text-xs">Frecuencia</Label>
                    <Select value={recFrecuencia} onValueChange={(v) => setRecFrecuencia(v as any)}>
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="diaria">Diaria</SelectItem>
                        <SelectItem value="semanal">Semanal</SelectItem>
                        <SelectItem value="mensual">Mensual</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Cada</Label>
                    <Input
                      type="number"
                      min="1"
                      max="12"
                      value={recIntervalo}
                      onChange={(e) => setRecIntervalo(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Total ocurrencias</Label>
                    <Input
                      type="number"
                      min="2"
                      max="52"
                      value={recTotal}
                      onChange={(e) => setRecTotal(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Disponibilidad warning */}
          {dispCheck && (dispCheck.conflictos.length > 0 || dispCheck.fueraDeHorario) && (
            <div className="text-sm rounded p-2 border bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200">
              {dispCheck.fueraDeHorario && (
                <p>⚠️ {dispCheck.razonHorario || "Fuera del horario laboral del técnico"}</p>
              )}
              {dispCheck.conflictos.length > 0 && (
                <div className="mt-1">
                  <p>⚠️ Conflicto con {dispCheck.conflictos.length} turno{dispCheck.conflictos.length !== 1 ? "s" : ""} del mismo técnico:</p>
                  <ul className="list-disc list-inside text-xs mt-1">
                    {dispCheck.conflictos.slice(0, 3).map((c) => (
                      <li key={c.id}>
                        {new Date(c.inicio).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}
                        {c.clienteNombre ? ` — ${c.clienteNombre}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-xs mt-1 opacity-80">Se puede guardar igualmente.</p>
            </div>
          )}

          {error && (
            <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded p-2">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEdit ? "Guardar cambios" : "Agendar turno"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
