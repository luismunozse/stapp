"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Loader2,
  Package,
  Plus,
  Trash2,
  Search,
  Hammer,
  Wrench,
  AlertTriangle,
  Layers,
  ChevronRight,
} from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"

interface Componente {
  id: string // id del row inventario_kit_items
  kitId: string
  componenteId: string
  cantidad: number
  esObligatorio: boolean
  notas: string | null
  orden: number
  componente: {
    id: string
    codigo: string
    nombre: string
    stock: number
    stockReservado: number
    disponible: number
    /** null cuando el rol no puede ver costos de compra (hasInventarioAccess). */
    precioCompra: number | null
    imagenUrl: string | null
    esKit: boolean
    tipoKit: string | null
  } | null
  subtotalCosto: number | null
}

interface ExplosionadoRow {
  componenteId: string
  codigo: string
  nombre: string
  cantidadTotal: number
  precioCompra: number | null
  costoSubtotal: number | null
  esKit: boolean
  profundidad: number
}

interface KitData {
  kit: {
    id: string
    codigo: string
    nombre: string
    stock: number
    stockReservado: number
    precioCompra: number | null
    precioVenta: number
    esKit: boolean
    tipoKit: "ENSAMBLADO" | "VIRTUAL" | null
    imagenUrl: string | null
  }
  componentes: Componente[]
  costoCalculado: number | null
  explosionado: ExplosionadoRow[] | null
}

interface SearchResultItem {
  id: string
  codigo: string
  nombre: string
  stock: number
  precioCompra: number | null
  imagenUrl: string | null
}

interface DepositoOpt {
  id: string
  nombre: string
  principal: boolean
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  inventarioId: string
  inventarioNombre: string
  onSuccess?: () => void
}

type Tab = "receta" | "ensamblar" | "explosionado"

