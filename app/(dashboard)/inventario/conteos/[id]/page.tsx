"use client"

import { useState, useEffect, useCallback, useMemo, useRef, use } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  ArrowLeft,
  Loader2,
  Search,
  ScanLine,
  CheckCircle2,
  XCircle,
  PlayCircle,
  AlertTriangle,
  Save,
} from "lucide-react"
import { BarcodeScanner } from "@/components/inventario/barcode-scanner"
import { useCurrency } from "@/contexts/currency-context"

interface Conteo {
  id: string
  nombre: string
  estado: "EN_PROGRESO" | "FINALIZADO" | "CANCELADO"
  depositoId: string | null
  depositoNombre: string | null
  tipo: string
  aplicarAjustes: boolean
  totalItems: number
  itemsContados: number
  itemsDiferencia: number
  itemsAjustados: number
  iniciadoAt: string
  finalizadoAt: string | null
  notas: string | null
}

interface ConteoItem {
  id: string
  stockSistema: number
  stockContado: number | null
  diferencia: number
  observaciones: string | null
  contadoAt: string | null
  inventario: {
    id: string
    codigo: string
    nombre: string
    categoria: string
    barcode: string | null
    imagenUrl: string | null
    ubicacion: string | null
  } | null
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function ConteoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { timezone } = useCurrency()
  const router = useRouter()

  const { data: conteo, mutate: refetchConteo, isLoading: loadingConteo } = useSWR<Conteo>(
    `/api/conteos/${id}`,
    fetcher
  )

