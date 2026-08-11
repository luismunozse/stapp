"use client"

import { useState, useEffect, useMemo } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { useCurrency } from "@/contexts/currency-context"
import { Search, FileText } from "lucide-react"

interface CandidatoOrden {
  id: string
  numeroOrden: number
  codigoOrden: string | null
  dispositivo: string
  clienteNombre: string
}

interface CandidatoVenta {
  id: string
  numeroVenta: number
  clienteNombre: string
  total: number
}

interface GenerarFacturaModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function GenerarFacturaModal({ open, onOpenChange, onSuccess }: GenerarFacturaModalProps) {
  const { formatPrice } = useCurrency()
  const [tab, setTab] = useState<"ordenes" | "ventas">("ordenes")
  const [search, setSearch] = useState("")
  const [ordenes, setOrdenes] = useState<CandidatoOrden[]>([])
  const [ventas, setVentas] = useState<CandidatoVenta[]>([])
  const [loading, setLoading] = useState(false)
  const [generandoId, setGenerandoId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setSearch("")
    setError(null)
    setLoading(true)
    fetch("/api/facturacion/candidatos")
      .then((res) => res.json())
      .then((data) => {
        setOrdenes(data.ordenes || [])
        setVentas(data.ventas || [])
      })
      .catch(() => setError("Error al cargar las órdenes y ventas disponibles"))
      .finally(() => setLoading(false))
  }, [open])

  const ordenesFiltradas = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return ordenes
    return ordenes.filter(
      (o) =>
        o.clienteNombre.toLowerCase().includes(q) ||
        o.dispositivo.toLowerCase().includes(q) ||
        (o.codigoOrden || "").toLowerCase().includes(q) ||
        String(o.numeroOrden).includes(q)
    )
  }, [ordenes, search])

  const ventasFiltradas = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return ventas
    return ventas.filter(
      (v) => v.clienteNombre.toLowerCase().includes(q) || String(v.numeroVenta).includes(q)
    )
  }, [ventas, search])

  const generar = async (body: { ordenId: string } | { ventaId: string }) => {
    const id = "ordenId" in body ? body.ordenId : body.ventaId
    setGenerandoId(id)
    setError(null)
    try {
      const res = await fetch("/api/facturacion/generar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Error al generar el remito")
      }
      onOpenChange(false)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al generar el remito")
    } finally {
      setGenerandoId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Generar remito</DialogTitle>
          <DialogDescription>
            Elegí una orden reparada o una venta completada sin remito.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "ordenes" | "ventas")}>
          <TabsList>
            <TabsTrigger value="ordenes">Órdenes</TabsTrigger>
            <TabsTrigger value="ventas">Ventas</TabsTrigger>
          </TabsList>

          <div className="relative mt-3">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por cliente, dispositivo o número..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

          <TabsContent value="ordenes">
            <div className="mt-3 max-h-80 space-y-1 overflow-y-auto">
              {loading ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Cargando...</p>
              ) : ordenesFiltradas.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No hay órdenes sin remito
                </p>
              ) : (
                ordenesFiltradas.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    disabled={generandoId !== null}
                    onClick={() => generar({ ordenId: o.id })}
                    className="flex w-full items-center justify-between rounded-md border p-3 text-left text-sm hover:bg-muted/50 disabled:opacity-50"
                  >
                    <span>
                      <span className="font-medium">{o.codigoOrden || `#${o.numeroOrden}`}</span>
                      {" — "}
                      {o.clienteNombre} · {o.dispositivo}
                    </span>
                    {generandoId === o.id ? (
                      <span className="text-xs text-muted-foreground">Generando...</span>
                    ) : (
                      <FileText className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                ))
              )}
            </div>
          </TabsContent>

          <TabsContent value="ventas">
            <div className="mt-3 max-h-80 space-y-1 overflow-y-auto">
              {loading ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Cargando...</p>
              ) : ventasFiltradas.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No hay ventas sin remito
                </p>
              ) : (
                ventasFiltradas.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    disabled={generandoId !== null}
                    onClick={() => generar({ ventaId: v.id })}
                    className="flex w-full items-center justify-between rounded-md border p-3 text-left text-sm hover:bg-muted/50 disabled:opacity-50"
                  >
                    <span>
                      <span className="font-medium">V{String(v.numeroVenta).padStart(4, "0")}</span>
                      {" — "}
                      {v.clienteNombre} · {formatPrice(v.total)}
                    </span>
                    {generandoId === v.id ? (
                      <span className="text-xs text-muted-foreground">Generando...</span>
                    ) : (
                      <FileText className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
