"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Loader2,
  Package,
  Plus,
  Hammer,
  Layers,
  Search,
  Settings,
} from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { useCurrency } from "@/contexts/currency-context"
import { KitDialog } from "@/components/inventario/kit-dialog"

interface KitRow {
  id: string
  codigo: string
  nombre: string
  stock: number
  stockReservado: number
  precioCompra: number
  precioVenta: number
  tipoKit: "ENSAMBLADO" | "VIRTUAL" | null
  imagenUrl: string | null
  categoria: string
  tipoDispositivo: string
  cantidadComponentes: number
  costoCalculado: number
}

interface KitsResp {
  data: KitRow[]
  total: number
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function KitsPage() {
  const { formatPrice } = useCurrency()
  const [search, setSearch] = useState("")
  const [tipoKit, setTipoKit] = useState<string>("todos")
  const [debouncedSearch, setDebouncedSearch] = useState("")

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => window.clearTimeout(t)
  }, [search])

  const qs = new URLSearchParams()
  if (debouncedSearch) qs.set("search", debouncedSearch)
  if (tipoKit !== "todos") qs.set("tipoKit", tipoKit)
  const url = `/api/inventario/kits${qs.toString() ? `?${qs.toString()}` : ""}`

  const { data, isLoading, mutate } = useSWR<KitsResp>(url, fetcher)

  const [openKitId, setOpenKitId] = useState<string | null>(null)
  const [openKitNombre, setOpenKitNombre] = useState<string>("")
  const [nuevoOpen, setNuevoOpen] = useState(false)

  const handleAbrirKit = useCallback((row: KitRow) => {
    setOpenKitId(row.id)
    setOpenKitNombre(row.nombre)
  }, [])

  return (
    <PageShell
      title="Kits / Combos"
      description="Items compuestos por otros items. Ensamblá para producir kit ENSAMBLADO o usá VIRTUAL para vender componentes en grupo."
      icon={Package}
      backHref="/inventario"
      actions={
        <Button onClick={() => setNuevoOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Nuevo kit
        </Button>
      }
      className="space-y-4"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre o código..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <Select value={tipoKit} onValueChange={setTipoKit}>
          <SelectTrigger className="w-40 h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los tipos</SelectItem>
            <SelectItem value="ENSAMBLADO">Ensamblado</SelectItem>
            <SelectItem value="VIRTUAL">Virtual</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !data || data.data.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground space-y-2">
            <Package className="h-8 w-8 mx-auto text-muted-foreground/50" />
            <div>No hay kits definidos.</div>
            <div className="text-xs">
              Creá uno nuevo o convertí un item existente en kit desde su detalle.
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.data.map((k) => (
            <Card key={k.id} className="hover:border-primary/50 transition-colors">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-start gap-2">
                  {k.imagenUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={k.imagenUrl}
                      alt=""
                      className="h-12 w-12 rounded object-cover border shrink-0"
                    />
                  ) : (
                    <div className="h-12 w-12 rounded border bg-muted flex items-center justify-center shrink-0">
                      <Package className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{k.nombre}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {k.codigo}
                    </div>
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                      {k.tipoKit === "ENSAMBLADO" ? (
                        <Badge variant="outline" className="text-[10px] gap-1">
                          <Hammer className="h-3 w-3" /> Ensamblado
                        </Badge>
                      ) : k.tipoKit === "VIRTUAL" ? (
                        <Badge variant="outline" className="text-[10px] gap-1">
                          <Layers className="h-3 w-3" /> Virtual
                        </Badge>
                      ) : null}
                      <Badge variant="secondary" className="text-[10px]">
                        Stock {k.stock}
                      </Badge>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground">
                      Componentes
                    </div>
                    <div className="font-semibold">{k.cantidadComponentes}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground">
                      Costo receta
                    </div>
                    <div className="font-semibold">
                      {formatPrice(k.costoCalculado)}
                    </div>
                  </div>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => handleAbrirKit(k)}
                >
                  <Settings className="h-3.5 w-3.5 mr-1" /> Gestionar
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {openKitId && (
        <KitDialog
          open={!!openKitId}
          onOpenChange={(o) => {
            if (!o) setOpenKitId(null)
          }}
          inventarioId={openKitId}
          inventarioNombre={openKitNombre}
          onSuccess={() => mutate()}
        />
      )}

      <NuevoKitDialog
        open={nuevoOpen}
        onOpenChange={setNuevoOpen}
        onCreated={(id, nombre) => {
          mutate()
          setNuevoOpen(false)
          setOpenKitId(id)
          setOpenKitNombre(nombre)
        }}
      />
    </PageShell>
  )
}

// Modal mínimo para crear un nuevo item-kit en una operación.
function NuevoKitDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated: (id: string, nombre: string) => void
}) {
  const [codigo, setCodigo] = useState("")
  const [nombre, setNombre] = useState("")
  const [tipoKit, setTipoKit] = useState<"ENSAMBLADO" | "VIRTUAL">("ENSAMBLADO")
  const [precioVenta, setPrecioVenta] = useState("0")
  const [categoria, setCategoria] = useState("Kit")
  const [tipoDispositivo, setTipoDispositivo] = useState("Kit")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open) {
      setCodigo("")
      setNombre("")
      setTipoKit("ENSAMBLADO")
      setPrecioVenta("0")
      setError("")
    }
  }, [open])

  const handleCreate = async () => {
    if (!codigo.trim() || !nombre.trim()) {
      setError("Código y nombre son requeridos")
      return
    }
    setSubmitting(true)
    setError("")
    try {
      // 1. Crear inventario
      const createRes = await fetch("/api/inventario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          codigo: codigo.trim(),
          nombre: nombre.trim(),
          categoria: categoria || "Kit",
          tipoDispositivo: tipoDispositivo || "Kit",
          stock: 0,
          precioCompra: 0,
          precioVenta: Number(precioVenta) || 0,
        }),
      })
      if (!createRes.ok) {
        const j = await createRes.json().catch(() => ({}))
        throw new Error(j.error || "Error al crear item")
      }
      const item = await createRes.json()
      const newId = item.id

      // 2. Marcar como kit
      const flagRes = await fetch(`/api/inventario/${newId}/kit`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ esKit: true, tipoKit }),
      })
      if (!flagRes.ok) {
        const j = await flagRes.json().catch(() => ({}))
        throw new Error(j.error || "Error al marcar como kit")
      }
      onCreated(newId, item.nombre || nombre.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al crear kit")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4" /> Nuevo kit
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Código *</Label>
              <Input
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                className="mt-1 h-9"
                placeholder="KIT-001"
                maxLength={50}
              />
            </div>
            <div>
              <Label className="text-xs">Tipo</Label>
              <Select
                value={tipoKit}
                onValueChange={(v) =>
                  setTipoKit(v as "ENSAMBLADO" | "VIRTUAL")
                }
              >
                <SelectTrigger className="mt-1 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ENSAMBLADO">Ensamblado</SelectItem>
                  <SelectItem value="VIRTUAL">Virtual</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Nombre *</Label>
            <Input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className="mt-1 h-9"
              placeholder="Combo Promo X"
              maxLength={200}
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Precio venta</Label>
              <Input
                type="number"
                min={0}
                step={0.01}
                value={precioVenta}
                onChange={(e) => setPrecioVenta(e.target.value)}
                className="mt-1 h-9"
              />
            </div>
            <div>
              <Label className="text-xs">Categoría</Label>
              <Input
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                className="mt-1 h-9"
                maxLength={100}
              />
            </div>
            <div>
              <Label className="text-xs">Tipo disp.</Label>
              <Input
                value={tipoDispositivo}
                onChange={(e) => setTipoDispositivo(e.target.value)}
                className="mt-1 h-9"
                maxLength={100}
              />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <p className="text-[11px] text-muted-foreground">
            Se crea el item con stock 0. Después agregás los componentes en la
            receta y, si es ENSAMBLADO, ensamblás para generar stock.
          </p>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button onClick={handleCreate} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Crear kit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
