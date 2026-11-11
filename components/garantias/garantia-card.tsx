"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { AlertTriangle, Pencil, Plus, Shield } from "lucide-react"
import { useModal } from "@/contexts/modal-context"
import { useCurrency } from "@/contexts/currency-context"
import { textoVencimiento } from "@/lib/garantias/estado"
import type { GarantiaConReclamos } from "@/lib/garantias/reclamos"
import type { ReclamoGarantiaApi } from "@/lib/garantias/formato"
import { EstadoGarantiaPill } from "./estado-garantia-pill"
import { RegistrarReclamoDialog } from "./registrar-reclamo-dialog"
import { DecidirReclamoDialog, type DecidirReclamoDialogProps } from "./decidir-reclamo-dialog"
import { ReclamosTimeline } from "./reclamos-timeline"

interface Garantia {
  id: string
  ordenId: string
  diasValidez: number
  fechaInicio: string
  fechaVencimiento: string
  estado: string
  notas: string | null
}

interface GarantiaCardProps {
  ordenId: string
  ordenEstado: string
  garantiaDiasDefault?: number
  /** Crear y editar la garantía, y decidir reclamos, es solo de ADMIN (la API
   *  responde 403 al resto). Registrar un reclamo lo puede hacer cualquier rol. */
  isAdmin?: boolean
}

/**
 * La garantía de una orden entregada: vigencia con el estado derivado (por día
 * de la org, como /garantias), los reclamos como línea de tiempo con el link
 * al re-ingreso, y las acciones del flujo único de reclamos (fase 2).
 */