  const [filter, setFilter] = useState<"todos" | "pendientes" | "diferencia">("todos")
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [showScanner, setShowScanner] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [finalizeOpen, setFinalizeOpen] = useState(false)
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const [localValues, setLocalValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])

  const itemsKey = useMemo(() => {
    const params = new URLSearchParams()
    if (filter === "pendientes") params.set("soloPendientes", "true")
    if (filter === "diferencia") params.set("soloDiferencia", "true")
    if (debouncedSearch) params.set("search", debouncedSearch)
    return `/api/conteos/${id}/items?${params}`
  }, [id, filter, debouncedSearch])

  const { data: itemsRes, mutate: refetchItems, isLoading: loadingItems } = useSWR<{ data: ConteoItem[] }>(
    itemsKey,
    fetcher
  )
  const items = itemsRes?.data || []

  const saveItem = useCallback(
    async (item: ConteoItem, rawValue: string) => {
      const value = rawValue.trim()
      const parsed = value === "" ? null : Number(value)
      if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed))) {
        return
      }
      setSaving((s) => ({ ...s, [item.id]: true }))
      try {
        const res = await fetch(`/api/conteos/${id}/items/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stockContado: parsed }),
        })
        if (res.ok) {
          await Promise.all([refetchItems(), refetchConteo()])
        }
      } finally {
        setSaving((s) => ({ ...s, [item.id]: false }))
      }
    },
    [id, refetchItems, refetchConteo]
  )

  const handleScanResult = useCallback(
    async (result: { found: boolean; code: string; item?: any }) => {
      if (!result.found || !result.item) {
        return
      }
      const matchedInvId = result.item.id
      const conteoItem = items.find((it) => it.inventario?.id === matchedInvId)
      if (!conteoItem) {
        alert("Item no está en este conteo (revisá filtros del scope)")
        return
      }
      // Auto-incrementa cantidad. Si nunca se contó, arranca en 1.
      const current = conteoItem.stockContado ?? 0
      await saveItem(conteoItem, String(current + 1))
      // Focus input correspondiente para edición manual posterior
      setTimeout(() => inputRefs.current[conteoItem.id]?.focus(), 100)
    },
    [items, saveItem]
  )

  const handleCancel = async () => {
    setFinalizing(true)
    try {
      const res = await fetch(`/api/conteos/${id}`, { method: "DELETE" })
      if (res.ok) {
        router.push("/inventario/conteos")
      } else {
        const j = await res.json().catch(() => ({}))
        alert(j.error || "Error al cancelar")
      }
    } finally {
      setFinalizing(false)
      setCancelOpen(false)
    }
  }

  const handleFinalize = async (forzar: boolean) => {
    setFinalizing(true)
    try {
      const res = await fetch(`/api/conteos/${id}/finalizar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forzar }),
      })
      const json = await res.json()
      if (!res.ok) {
        alert(json.error || "Error al finalizar")
        return
      }
      await Promise.all([refetchConteo(), refetchItems()])
      setFinalizeOpen(false)
    } finally {
      setFinalizing(false)
    }
  }

  if (loadingConteo) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!conteo) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Conteo no encontrado.{" "}
          <Link href="/inventario/conteos" className="underline">Volver</Link>
        </CardContent>
      </Card>
    )
  }

  const pct = conteo.totalItems > 0 ? Math.round((conteo.itemsContados / conteo.totalItems) * 100) : 0
  const readonly = conteo.estado !== "EN_PROGRESO"
  const pendientes = conteo.totalItems - conteo.itemsContados

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/inventario/conteos">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold truncate">{conteo.nombre}</h1>
            {conteo.estado === "EN_PROGRESO" && (
              <Badge variant="outline" className="gap-1 border-blue-500/60 text-blue-600">
                <PlayCircle className="h-3 w-3" /> En progreso
              </Badge>
            )}
            {conteo.estado === "FINALIZADO" && (
              <Badge variant="outline" className="gap-1 border-emerald-500/60 text-emerald-600">
                <CheckCircle2 className="h-3 w-3" /> Finalizado
              </Badge>
            )}
            {conteo.estado === "CANCELADO" && (
              <Badge variant="outline" className="gap-1 border-muted-foreground/40 text-muted-foreground">
                <XCircle className="h-3 w-3" /> Cancelado
              </Badge>
            )}
            {conteo.depositoNombre && (
              <Badge variant="secondary" className="text-[10px]">{conteo.depositoNombre}</Badge>
            )}
            {!conteo.aplicarAjustes && (
              <Badge variant="outline" className="text-[10px] border-amber-500/60 text-amber-600">
                Solo reporte
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Iniciado {new Date(conteo.iniciadoAt).toLocaleString("es-AR", { timeZone: timezone })}
            {conteo.finalizadoAt && ` · Finalizado ${new Date(conteo.finalizadoAt).toLocaleString("es-AR", { timeZone: timezone })}`}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground">Items</div>
            <div className="text-xl font-bold">{conteo.totalItems}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground">Contados</div>
            <div className="text-xl font-bold">{conteo.itemsContados} <span className="text-xs text-muted-foreground">({pct}%)</span></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground">Con diferencia</div>
            <div className="text-xl font-bold text-amber-600">{conteo.itemsDiferencia}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground">
              {conteo.estado === "FINALIZADO" ? "Ajustes aplicados" : "Pendientes"}
            </div>
            <div className="text-xl font-bold">
              {conteo.estado === "FINALIZADO" ? conteo.itemsAjustados : pendientes}
            </div>
          </CardContent>
        </Card>
      </div>

      {!readonly && (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre, código o barcode..."
              className="pl-8"
            />
          </div>
          <Select value={filter} onValueChange={(v) => setFilter(v as any)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="pendientes">Sin contar</SelectItem>
              <SelectItem value="diferencia">Con diferencia</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => setShowScanner(true)}>
            <ScanLine className="h-4 w-4 mr-1" /> Escanear
          </Button>
          <Button variant="outline" onClick={() => setCancelOpen(true)} className="text-destructive hover:text-destructive">
            Cancelar conteo
          </Button>
          <Button onClick={() => setFinalizeOpen(true)}>
            <Save className="h-4 w-4 mr-1" /> Finalizar
          </Button>
        </div>
      )}

      {loadingItems ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Sin items que coincidan con el filtro.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {items.map((it) => {
                const inv = it.inventario
                if (!inv) return null
                const localValue = localValues[it.id] ?? (it.stockContado?.toString() ?? "")
                const hasDiff = it.stockContado !== null && it.diferencia !== 0
                const pending = it.stockContado === null
                return (
                  <div
                    key={it.id}
                    className={`flex items-center gap-3 p-3 ${pending ? "" : hasDiff ? "bg-amber-50/40 dark:bg-amber-950/10" : "bg-emerald-50/30 dark:bg-emerald-950/10"}`}
                  >
                    <div className="w-10 h-10 rounded bg-muted/40 flex items-center justify-center overflow-hidden shrink-0">
                      {inv.imagenUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={inv.imagenUrl} alt={inv.nombre} className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-[9px] text-muted-foreground">{inv.codigo.slice(0, 3)}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{inv.nombre}</div>
                      <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                        <span>{inv.codigo}</span>
                        {inv.barcode && <span className="font-mono">{inv.barcode}</span>}
                        {inv.ubicacion && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">{inv.ubicacion}</Badge>
                        )}
                      </div>
                    </div>
                    <div className="text-right text-xs text-muted-foreground shrink-0">
                      <div className="text-[10px] uppercase">Sistema</div>
                      <div className="text-sm font-semibold text-foreground">{it.stockSistema}</div>
                    </div>
                    <div className="w-24 shrink-0">
                      <Input
                        ref={(el) => { inputRefs.current[it.id] = el }}
                        type="number"
                        min={0}
                        step={1}
                        value={localValue}
                        disabled={readonly}
                        onChange={(e) =>
                          setLocalValues((v) => ({ ...v, [it.id]: e.target.value }))
                        }
                        onBlur={(e) => {
                          const v = e.target.value
                          if (v !== (it.stockContado?.toString() ?? "")) {
                            saveItem(it, v)
                          }
                          setLocalValues((s) => {
                            const next = { ...s }
                            delete next[it.id]
                            return next
                          })
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur()
                        }}
                        placeholder="-"
                        className="h-8 text-center text-sm"
                      />
                    </div>
                    <div className="w-14 text-right shrink-0">
                      {pending ? (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      ) : (
                        <span className={`text-sm font-bold ${it.diferencia > 0 ? "text-emerald-600" : it.diferencia < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                          {it.diferencia > 0 ? "+" : ""}{it.diferencia}
                        </span>
                      )}
                    </div>
                    <div className="w-5 shrink-0">
                      {saving[it.id] && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {!readonly && (
        <BarcodeScanner open={showScanner} onOpenChange={setShowScanner} onResult={handleScanResult} />
      )}

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={(o) => !o && setCancelOpen(false)}
        title="Cancelar conteo"
        description="El conteo se marcará como CANCELADO. No se aplicarán ajustes. Acción irreversible."
        confirmText="Cancelar conteo"
        cancelText="Volver"
        variant="danger"
        loading={finalizing}
        onConfirm={handleCancel}
      />

      <ConfirmDialog
        open={finalizeOpen}
        onOpenChange={(o) => !o && setFinalizeOpen(false)}
        title={pendientes > 0 ? "Finalizar con items sin contar" : "Finalizar conteo"}
        description={
          pendientes > 0
            ? `Faltan ${pendientes} items sin contar. Si finalizás ahora, esos items se omiten del ajuste.`
            : conteo.aplicarAjustes
              ? `Se aplicarán ajustes en ${conteo.itemsDiferencia} items con diferencia. Cada uno genera un movimiento AJUSTE auditable.`
              : "El conteo se marcará como FINALIZADO sin tocar el stock (modo solo reporte)."
        }
        confirmText={pendientes > 0 ? "Finalizar igual" : "Finalizar"}
        cancelText="Seguir contando"
        variant={pendientes > 0 ? "warning" : "info"}
        loading={finalizing}
        onConfirm={() => handleFinalize(pendientes > 0)}
      />

      {pendientes > 0 && conteo.estado === "EN_PROGRESO" && (
        <div className="flex items-start gap-2 text-xs rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-200 text-amber-900 p-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <div>
            Si entre el inicio del conteo y la finalización hubo ventas/ajustes, el sistema usa el stock actual (no el snapshot) como base del ajuste. El stock final será el valor contado.
          </div>
        </div>
      )}
    </div>
  )
}
