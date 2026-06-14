"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { toast } from "sonner"
import { Loader2, Calculator, Check, X, Package } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useCurrency } from "@/contexts/currency-context"
import { PageShell } from "@/components/ui/page-shell"
import { EmptyState } from "@/components/ui/empty-state"

interface Proveedor {
  id: string
  nombre: string
}

interface InventarioItem {
  id: string
  codigo: string
  nombre: string
  stock: number
  precioCompra: number | null
  precioVenta: number | null
}

type RoundMode = "none" | "0" | "10" | "100"

const fetcher = (url: string) => fetch(url).then(r => r.json())

function round(value: number, mode: RoundMode): number {
  if (mode === "none") return Math.round(value * 100) / 100
  if (mode === "0") return Math.round(value)
  const step = Number(mode)
  return Math.round(value / step) * step
}

function applyPct(base: number | null, pct: number, mode: RoundMode): number | null {
  if (base == null || isNaN(base)) return null
  const v = base * (1 + pct / 100)
  return round(v, mode)
}

function deltaPct(a: number | null, b: number | null): string {
  if (a == null || b == null || a === 0) return ""
  const p = ((b - a) / a) * 100
  const s = p > 0 ? "+" : ""
  return `${s}${p.toFixed(1)}%`
}

export function AjustePreciosProveedor({ proveedorId }: { proveedorId: string }) {
  const router = useRouter()
  const { formatPrice } = useCurrency()

  const { data: proveedor } = useSWR<Proveedor>(
    `/api/proveedores/${proveedorId}`,
    fetcher,
    { revalidateOnFocus: false }
  )

  const { data: invResp, isLoading } = useSWR<{ data: InventarioItem[] } | InventarioItem[]>(
    `/api/inventario?proveedorId=${proveedorId}&limit=1000`,
    fetcher,
    { revalidateOnFocus: false }
  )
  const items: InventarioItem[] = Array.isArray(invResp) ? invResp : invResp?.data || []

  const [pctCompra, setPctCompra] = useState<string>("")
  const [pctVenta, setPctVenta] = useState<string>("")
  const [roundMode, setRoundMode] = useState<RoundMode>("none")
  const [updateVentaFromCompra, setUpdateVentaFromCompra] = useState(false)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [overrides, setOverrides] = useState<Record<string, { compra?: string; venta?: string }>>({})
  const [motivo, setMotivo] = useState("")
  const [search, setSearch] = useState("")
  const [applying, setApplying] = useState(false)

  // Reset overrides if items list changes drastically.
  useEffect(() => { setOverrides({}); setExcluded(new Set()) }, [proveedorId])

  const pcCompra = parseFloat(pctCompra) || 0
  const pcVenta = parseFloat(pctVenta) || 0

  const computed = useMemo(() => {
    return items.map((it) => {
      const ov = overrides[it.id] || {}
      const ovCompra = ov.compra !== undefined && ov.compra !== "" ? parseFloat(ov.compra) : null
      const ovVenta = ov.venta !== undefined && ov.venta !== "" ? parseFloat(ov.venta) : null

      const baseCompraNuevo = pctCompra !== "" ? applyPct(it.precioCompra, pcCompra, roundMode) : null
      const compraNuevo = ovCompra !== null && !isNaN(ovCompra) ? round(ovCompra, roundMode) : baseCompraNuevo

      let ventaNuevo: number | null = null
      if (ovVenta !== null && !isNaN(ovVenta)) {
        ventaNuevo = round(ovVenta, roundMode)
      } else if (pctVenta !== "") {
        const base = updateVentaFromCompra && compraNuevo != null && it.precioCompra && it.precioVenta && it.precioCompra > 0
          ? (compraNuevo / it.precioCompra) * it.precioVenta
          : it.precioVenta
        ventaNuevo = applyPct(base, pcVenta, roundMode)
      } else if (updateVentaFromCompra && compraNuevo != null && it.precioCompra && it.precioVenta && it.precioCompra > 0) {
        ventaNuevo = round((compraNuevo / it.precioCompra) * it.precioVenta, roundMode)
      }

      const cambiaCompra = compraNuevo != null && compraNuevo !== it.precioCompra
      const cambiaVenta = ventaNuevo != null && ventaNuevo !== it.precioVenta
      const cambia = cambiaCompra || cambiaVenta

      return {
        item: it,
        compraNuevo: cambiaCompra ? compraNuevo : null,
        ventaNuevo: cambiaVenta ? ventaNuevo : null,
        cambia,
      }
    })
  }, [items, pctCompra, pctVenta, pcCompra, pcVenta, roundMode, updateVentaFromCompra, overrides])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return computed
    return computed.filter((r) =>
      `${r.item.codigo} ${r.item.nombre}`.toLowerCase().includes(q)
    )
  }, [computed, search])

  const cambiosCount = computed.filter((r) => r.cambia && !excluded.has(r.item.id)).length

  const toggleExclude = (id: string) => {
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const setOverride = (id: string, key: "compra" | "venta", val: string) => {
    setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], [key]: val } }))
  }

  const applyAll = async () => {
    const updates = computed
      .filter((r) => r.cambia && !excluded.has(r.item.id))
      .map((r) => ({
        id: r.item.id,
        precioCompraNuevo: r.compraNuevo,
        precioVentaNuevo: r.ventaNuevo,
      }))
    if (updates.length === 0) {
      toast.error("No hay cambios para aplicar")
      return
    }
    setApplying(true)
    try {
      const res = await fetch("/api/inventario/precios/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates,
          motivo: motivo.trim() || `Ajuste masivo proveedor ${proveedor?.nombre || ""}`.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || "Error al aplicar")
        return
      }
      toast.success(`${data.updated} precio${data.updated === 1 ? "" : "s"} actualizado${data.updated === 1 ? "" : "s"}`)
      router.push(`/proveedores/${proveedorId}`)
    } catch (e) {
      console.error(e)
      toast.error("Error al aplicar cambios")
    } finally {
      setApplying(false)
    }
  }

  return (
    <PageShell
      title="Ajuste masivo de precios"
      description={proveedor?.nombre ?? "..."}
      icon={Calculator}
      backHref={`/proveedores/${proveedorId}`}
    >
      {/* Controles */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Parámetros</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label htmlFor="pct-compra">% ajuste costo</Label>
              <Input
                id="pct-compra"
                type="number"
                step="0.1"
                placeholder="Ej: 10 (sube 10%)"
                value={pctCompra}
                onChange={(e) => setPctCompra(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="pct-venta">% ajuste venta</Label>
              <Input
                id="pct-venta"
                type="number"
                step="0.1"
                placeholder="Ej: 10"
                value={pctVenta}
                onChange={(e) => setPctVenta(e.target.value)}
                disabled={updateVentaFromCompra && pctVenta === ""}
              />
            </div>
            <div>
              <Label>Redondeo</Label>
              <Select value={roundMode} onValueChange={(v) => setRoundMode(v as RoundMode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin redondeo (2 decimales)</SelectItem>
                  <SelectItem value="0">Entero</SelectItem>
                  <SelectItem value="10">Múltiplos de 10</SelectItem>
                  <SelectItem value="100">Múltiplos de 100</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Switch
              id="venta-margen"
              checked={updateVentaFromCompra}
              onCheckedChange={setUpdateVentaFromCompra}
            />
            <Label htmlFor="venta-margen" className="cursor-pointer text-sm">
              Mantener margen: si sube el costo, recalcula venta proporcional
            </Label>
          </div>

          <div>
            <Label htmlFor="motivo">Motivo (opcional)</Label>
            <Input
              id="motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder={`Ej: Lista ${proveedor?.nombre || "proveedor"} — ${new Date().toLocaleDateString("es-AR", { month: "long", year: "numeric" })}`}
              maxLength={200}
            />
          </div>
        </CardContent>
      </Card>

      {/* Tabla */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">
              Items {items.length > 0 && `(${items.length})`}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {cambiosCount} cambio{cambiosCount === 1 ? "" : "s"} a aplicar
            </p>
          </div>
          <Input
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={Package}
              title="Sin productos"
              description="Este proveedor no tiene productos asociados en el inventario."
            />
          ) : (
            <div className="overflow-auto max-h-[60vh]">
              <table className="w-full text-xs sm:text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="px-2 py-2 w-8"></th>
                    <th className="px-2 py-2 text-left">Código</th>
                    <th className="px-2 py-2 text-left">Producto</th>
                    <th className="px-2 py-2 text-right">Costo actual</th>
                    <th className="px-2 py-2 text-right">Costo nuevo</th>
                    <th className="px-2 py-2 text-right">Venta actual</th>
                    <th className="px-2 py-2 text-right">Venta nueva</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(({ item, compraNuevo, ventaNuevo, cambia }) => {
                    const isExcluded = excluded.has(item.id)
                    const ov = overrides[item.id] || {}
                    return (
                      <tr
                        key={item.id}
                        className={`border-t ${isExcluded ? "opacity-40" : ""} ${cambia ? "bg-primary/5" : ""}`}
                      >
                        <td className="px-2 py-1.5 text-center">
                          {cambia ? (
                            <input
                              type="checkbox"
                              checked={!isExcluded}
                              onChange={() => toggleExclude(item.id)}
                              title="Incluir en el ajuste"
                            />
                          ) : null}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-[11px] whitespace-nowrap">{item.codigo}</td>
                        <td className="px-2 py-1.5 max-w-[280px] truncate" title={item.nombre}>{item.nombre}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                          {item.precioCompra != null ? formatPrice(item.precioCompra) : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            <Input
                              type="number"
                              step="0.01"
                              className="h-7 w-24 text-right text-xs tabular-nums"
                              placeholder={compraNuevo != null ? String(compraNuevo) : ""}
                              value={ov.compra ?? ""}
                              onChange={(e) => setOverride(item.id, "compra", e.target.value)}
                            />
                            <span className="text-[10px] text-muted-foreground w-12 text-right">
                              {compraNuevo != null ? deltaPct(item.precioCompra, compraNuevo) : ""}
                            </span>
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                          {item.precioVenta != null ? formatPrice(item.precioVenta) : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            <Input
                              type="number"
                              step="0.01"
                              className="h-7 w-24 text-right text-xs tabular-nums"
                              placeholder={ventaNuevo != null ? String(ventaNuevo) : ""}
                              value={ov.venta ?? ""}
                              onChange={(e) => setOverride(item.id, "venta", e.target.value)}
                            />
                            <span className="text-[10px] text-muted-foreground w-12 text-right">
                              {ventaNuevo != null ? deltaPct(item.precioVenta, ventaNuevo) : ""}
                            </span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="sticky bottom-0 bg-background border-t -mx-4 sm:mx-0 sm:rounded-md px-4 py-3 flex flex-col sm:flex-row gap-2 sm:items-center justify-between">
        <div className="text-sm">
          <span className="font-semibold">{cambiosCount}</span>{" "}
          <span className="text-muted-foreground">cambio{cambiosCount === 1 ? "" : "s"} listo{cambiosCount === 1 ? "" : "s"} para aplicar</span>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" asChild>
            <Link href={`/proveedores/${proveedorId}`}>
              <X className="h-4 w-4 mr-1" />Cancelar
            </Link>
          </Button>
          <Button onClick={applyAll} disabled={applying || cambiosCount === 0}>
            {applying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
            Aplicar {cambiosCount} cambio{cambiosCount === 1 ? "" : "s"}
          </Button>
        </div>
      </div>
    </PageShell>
  )
}
