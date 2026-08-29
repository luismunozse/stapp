"use client"

import useSWR from "swr"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { AlertTriangle, Package } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { estadoBadge } from "./estado-badge"

interface ItemOC {
  id: string
  descripcion: string | null
  inventarioId: string | null
  inventario: { id: string; codigo: string; nombre: string; stock: number } | null
  cantidadPedida: number
  cantidadRecibida: number
  precioUnitario: number
  subtotal: number
}

interface OrdenCompra {
  id: string
  numeroOC: string
  estado: string
  proveedor: { id: string; nombre: string } | null
  fechaEmision: string
  fechaRecepcionEsperada: string | null
  fechaRecepcionReal: string | null
  subtotal: number
  total: number
  notas: string | null
  createdBy: { id: string; nombre: string } | null
  items?: ItemOC[]
}

const fetcher = async (url: string) => {
  const res = await fetch(url, { cache: "no-store" })
  const json = await res.json()
  if (!res.ok) throw new Error(json?.error || "Error al cargar la orden de compra")
  return json
}

interface OrdenCompraDetalleProps {
  ordenCompraId: string
}

export function OrdenCompraDetalle({ ordenCompraId }: OrdenCompraDetalleProps) {
  const { formatPrice, formatDate } = useCurrency()
  const { data, error, isLoading } = useSWR<OrdenCompra>(
    `/api/ordenes-compra/${ordenCompraId}`,
    fetcher
  )

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <AlertTriangle className="h-10 w-10 text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground">
            {error instanceof Error ? error.message : "Orden de compra no encontrada"}
          </p>
        </CardContent>
      </Card>
    )
  }

  const badge = estadoBadge(data.estado)
  const items = data.items || []
  // El subtotal solo aporta cuando difiere del total; si no, es la misma cifra
  // dos veces.
  const mostrarSubtotal = data.subtotal !== data.total

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-lg font-semibold">{data.numeroOC}</span>
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <Dato label="Proveedor" valor={data.proveedor?.nombre} />
            <Dato label="Emitida" valor={formatDate(data.fechaEmision)} />
            <Dato
              label="Recepción esperada"
              valor={data.fechaRecepcionEsperada ? formatDate(data.fechaRecepcionEsperada) : null}
            />
            <Dato
              label={data.fechaRecepcionReal ? "Recibida" : "Creada por"}
              valor={
                data.fechaRecepcionReal
                  ? formatDate(data.fechaRecepcionReal)
                  : data.createdBy?.nombre
              }
            />
          </dl>

          {data.notas && (
            <div className="mt-4 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              {data.notas}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Package className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground">Esta orden no tiene ítems</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Descripción</th>
                    <th className="text-left px-3 py-2 font-medium">Artículo</th>
                    <th className="text-center px-3 py-2 font-medium w-28">Recibido</th>
                    <th className="text-right px-3 py-2 font-medium w-32">Precio unit.</th>
                    <th className="text-right px-3 py-2 font-medium w-32">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="border-t">
                      <td className="px-3 py-2">{item.descripcion || "—"}</td>
                      <td className="px-3 py-2">
                        {item.inventario ? (
                          <span className="text-xs">
                            <span className="font-mono">{item.inventario.codigo}</span>
                            <span className="text-muted-foreground"> · {item.inventario.nombre}</span>
                          </span>
                        ) : (
                          // Sin vínculo, recibir este ítem no mueve stock. Es la
                          // información que el listado escondía.
                          <Badge variant="outline" className="text-xs font-normal">
                            Sin vincular
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums">
                        <span
                          className={
                            item.cantidadRecibida >= item.cantidadPedida
                              ? "font-medium"
                              : "text-muted-foreground"
                          }
                        >
                          {item.cantidadRecibida} / {item.cantidadPedida}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatPrice(item.precioUnitario)}
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        {formatPrice(item.subtotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t bg-muted/30">
                  {mostrarSubtotal && (
                    <tr>
                      <td colSpan={4} className="px-3 py-2 text-right text-muted-foreground">
                        Subtotal
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatPrice(data.subtotal)}
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td colSpan={4} className="px-3 py-2 text-right font-medium">
                      Total
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {formatPrice(data.total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Dato({ label, valor }: { label: string; valor?: string | null }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{valor || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  )
}
