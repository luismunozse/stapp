"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { FileText, DollarSign, CheckCircle, Clock } from "lucide-react"
import { formatDate, formatCurrency } from "@/lib/utils"
import type { Factura, EstadoPago } from "@/types"

export function FacturacionList() {
  const [facturas, setFacturas] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [estadoPago, setEstadoPago] = useState<EstadoPago | "">("")

  const fetchFacturas = async () => {
    try {
      const params = new URLSearchParams()
      if (estadoPago) params.append("estadoPago", estadoPago)

      const res = await fetch(`/api/facturacion?${params.toString()}`)
      const data = await res.json()
      setFacturas(data)
    } catch (error) {
      console.error("Error fetching facturas:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchFacturas()
  }, [estadoPago])

  const handleGenerarFactura = async (ordenId: string) => {
    if (!confirm("¿Generar factura para esta orden?")) return

    try {
      const res = await fetch("/api/facturacion/generar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ordenId }),
      })

      if (res.ok) {
        fetchFacturas()
      } else {
        const error = await res.json()
        alert(error.error || "Error al generar factura")
      }
    } catch (error) {
      console.error("Error generating factura:", error)
      alert("Error al generar factura")
    }
  }

  const handleUpdateEstadoPago = async (facturaId: string, nuevoEstado: EstadoPago) => {
    try {
      const res = await fetch(`/api/facturacion/${facturaId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estadoPago: nuevoEstado }),
      })

      if (res.ok) {
        fetchFacturas()
      }
    } catch (error) {
      console.error("Error updating estado:", error)
    }
  }

  if (loading) {
    return <div className="text-center py-8">Cargando...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-4">
        <Select
          value={estadoPago}
          onChange={(e) => setEstadoPago(e.target.value as EstadoPago | "")}
        >
          <option value="">Todos los estados</option>
          <option value="PENDIENTE">Pendiente</option>
          <option value="PAGADO">Pagado</option>
        </Select>
      </div>

      {facturas.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No hay facturas registradas
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {facturas.map((factura) => (
            <Card key={factura.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <FileText className="h-5 w-5" />
                      Factura {factura.numeroFactura}
                    </CardTitle>
                    <div className="text-sm text-muted-foreground mt-1">
                      Orden #{factura.orden.numeroOrden} - {factura.orden.cliente.nombre}
                    </div>
                  </div>
                  <Badge
                    variant={
                      factura.estadoPago === "PAGADO" ? "success" : "warning"
                    }
                  >
                    {factura.estadoPago === "PAGADO" ? (
                      <>
                        <CheckCircle className="mr-1 h-3 w-3" />
                        Pagado
                      </>
                    ) : (
                      <>
                        <Clock className="mr-1 h-3 w-3" />
                        Pendiente
                      </>
                    )}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">Fecha:</span>
                  {formatDate(factura.fecha)}
                </div>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <div className="text-muted-foreground">Subtotal</div>
                    <div className="font-medium">{formatCurrency(factura.subtotal)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">IVA (21%)</div>
                    <div className="font-medium">{formatCurrency(factura.iva)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Total</div>
                    <div className="font-medium text-lg">
                      {formatCurrency(factura.total)}
                    </div>
                  </div>
                </div>
                {factura.estadoPago === "PENDIENTE" && (
                  <Button
                    onClick={() => handleUpdateEstadoPago(factura.id, "PAGADO")}
                    className="w-full"
                  >
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Marcar como Pagado
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

