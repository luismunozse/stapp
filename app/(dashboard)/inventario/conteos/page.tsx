"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import {
  Plus,
  ClipboardCheck,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  PlayCircle,
} from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"

interface Conteo {
  id: string
  nombre: string
  estado: "EN_PROGRESO" | "FINALIZADO" | "CANCELADO"
  depositoId: string | null
  depositoNombre: string | null
  tipo: "COMPLETO" | "PARCIAL" | "CICLICO"
  totalItems: number
  itemsContados: number
  itemsDiferencia: number
  itemsAjustados: number
  aplicarAjustes: boolean
  iniciadoAt: string
  finalizadoAt: string | null
  createdAt: string
}

interface Deposito {
  id: string
  nombre: string
  principal: boolean
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function estadoBadge(estado: Conteo["estado"]) {
  switch (estado) {
    case "EN_PROGRESO":
      return (
        <Badge variant="outline" className="gap-1 border-blue-500/60 text-blue-600">
          <PlayCircle className="h-3 w-3" /> En progreso
        </Badge>
      )
    case "FINALIZADO":
      return (
        <Badge variant="outline" className="gap-1 border-emerald-500/60 text-emerald-600">
          <CheckCircle2 className="h-3 w-3" /> Finalizado
        </Badge>
      )
    case "CANCELADO":
      return (
        <Badge variant="outline" className="gap-1 border-muted-foreground/40 text-muted-foreground">
          <XCircle className="h-3 w-3" /> Cancelado
        </Badge>
      )
  }
}

export default function ConteosPage() {
  const router = useRouter()
  const { data: conteosRes, isLoading, mutate } = useSWR<{ data: Conteo[] }>("/api/conteos", fetcher)
  const { data: depositosRes } = useSWR<{ data: Deposito[] }>("/api/depositos", fetcher)
  const conteos = conteosRes?.data || []
  const depositos = depositosRes?.data || []

  const [dialogOpen, setDialogOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState("")

  // form
  const [nombre, setNombre] = useState("")
  const [depositoId, setDepositoId] = useState<string>("__all__")
  const [tipo, setTipo] = useState<"COMPLETO" | "PARCIAL" | "CICLICO">("PARCIAL")
  const [categoria, setCategoria] = useState("")
  const [tipoDispositivo, setTipoDispositivo] = useState("")
  const [soloConStock, setSoloConStock] = useState(true)
  const [aplicarAjustes, setAplicarAjustes] = useState(true)
  const [notas, setNotas] = useState("")

  const resetForm = useCallback(() => {
    const today = new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })
    setNombre(`Conteo ${today}`)
    setDepositoId("__all__")
    setTipo("PARCIAL")
    setCategoria("")
    setTipoDispositivo("")
    setSoloConStock(true)
    setAplicarAjustes(true)
    setNotas("")
    setError("")
  }, [])

  useEffect(() => {
    if (dialogOpen) resetForm()
  }, [dialogOpen, resetForm])

  const handleCreate = async () => {
    setError("")
    if (!nombre.trim()) {
      setError("Nombre requerido")
      return
    }
    setCreating(true)
    try {
      const res = await fetch("/api/conteos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: nombre.trim(),
          depositoId: depositoId === "__all__" ? null : depositoId,
          tipo,
          aplicarAjustes,
          notas: notas.trim() || null,
          filtros: {
            categoria: categoria.trim() || null,
            tipoDispositivo: tipoDispositivo.trim() || null,
            soloConStock,
          },
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Error al crear conteo")
      setDialogOpen(false)
      mutate()
      router.push(`/inventario/conteos/${json.conteoId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear conteo")
    } finally {
      setCreating(false)
    }
  }

  return (
    <PageShell
      title="Conteos físicos"
      description="Arqueo de stock con ajustes automáticos. El sistema saca foto del stock al iniciar y compara con lo que cargues."
      icon={ClipboardCheck}
      backHref="/inventario"
      actions={
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Nuevo conteo
        </Button>
      }
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : conteos.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Sin conteos todavía. Crea uno para empezar.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {conteos.map((c) => {
            const pct = c.totalItems > 0 ? Math.round((c.itemsContados / c.totalItems) * 100) : 0
            return (
              <Link key={c.id} href={`/inventario/conteos/${c.id}`}>
                <Card className="hover:bg-muted/40 transition-colors cursor-pointer">
                  <CardContent className="p-4 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold truncate">{c.nombre}</span>
                        {estadoBadge(c.estado)}
                        <Badge variant="secondary" className="text-[10px]">{c.tipo}</Badge>
                        {c.depositoNombre && (
                          <Badge variant="outline" className="text-[10px]">{c.depositoNombre}</Badge>
                        )}
                        {!c.aplicarAjustes && (
                          <Badge variant="outline" className="text-[10px] border-amber-500/60 text-amber-600">
                            Solo reporte
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(c.iniciadoAt).toLocaleString("es-AR", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span>
                          {c.itemsContados}/{c.totalItems} contados ({pct}%)
                        </span>
                        {c.itemsDiferencia > 0 && (
                          <span className="text-amber-600">
                            {c.itemsDiferencia} con diferencia
                          </span>
                        )}
                        {c.estado === "FINALIZADO" && c.itemsAjustados > 0 && (
                          <span className="text-emerald-600">
                            {c.itemsAjustados} ajustes aplicados
                          </span>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Nuevo conteo físico</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Nombre</Label>
              <Input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Conteo enero, Auditoría sucursal..."
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Tipo</Label>
                <Select value={tipo} onValueChange={(v) => setTipo(v as any)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="COMPLETO">Completo</SelectItem>
                    <SelectItem value="PARCIAL">Parcial</SelectItem>
                    <SelectItem value="CICLICO">Cíclico</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Depósito</Label>
                <Select value={depositoId} onValueChange={setDepositoId}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todos (global)</SelectItem>
                    {depositos.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.nombre}{d.principal ? " ★" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Categoría (opcional)</Label>
                <Input
                  value={categoria}
                  onChange={(e) => setCategoria(e.target.value)}
                  placeholder="Filtrar por categoría"
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Tipo dispositivo (opcional)</Label>
                <Input
                  value={tipoDispositivo}
                  onChange={(e) => setTipoDispositivo(e.target.value.toUpperCase())}
                  placeholder="CELULAR, TABLET..."
                  className="mt-1"
                />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <div className="text-sm font-medium">Solo items con stock</div>
                <div className="text-xs text-muted-foreground">
                  Excluye items con stock 0. Útil para arqueo rápido.
                </div>
              </div>
              <Switch checked={soloConStock} onCheckedChange={setSoloConStock} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <div className="text-sm font-medium">Aplicar ajustes al finalizar</div>
                <div className="text-xs text-muted-foreground">
                  Si lo desactivás, el conteo queda como reporte sin tocar el stock real.
                </div>
              </div>
              <Switch checked={aplicarAjustes} onCheckedChange={setAplicarAjustes} />
            </div>
            <div>
              <Label>Notas (opcional)</Label>
              <Input
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                placeholder="Motivo, contexto..."
                className="mt-1"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={creating}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Iniciar conteo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  )
}