export function GarantiaCard({
  ordenId,
  ordenEstado,
  garantiaDiasDefault = 30,
  isAdmin = false,
}: GarantiaCardProps) {
  const { showError } = useModal()
  const { formatDate } = useCurrency()
  const [garantia, setGarantia] = useState<Garantia | null>(null)
  const [detalle, setDetalle] = useState<GarantiaConReclamos | null>(null)
  const [loading, setLoading] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [creating, setCreating] = useState(false)
  const [diasValidez, setDiasValidez] = useState(String(garantiaDiasDefault))
  const [notas, setNotas] = useState("")
  const [showEditForm, setShowEditForm] = useState(false)
  const [editDias, setEditDias] = useState("30")
  const [editNotas, setEditNotas] = useState("")
  const [saving, setSaving] = useState(false)
  const [registrando, setRegistrando] = useState(false)
  const [decision, setDecision] = useState<DecidirReclamoDialogProps["pendiente"]>(null)

  const fetchGarantia = useCallback(async () => {
    try {
      const [res, resReclamos] = await Promise.all([
        fetch(`/api/garantias?ordenId=${encodeURIComponent(ordenId)}`),
        fetch(`/api/garantias/reclamos?ordenId=${encodeURIComponent(ordenId)}`),
      ])
      const data = await res.json()
      // La API ya filtra por orden; el find es una red de seguridad.
      const garantiaOrden = Array.isArray(data) ? data.find((g: Garantia) => g.ordenId === ordenId) : null
      setGarantia(garantiaOrden || null)
      if (resReclamos.ok) {
        const r = (await resReclamos.json()) as { garantias?: GarantiaConReclamos[] }
        setDetalle(r.garantias?.[0] ?? null)
      } else {
        setDetalle(null)
      }
    } catch (error) {
      console.error("Error fetching garantia:", error)
    } finally {
      setLoading(false)
    }
  }, [ordenId])

  useEffect(() => {
    if (ordenEstado === "ENTREGADO") {
      void fetchGarantia()
    } else {
      setLoading(false)
    }
  }, [ordenEstado, fetchGarantia])

  const handleCreateGarantia = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreating(true)
    try {
      const res = await fetch("/api/garantias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ordenId,
          diasValidez: Math.max(1, parseInt(diasValidez, 10) || 30),
          notas: notas || undefined,
        }),
      })

      if (!res.ok) {
        const error = await res.json()
        await showError(error.error || "Error al crear garantía")
        return
      }

      setShowCreateForm(false)
      void fetchGarantia()
    } catch (error) {
      console.error("Error:", error)
      await showError("Error al crear garantía")
    } finally {
      setCreating(false)
    }
  }

  const openEditForm = () => {
    if (!garantia) return
    setEditDias(String(garantia.diasValidez))
    setEditNotas(garantia.notas || "")
    setShowEditForm(true)
  }

  const handleUpdateGarantia = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!garantia) return
    setSaving(true)
    try {
      const res = await fetch(`/api/garantias/${garantia.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          diasValidez: Math.max(1, parseInt(editDias, 10) || 30),
          notas: editNotas,
        }),
      })

      if (!res.ok) {
        const error = await res.json()
        await showError(error.error || "Error al actualizar garantía")
        return
      }

      setShowEditForm(false)
      void fetchGarantia()
    } catch (error) {
      console.error("Error:", error)
      await showError("Error al actualizar garantía")
    } finally {
      setSaving(false)
    }
  }

  const abrirDecision = (r: ReclamoGarantiaApi, accion: "aceptar" | "rechazar") =>
    setDecision({ reclamoId: r.id, accion, descripcion: r.descripcion })

  // Solo mostrar si la orden está ENTREGADO
  if (ordenEstado !== "ENTREGADO") {
    return null
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-4 text-center text-muted-foreground">Cargando garantía…</CardContent>
      </Card>
    )
  }

  // Si no hay garantía, mostrar opción de crear
  if (!garantia) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Garantía
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!showCreateForm || !isAdmin ? (
            <div className="text-center py-4">
              <p className="text-muted-foreground mb-4">Esta orden no tiene garantía registrada</p>
              {isAdmin && (
                <Button onClick={() => setShowCreateForm(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Crear garantía
                </Button>
              )}
            </div>
          ) : (
            <form onSubmit={handleCreateGarantia} className="space-y-4">
              <div>
                <Label htmlFor="diasValidez">Días de validez</Label>
                <Input
                  id="diasValidez"
                  type="number"
                  min="1"
                  value={diasValidez}
                  onChange={(e) => setDiasValidez(e.target.value)}
                  disabled={creating}
                />
              </div>
              <div>
                <Label htmlFor="notas">Notas</Label>
                <Textarea
                  id="notas"
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                  placeholder="Condiciones de la garantía…"
                  rows={2}
                  disabled={creating}
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => setShowCreateForm(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={creating}>
                  {creating ? "Creando…" : "Crear garantía"}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    )
  }

  const estado = detalle?.estado ?? null
  const registrar = detalle?.acciones.registrarReclamo ?? null
  const reclamos = detalle?.reclamos ?? []

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Garantía
          </CardTitle>
          <div className="flex items-center gap-2">
            {estado ? <EstadoGarantiaPill estado={estado} /> : null}
            {isAdmin && !showEditForm && (
              <Button variant="ghost" size="sm" className="min-h-11 min-w-11" onClick={openEditForm} title="Editar garantía" aria-label="Editar garantía">
                <Pencil className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isAdmin && showEditForm ? (
          <form onSubmit={handleUpdateGarantia} className="space-y-4">
            <div>
              <Label htmlFor="editDias">Días de validez</Label>
              <Input
                id="editDias"
                type="number"
                min="1"
                value={editDias}
                onChange={(e) => setEditDias(e.target.value)}
                disabled={saving}
              />
              <p className="text-xs text-muted-foreground mt-1">El vencimiento se recalcula desde la fecha de inicio.</p>
            </div>
            <div>
              <Label htmlFor="editNotas">Notas</Label>
              <Textarea
                id="editNotas"
                value={editNotas}
                onChange={(e) => setEditNotas(e.target.value)}
                placeholder="Condiciones de la garantía…"
                rows={2}
                disabled={saving}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => setShowEditForm(false)} disabled={saving}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Guardando…" : "Guardar cambios"}
              </Button>
            </div>
          </form>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3 bg-muted rounded-lg">
              <div>
                <div className="text-xs text-muted-foreground">Inicio</div>
                <div className="font-medium">{formatDate(garantia.fechaInicio)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Vencimiento</div>
                <div className="font-medium">{formatDate(garantia.fechaVencimiento)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Duración</div>
                <div className="font-medium">{garantia.diasValidez} días</div>
              </div>
              {detalle ? (
                <div>
                  <div className="text-xs text-muted-foreground">Vigencia</div>
                  <div className="font-medium">{textoVencimiento(detalle.diasRestantes)}</div>
                </div>
              ) : null}
            </div>

            {garantia.notas && (
              <div className="text-sm">
                <span className="font-medium">Notas:</span>
                <p className="text-muted-foreground">{garantia.notas}</p>
              </div>
            )}

            {registrar && (
              <Button variant="outline" className="min-h-11 w-full" onClick={() => setRegistrando(true)}>
                <AlertTriangle className="mr-2 h-4 w-4" />
                {registrar === "forzar" ? "Registrar reclamo fuera de garantía" : "Registrar reclamo"}
              </Button>
            )}

            <ReclamosTimeline
              reclamos={reclamos}
              formatDate={formatDate}
              puedeDecidir={isAdmin}
              onDecidir={abrirDecision}
            />
          </>
        )}
      </CardContent>

      {registrar && (
        <RegistrarReclamoDialog
          open={registrando}
          onOpenChange={setRegistrando}
          origen="REPARACION"
          garantiaId={garantia.id}
          modo={registrar}
          onRegistrado={() => void fetchGarantia()}
        />
      )}
      <DecidirReclamoDialog pendiente={decision} onClose={() => setDecision(null)} onDecidido={() => void fetchGarantia()} />
    </Card>
  )
}
