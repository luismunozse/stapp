"use client"

import { useState, useCallback, useEffect } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Plus, Package, Send, PackageCheck, X, Truck } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { OrdenCompraForm } from "./orden-compra-form"
import { RecibirOCDialog } from "./recibir-oc-dialog"
import { estadoBadge } from "./estado-badge"
import { useModal } from "@/contexts/modal-context"

const fetcher = (url: string) => fetch(url, { cache: "no-store" }).then(res => res.json())

interface OrdenCompra {
  id: string
  numeroOC: string
  estado: string
  proveedor: { id: string; nombre: string } | null
  fechaEmision: string
  fechaRecepcionEsperada: string | null
  subtotal: number
  total: number
  notas: string | null
  createdBy: { id: string; nombre: string } | null
  createdAt: string
  items?: any[]
}


export function OrdenesCompraList() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [estadoFilter, setEstadoFilter] = useState<string>("all")
  const [showForm, setShowForm] = useState(false)
  const [draftItems, setDraftItems] = useState<any[] | undefined>(undefined)
  const [initialProveedorId, setInitialProveedorId] = useState<string | null>(null)
  const [recibirOC, setRecibirOC] = useState<OrdenCompra | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const { formatPrice, formatDate } = useCurrency()
  const { showError } = useModal()

  // Check for draft from inventario "Generar OC" button
  useEffect(() => {
    try {
      const draft = sessionStorage.getItem("oc-draft-items")
      if (draft) {
        sessionStorage.removeItem("oc-draft-items")
        setDraftItems(JSON.parse(draft))
        setShowForm(true)
      }
    } catch { /* ignore */ }
  }, [])

  // Quick OC from proveedor card: ?nueva=1&proveedorId=...
  useEffect(() => {
    if (searchParams.get("nueva") === "1") {
      setInitialProveedorId(searchParams.get("proveedorId"))
      setShowForm(true)
      // Limpiar query para que no re-abra al cerrar
      router.replace("/ordenes-compra")
    }
  }, [searchParams, router])

  const params = new URLSearchParams()
  params.append("limit", "50")
  if (estadoFilter !== "all") params.append("estado", estadoFilter)

  const { data, isLoading } = useSWR(
    `/api/ordenes-compra?${params.toString()}&_r=${refreshKey}`,
    fetcher
  )

  const items: OrdenCompra[] = data?.data || []

  const refresh = useCallback(() => setRefreshKey(k => k + 1), [])

  const handleChangeEstado = async (oc: OrdenCompra, nuevoEstado: string) => {
    try {
      const res = await fetch(`/api/ordenes-compra/${oc.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: nuevoEstado }),
      })
      if (!res.ok) {
        const err = await res.json()
        await showError(err.error || "Error al cambiar estado")
        return
      }
      refresh()
    } catch {
      await showError("Error al cambiar estado")
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar esta orden de compra?")) return
    try {
      const res = await fetch(`/api/ordenes-compra/${id}`, { method: "DELETE" })
      if (!res.ok) {
        const err = await res.json()
        await showError(err.error || "Error al eliminar")
        return
      }
      refresh()
    } catch {
      await showError("Error al eliminar")
    }
  }

  const columns: Column<OrdenCompra>[] = [
    {
      key: "numeroOC",
      header: "N° OC",
      render: (oc) => <span className="font-mono font-medium">{oc.numeroOC}</span>,
    },
    {
      key: "estado",
      header: "Estado",
      render: (oc) => {
        const badge = estadoBadge(oc.estado)
        return <Badge variant={badge.variant}>{badge.label}</Badge>
      },
    },
    {
      key: "proveedor",
      header: "Proveedor",
      render: (oc) => oc.proveedor?.nombre || <span className="text-muted-foreground">—</span>,
    },
    {
      key: "total",
      header: "Total",
      className: "text-right",
      headerClassName: "text-right",
      render: (oc) => <span className="font-medium">{formatPrice(oc.total)}</span>,
    },
    {
      key: "fechaEmision",
      header: "Emitida",
      hideOnMobile: true,
      render: (oc) => <span className="text-sm text-muted-foreground">{formatDate(oc.fechaEmision)}</span>,
    },
    {
      key: "acciones",
      header: "",
      className: "text-right",
      render: (oc) => (
        // DataTable solo frena la propagación en la celda del checkbox, así que
        // sin esto cada botón de acción abre además el detalle. Se frena acá y
        // no botón por botón para que el próximo que se agregue quede cubierto.
        <div
          className="flex items-center justify-end gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          {oc.estado === "BORRADOR" && (
            <>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => handleChangeEstado(oc, "ENVIADA")}>
                <Send className="mr-1 h-3 w-3" /> Enviar
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => handleDelete(oc.id)}>
                <X className="h-3 w-3" />
              </Button>
            </>
          )}
          {(oc.estado === "ENVIADA" || oc.estado === "RECIBIDA_PARCIAL") && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setRecibirOC(oc)}>
              <PackageCheck className="mr-1 h-3 w-3" /> Recibir
            </Button>
          )}
          {(oc.estado === "ENVIADA" || oc.estado === "RECIBIDA_PARCIAL") && (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => handleChangeEstado(oc, "CANCELADA")}>
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      ),
    },
  ]

  if (showForm) {
    return (
      <OrdenCompraForm
        onClose={() => { setShowForm(false); setDraftItems(undefined); setInitialProveedorId(null) }}
        onCreated={() => { setShowForm(false); setDraftItems(undefined); setInitialProveedorId(null); refresh() }}
        initialItems={draftItems}
        initialProveedorId={initialProveedorId}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <Select value={estadoFilter} onValueChange={setEstadoFilter}>
          <SelectTrigger className="w-full sm:w-[160px]">
            <SelectValue placeholder="Todos los estados" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="BORRADOR">Borrador</SelectItem>
            <SelectItem value="ENVIADA">Enviada</SelectItem>
            <SelectItem value="RECIBIDA_PARCIAL">Parcial</SelectItem>
            <SelectItem value="RECIBIDA">Recibida</SelectItem>
            <SelectItem value="CANCELADA">Cancelada</SelectItem>
          </SelectContent>
        </Select>

        <Button onClick={() => setShowForm(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Nueva OC
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Truck className="h-12 w-12 text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground">No hay órdenes de compra</p>
            <Button variant="outline" className="mt-3" onClick={() => setShowForm(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Crear primera OC
            </Button>
          </CardContent>
        </Card>
      ) : (
        <DataTable
          data={items}
          columns={columns}
          keyExtractor={(oc) => oc.id}
          // DataTable ya frena la propagación en la celda de acciones, así que
          // Enviar/Recibir/Cancelar no abren el detalle.
          onRowClick={(oc) => router.push(`/ordenes-compra/${oc.id}`)}
        />
      )}

      {recibirOC && (
        <RecibirOCDialog
          open={!!recibirOC}
          onOpenChange={(open) => { if (!open) setRecibirOC(null) }}
          ordenCompraId={recibirOC.id}
          numeroOC={recibirOC.numeroOC}
          onReceived={() => { setRecibirOC(null); refresh() }}
        />
      )}
    </div>
  )
}