export function KitDialog({
  open,
  onOpenChange,
  inventarioId,
  inventarioNombre,
  onSuccess,
}: Props) {
  const { formatPrice } = useCurrency()
  const [tab, setTab] = useState<Tab>("receta")
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [data, setData] = useState<KitData | null>(null)
  const [error, setError] = useState("")

  // Búsqueda
  const [searchTerm, setSearchTerm] = useState("")
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([])
  const [searching, setSearching] = useState(false)
  const searchDebounce = useRef<number | null>(null)

  // Ensamblar / desensamblar
  const [depositos, setDepositos] = useState<DepositoOpt[]>([])
  const [depositoId, setDepositoId] = useState<string>("")
  const [cantidadEnsamblar, setCantidadEnsamblar] = useState<string>("1")
  const [motivo, setMotivo] = useState("")

  const cargar = useCallback(
    async (explosionar = false) => {
      setLoading(true)
      setError("")
      try {
        const url = `/api/inventario/${inventarioId}/kit${
          explosionar ? "?explosionar=true" : ""
        }`
        const res = await fetch(url)
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j.error || "Error al cargar kit")
        }
        const j: KitData = await res.json()
        setData(j)
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al cargar kit")
      } finally {
        setLoading(false)
      }
    },
    [inventarioId]
  )

  useEffect(() => {
    if (!open) return
    setTab("receta")
    setSearchTerm("")
    setSearchResults([])
    setCantidadEnsamblar("1")
    setMotivo("")
    setError("")
    cargar(false)
    // Cargar depósitos para el panel de ensamblar
    fetch("/api/depositos")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j) => {
        const rows = (j.data || j || []) as Array<{
          id: string
          nombre: string
          principal: boolean
          activo: boolean
        }>
        const activos = rows
          .filter((d) => d.activo !== false)
          .map((d) => ({
            id: d.id,
            nombre: d.nombre,
            principal: d.principal,
          }))
        setDepositos(activos)
        const principal = activos.find((d) => d.principal)
        if (principal) setDepositoId(principal.id)
      })
      .catch(() => setDepositos([]))
  }, [open, cargar])

  // Búsqueda con debounce
  useEffect(() => {
    if (searchDebounce.current) {
      window.clearTimeout(searchDebounce.current)
    }
    if (searchTerm.trim().length < 2) {
      setSearchResults([])
      return
    }
    searchDebounce.current = window.setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(
          `/api/inventario?search=${encodeURIComponent(searchTerm.trim())}&limit=10`
        )
        const j = await res.json()
        const rows = (j.data || []) as Array<{
          id: string
          codigo: string
          nombre: string
          stock: number
          precioCompra: number | null
          imagenUrl: string | null
        }>
        // Excluir el propio kit + los ya agregados
        const yaIds = new Set([
          inventarioId,
          ...(data?.componentes || []).map((c) => c.componenteId),
        ])
        setSearchResults(
          rows
            .filter((r) => !yaIds.has(r.id))
            .map((r) => ({
              id: r.id,
              codigo: r.codigo,
              nombre: r.nombre,
              stock: r.stock ?? 0,
              // No colapsar a 0: null significa "sin permiso", no "gratis".
              precioCompra: r.precioCompra == null ? null : Number(r.precioCompra),
              imagenUrl: r.imagenUrl ?? null,
            }))
        )
      } catch {
        setSearchResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => {
      if (searchDebounce.current) window.clearTimeout(searchDebounce.current)
    }
  }, [searchTerm, inventarioId, data])

  const agregarComponente = async (componenteId: string) => {
    setSubmitting(true)
    setError("")
    try {
      const res = await fetch(
        `/api/inventario/${inventarioId}/kit/componentes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ componenteId, cantidad: 1 }),
        }
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || "Error al agregar componente")
      }
      setSearchTerm("")
      setSearchResults([])
      await cargar(false)
      onSuccess?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al agregar componente")
    } finally {
      setSubmitting(false)
    }
  }

  const actualizarComponente = async (
    kitItemId: string,
    patch: { cantidad?: number; esObligatorio?: boolean }
  ) => {
    setError("")
    try {
      const res = await fetch(
        `/api/inventario/kit/componentes/${kitItemId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || "Error al actualizar")
      }
      await cargar(false)
      onSuccess?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al actualizar")
    }
  }

  const eliminarComponente = async (kitItemId: string) => {
    setError("")
    try {
      const res = await fetch(
        `/api/inventario/kit/componentes/${kitItemId}`,
        { method: "DELETE" }
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || "Error al eliminar")
      }
      await cargar(false)
      onSuccess?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al eliminar")
    }
  }

  const cambiarTipoKit = async (nuevo: "ENSAMBLADO" | "VIRTUAL") => {
    setError("")
    try {
      const res = await fetch(`/api/inventario/${inventarioId}/kit`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ esKit: true, tipoKit: nuevo }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || "Error al cambiar tipo")
      }
      await cargar(false)
      onSuccess?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cambiar tipo")
    }
  }

  const ensamblar = async (modo: "ENSAMBLAR" | "DESENSAMBLAR") => {
    const cant = Number(cantidadEnsamblar)
    if (!Number.isFinite(cant) || cant <= 0 || !Number.isInteger(cant)) {
      setError("Cantidad inválida")
      return
    }
    setSubmitting(true)
    setError("")
    try {
      const endpoint =
        modo === "ENSAMBLAR"
          ? `/api/inventario/${inventarioId}/kit/ensamblar`
          : `/api/inventario/${inventarioId}/kit/desensamblar`
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cantidad: cant,
          depositoId: depositoId || null,
          motivo: motivo.trim() || null,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `Error al ${modo.toLowerCase()}`)
      }
      setMotivo("")
      await cargar(false)
      onSuccess?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error en operación")
    } finally {
      setSubmitting(false)
    }
  }

  const tipoKit = data?.kit.tipoKit
  const esEnsamblado = tipoKit === "ENSAMBLADO"
  const cantEnsamblarNum = Number(cantidadEnsamblar)
  const validacionEnsamblar = useMemo(() => {
    if (!data || !esEnsamblado) return { puede: false, razon: "" }
    if (!Number.isFinite(cantEnsamblarNum) || cantEnsamblarNum <= 0)
      return { puede: false, razon: "Cantidad inválida" }
    if (data.componentes.length === 0)
      return { puede: false, razon: "Sin receta definida" }
    for (const c of data.componentes) {
      if (!c.componente) continue
      const req = c.cantidad * cantEnsamblarNum
      if (c.componente.disponible < req) {
        return {
          puede: false,
          razon: `Falta stock de "${c.componente.nombre}" (req. ${req}, disp. ${c.componente.disponible})`,
        }
      }
    }
    return { puede: true, razon: "" }
  }, [data, esEnsamblado, cantEnsamblarNum])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-1rem)] sm:max-w-4xl max-h-[90dvh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            Kit / Combo
          </DialogTitle>
          <p className="text-xs text-muted-foreground truncate">
            {inventarioNombre}
          </p>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !data ? (
          <div className="py-8 text-center text-sm text-destructive">
            {error || "Error al cargar el kit"}
          </div>
        ) : (
          <div className="flex flex-col gap-3 overflow-hidden">
            {/* Header con tipo + costo */}
            <div className="flex items-center justify-between gap-3 flex-wrap rounded-md border bg-muted/30 p-3">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Label className="text-xs whitespace-nowrap">Tipo</Label>
                  <Select
                    value={tipoKit ?? "ENSAMBLADO"}
                    onValueChange={(v) =>
                      cambiarTipoKit(v as "ENSAMBLADO" | "VIRTUAL")
                    }
                  >
                    <SelectTrigger className="h-8 w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ENSAMBLADO">
                        <div className="flex items-center gap-2">
                          <Hammer className="h-3.5 w-3.5" />
                          Ensamblado
                        </div>
                      </SelectItem>
                      <SelectItem value="VIRTUAL">
                        <div className="flex items-center gap-2">
                          <Layers className="h-3.5 w-3.5" />
                          Virtual
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Badge variant="secondary" className="text-xs">
                  Stock kit: {data.kit.stock}
                </Badge>
                {data.kit.stockReservado > 0 && (
                  <Badge variant="outline" className="text-xs">
                    Reservado: {data.kit.stockReservado}
                  </Badge>
                )}
              </div>
              {data.costoCalculado !== null && (
                <div className="text-right">
                  <div className="text-[10px] uppercase text-muted-foreground">
                    Costo total receta
                  </div>
                  <div className="text-lg font-bold">
                    {formatPrice(data.costoCalculado)}
                  </div>
                </div>
              )}
            </div>

            <p className="text-[11px] text-muted-foreground">
              {esEnsamblado
                ? "ENSAMBLADO: el kit tiene stock propio. Al ensamblar, descuenta componentes y aumenta el stock del kit."
                : "VIRTUAL: el kit no tiene stock propio. Al venderlo, se descuentan los componentes directamente (fase 2 — venta automática)."}
            </p>

            <Tabs value={tab} onValueChange={(v) => {
              setTab(v as Tab)
              if (v === "explosionado" && !data.explosionado) {
                cargar(true)
              }
            }}>
              <TabsList>
                <TabsTrigger value="receta">Receta</TabsTrigger>
                <TabsTrigger value="ensamblar" disabled={!esEnsamblado}>
                  Ensamblar
                </TabsTrigger>
                <TabsTrigger value="explosionado">Explosionado</TabsTrigger>
              </TabsList>

              {/* TAB: RECETA */}
              <TabsContent value="receta" className="space-y-3 overflow-y-auto max-h-[55vh] pr-1">
                {/* Buscador */}
                <div className="space-y-2">
                  <Label className="text-xs">Agregar componente</Label>
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Buscar item por nombre o código..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-8 h-9"
                    />
                  </div>
                  {searchTerm.trim().length >= 2 && (
                    <div className="border rounded-md max-h-48 overflow-y-auto bg-background">
                      {searching ? (
                        <div className="flex items-center justify-center py-3">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        </div>
                      ) : searchResults.length === 0 ? (
                        <div className="text-xs text-muted-foreground p-3 text-center">
                          Sin resultados disponibles
                        </div>
                      ) : (
                        searchResults.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            disabled={submitting}
                            onClick={() => agregarComponente(r.id)}
                            className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-muted/50 text-sm border-b last:border-b-0 disabled:opacity-50"
                          >
                            <Plus className="h-3.5 w-3.5 text-primary shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate">{r.nombre}</div>
                              <div className="text-[11px] text-muted-foreground">
                                {r.codigo} · Stock {r.stock}
                                {r.precioCompra !== null && ` · ${formatPrice(r.precioCompra)}`}
                              </div>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>

                {/* Lista componentes */}
                {data.componentes.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-6 border rounded-md">
                    Sin componentes. Agregá items desde el buscador.
                  </div>
                ) : (
                  <div className="border rounded-md divide-y">
                    {data.componentes.map((c) => {
                      if (!c.componente) return null
                      return (
                        <div
                          key={c.id}
                          className="flex items-center gap-2 p-2"
                        >
                          {c.componente.imagenUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={c.componente.imagenUrl}
                              alt=""
                              className="h-10 w-10 rounded object-cover border shrink-0"
                            />
                          ) : (
                            <div className="h-10 w-10 rounded border bg-muted flex items-center justify-center shrink-0">
                              <Package className="h-4 w-4 text-muted-foreground" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm truncate">
                                {c.componente.nombre}
                              </span>
                              {c.componente.esKit && (
                                <Badge variant="outline" className="text-[10px]">
                                  Sub-kit
                                </Badge>
                              )}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {c.componente.codigo} · Disp.{" "}
                              {c.componente.disponible}
                              {c.componente.precioCompra !== null &&
                                ` · Costo ${formatPrice(c.componente.precioCompra)}`}
                            </div>
                          </div>

                          <div className="w-20 shrink-0">
                            <Input
                              type="number"
                              min={1}
                              step={1}
                              defaultValue={c.cantidad}
                              key={`${c.id}-${c.cantidad}`}
                              onBlur={(e) => {
                                const v = parseInt(e.target.value)
                                if (Number.isFinite(v) && v > 0 && v !== c.cantidad) {
                                  actualizarComponente(c.id, { cantidad: v })
                                }
                              }}
                              className="h-8 text-center text-sm"
                            />
                          </div>

                          {c.subtotalCosto !== null && (
                            <div className="w-24 text-right text-xs shrink-0">
                              {formatPrice(c.subtotalCosto)}
                            </div>
                          )}

                          <div className="flex items-center gap-1 shrink-0">
                            <Switch
                              checked={c.esObligatorio}
                              onCheckedChange={(v) =>
                                actualizarComponente(c.id, { esObligatorio: v })
                              }
                              aria-label="Obligatorio"
                            />
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() => eliminarComponente(c.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </TabsContent>

              {/* TAB: ENSAMBLAR */}
              <TabsContent value="ensamblar" className="space-y-3 overflow-y-auto max-h-[55vh] pr-1">
                {!esEnsamblado ? (
                  <div className="text-sm text-muted-foreground text-center py-6">
                    Sólo kits ENSAMBLADO pueden ensamblarse.
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Cantidad</Label>
                        <Input
                          type="number"
                          min={1}
                          step={1}
                          value={cantidadEnsamblar}
                          onChange={(e) => setCantidadEnsamblar(e.target.value)}
                          className="mt-1 h-9"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Depósito (opcional)</Label>
                        <Select
                          value={depositoId}
                          onValueChange={setDepositoId}
                        >
                          <SelectTrigger className="mt-1 h-9">
                            <SelectValue placeholder="Total" />
                          </SelectTrigger>
                          <SelectContent>
                            {depositos.map((d) => (
                              <SelectItem key={d.id} value={d.id}>
                                {d.nombre}
                                {d.principal && " (principal)"}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs">Motivo (opcional)</Label>
                      <Input
                        value={motivo}
                        onChange={(e) => setMotivo(e.target.value)}
                        placeholder="Producción, reposición, etc."
                        className="mt-1 h-9"
                        maxLength={500}
                      />
                    </div>

                    {/* Preview de consumo */}
                    {cantEnsamblarNum > 0 && data.componentes.length > 0 && (
                      <div className="border rounded-md">
                        <div className="text-[11px] font-medium uppercase text-muted-foreground px-2 py-1 border-b bg-muted/30">
                          Preview: se consumirá
                        </div>
                        <div className="divide-y text-xs">
                          {data.componentes.map((c) => {
                            if (!c.componente) return null
                            const req = c.cantidad * cantEnsamblarNum
                            const insuf = c.componente.disponible < req
                            return (
                              <div
                                key={c.id}
                                className="flex items-center justify-between px-2 py-1.5"
                              >
                                <span className="truncate">
                                  {c.componente.nombre}
                                </span>
                                <span
                                  className={
                                    insuf
                                      ? "text-destructive font-medium"
                                      : "text-muted-foreground"
                                  }
                                >
                                  {req} / {c.componente.disponible} disp.
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {!validacionEnsamblar.puede && validacionEnsamblar.razon && (
                      <div className="flex items-start gap-2 text-xs rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-200 text-amber-900 p-2">
                        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span>{validacionEnsamblar.razon}</span>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Button
                        onClick={() => ensamblar("ENSAMBLAR")}
                        disabled={submitting || !validacionEnsamblar.puede}
                        className="flex-1"
                      >
                        {submitting ? (
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                          <Hammer className="h-4 w-4 mr-1" />
                        )}
                        Ensamblar {cantEnsamblarNum > 0 ? cantEnsamblarNum : ""} kits
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => ensamblar("DESENSAMBLAR")}
                        disabled={
                          submitting ||
                          cantEnsamblarNum <= 0 ||
                          data.kit.stock < cantEnsamblarNum
                        }
                        className="flex-1"
                      >
                        <Wrench className="h-4 w-4 mr-1" />
                        Desensamblar
                      </Button>
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* TAB: EXPLOSIONADO */}
              <TabsContent value="explosionado" className="space-y-3 overflow-y-auto max-h-[55vh] pr-1">
                {data.explosionado === null ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                ) : data.explosionado.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-6">
                    Sin componentes explosionados.
                  </div>
                ) : (
                  <div className="border rounded-md divide-y text-sm">
                    {data.explosionado.map((r) => (
                      <div
                        key={r.componenteId}
                        className="flex items-center gap-2 px-2 py-1.5"
                      >
                        <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium truncate">{r.nombre}</span>
                            {r.esKit && (
                              <Badge variant="outline" className="text-[10px]">
                                Sub-kit
                              </Badge>
                            )}
                            <Badge variant="secondary" className="text-[10px]">
                              {r.codigo}
                            </Badge>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-xs font-medium">
                            x {r.cantidadTotal}
                          </div>
                          {r.costoSubtotal !== null && (
                            <div className="text-[10px] text-muted-foreground">
                              {formatPrice(r.costoSubtotal)}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>

            {error && (
              <p className="text-sm text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" />
                {error}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
