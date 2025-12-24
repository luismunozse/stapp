"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Plus, Search } from "lucide-react"
import Link from "next/link"
import { OrdenForm } from "./orden-form"
import { formatDate, formatCurrency } from "@/lib/utils"
import type { OrdenServicio, EstadoOrden } from "@/types"

const estadoColors: Record<EstadoOrden, string> = {
  PENDIENTE: "bg-red-100 text-red-800",
  EN_REPARACION: "bg-yellow-100 text-yellow-800",
  ESPERANDO_REPUESTO: "bg-orange-100 text-orange-800",
  COMPLETADO: "bg-blue-100 text-blue-800",
  ENTREGADO: "bg-green-100 text-green-800",
  CANCELADO: "bg-gray-100 text-gray-800",
}

const estadoLabels: Record<EstadoOrden, string> = {
  PENDIENTE: "Pendiente",
  EN_REPARACION: "En Reparación",
  ESPERANDO_REPUESTO: "Esperando Repuesto",
  COMPLETADO: "Completado",
  ENTREGADO: "Entregado",
  CANCELADO: "Cancelado",
}

export function OrdenesList() {
  const [ordenes, setOrdenes] = useState<OrdenServicio[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [estado, setEstado] = useState<EstadoOrden | "">("")
  const [showForm, setShowForm] = useState(false)

  const fetchOrdenes = async () => {
    try {
      const params = new URLSearchParams()
      if (search) params.append("search", search)
      if (estado) params.append("estado", estado)

      const res = await fetch(`/api/ordenes?${params.toString()}`)
      const data = await res.json()
      setOrdenes(data)
    } catch (error) {
      console.error("Error fetching ordenes:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchOrdenes()
  }, [search, estado])

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Buscar por número, dispositivo o cliente..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select
          value={estado}
          onChange={(e) => setEstado(e.target.value as EstadoOrden | "")}
        >
          <option value="">Todos los estados</option>
          {Object.entries(estadoLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </Select>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Nueva Orden
        </Button>
      </div>

      {showForm && (
        <OrdenForm
          onClose={() => setShowForm(false)}
          onSuccess={() => {
            setShowForm(false)
            fetchOrdenes()
          }}
        />
      )}

      {loading ? (
        <div className="text-center py-8">Cargando...</div>
      ) : ordenes.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No hay órdenes registradas
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {ordenes.map((orden) => (
            <Card key={orden.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <Link
                        href={`/ordenes/${orden.id}`}
                        className="font-bold text-lg hover:underline"
                      >
                        Orden #{orden.numeroOrden}
                      </Link>
                      <Badge className={estadoColors[orden.estado]}>
                        {estadoLabels[orden.estado]}
                      </Badge>
                    </div>
                    <div className="space-y-1 text-sm">
                      <div>
                        <span className="font-medium">Cliente:</span>{" "}
                        {orden.cliente?.nombre}
                      </div>
                      <div>
                        <span className="font-medium">Dispositivo:</span>{" "}
                        {orden.dispositivo} ({orden.tipoDispositivo})
                      </div>
                      {orden.tecnico && (
                        <div>
                          <span className="font-medium">Técnico:</span>{" "}
                          {orden.tecnico.nombre}
                        </div>
                      )}
                      <div>
                        <span className="font-medium">Fecha Ingreso:</span>{" "}
                        {formatDate(orden.fechaIngreso)}
                      </div>
                      {orden.presupuesto && (
                        <div>
                          <span className="font-medium">Presupuesto:</span>{" "}
                          {formatCurrency(orden.presupuesto)}
                        </div>
                      )}
                    </div>
                  </div>
                  <Link href={`/ordenes/${orden.id}`}>
                    <Button variant="outline">Ver Detalles</Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

