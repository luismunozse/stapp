"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Search, Eye } from "lucide-react"
import { LeadDetailDialog } from "./lead-detail-dialog"
import type { Lead } from "@/types/database"

const ESTADOS_LEAD = [
  { value: "TODOS", label: "Todos" },
  { value: "NUEVO", label: "Nuevo", color: "bg-blue-500" },
  { value: "CONTACTADO", label: "Contactado", color: "bg-yellow-500" },
  { value: "CALIFICADO", label: "Calificado", color: "bg-purple-500" },
  { value: "CONVERTIDO", label: "Convertido", color: "bg-green-500" },
  { value: "DESCARTADO", label: "Descartado", color: "bg-gray-500" },
]

export function LeadsList() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [estadoFilter, setEstadoFilter] = useState("TODOS")
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    fetchLeads()
  }, [estadoFilter])

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchLeads()
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const fetchLeads = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (estadoFilter !== "TODOS") params.append("estado", estadoFilter)
      if (search) params.append("search", search)

      const response = await fetch(`/api/leads?${params}`)
      const data = await response.json()

      setLeads(data.leads || [])
      setTotal(data.total || 0)
    } catch (error) {
      console.error("Error fetching leads:", error)
    } finally {
      setLoading(false)
    }
  }

  const getEstadoBadge = (estado: string) => {
    const estadoInfo = ESTADOS_LEAD.find((e) => e.value === estado)
    return (
      <Badge className={estadoInfo?.color || "bg-gray-500"}>
        {estadoInfo?.label || estado}
      </Badge>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, email, teléfono..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <select
          value={estadoFilter}
          onChange={(e) => setEstadoFilter(e.target.value)}
          className="px-4 py-2 rounded-md border border-input bg-background"
        >
          {ESTADOS_LEAD.map((estado) => (
            <option key={estado.value} value={estado.value}>
              {estado.label}
            </option>
          ))}
        </select>
      </div>

      {/* Estadísticas */}
      <div className="bg-muted p-4 rounded-lg">
        <p className="text-sm text-muted-foreground">
          Total de leads: <span className="font-bold text-foreground">{total}</span>
        </p>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">Cargando leads...</p>
        </div>
      ) : leads.length === 0 ? (
        <div className="text-center py-12 border border-dashed rounded-lg">
          <p className="text-muted-foreground">No se encontraron leads</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left p-4 font-medium">Nombre</th>
                  <th className="text-left p-4 font-medium">Contacto</th>
                  <th className="text-left p-4 font-medium">Interés</th>
                  <th className="text-left p-4 font-medium">Estado</th>
                  <th className="text-left p-4 font-medium">Fecha</th>
                  <th className="text-left p-4 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id} className="border-t hover:bg-muted/50">
                    <td className="p-4 font-medium">{lead.nombre || "Sin nombre"}</td>
                    <td className="p-4">
                      <div className="text-sm">
                        {lead.email && <div>{lead.email}</div>}
                        {lead.telefono && <div>{lead.telefono}</div>}
                        {!lead.email && !lead.telefono && <div className="text-muted-foreground">Sin contacto</div>}
                      </div>
                    </td>
                    <td className="p-4">
                      {lead.plan_interes && (
                        <Badge variant="outline">{lead.plan_interes}</Badge>
                      )}
                    </td>
                    <td className="p-4">{getEstadoBadge(lead.estado)}</td>
                    <td className="p-4 text-sm text-muted-foreground">
                      {new Date(lead.created_at).toLocaleDateString("es-AR")}
                    </td>
                    <td className="p-4">
                      <Button variant="ghost" size="sm" onClick={() => setSelectedLead(lead)}>
                        <Eye className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Dialog de detalle */}
      {selectedLead && (
        <LeadDetailDialog
          lead={selectedLead}
          isOpen={!!selectedLead}
          onClose={() => setSelectedLead(null)}
          onUpdate={fetchLeads}
        />
      )}
    </div>
  )
}
