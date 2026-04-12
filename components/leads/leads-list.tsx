"use client"

import { useState, useMemo, useRef, useEffect, useCallback } from "react"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Search, Eye, Mail, Phone, Calendar } from "lucide-react"
import { LeadDetailDialog } from "./lead-detail-dialog"
import { useCurrency } from "@/contexts/currency-context"
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
  const { formatDate } = useCurrency()
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [estadoFilter, setEstadoFilter] = useState("TODOS")
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)

  // Debounce search
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value)
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => setDebouncedSearch(value), 300)
  }, [])
  useEffect(() => {
    return () => { if (debounceTimer.current) clearTimeout(debounceTimer.current) }
  }, [])

  const fetcher = (url: string) => fetch(url).then(res => res.json())
  const apiUrl = useMemo(() => {
    const params = new URLSearchParams()
    if (estadoFilter !== "TODOS") params.append("estado", estadoFilter)
    if (debouncedSearch) params.append("search", debouncedSearch)
    return `/api/leads?${params}`
  }, [estadoFilter, debouncedSearch])

  const { data, isLoading: loading, mutate } = useSWR(apiUrl, fetcher, {
    revalidateOnFocus: false, dedupingInterval: 5000,
  })

  const leads: Lead[] = data?.leads || []
  const total = data?.total || 0

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
            onChange={(e) => handleSearchChange(e.target.value)}
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
      <div className="bg-muted p-3 sm:p-4 rounded-lg">
        <p className="text-xs sm:text-sm text-muted-foreground">
          Total de leads: <span className="font-bold text-foreground">{total}</span>
        </p>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground text-sm">Cargando leads...</p>
        </div>
      ) : leads.length === 0 ? (
        <div className="text-center py-12 border border-dashed rounded-lg">
          <p className="text-muted-foreground text-sm">No se encontraron leads</p>
        </div>
      ) : (
        <>
          {/* Desktop: Table */}
          <div className="hidden sm:block border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left p-3 font-medium text-sm">Nombre</th>
                    <th className="text-left p-3 font-medium text-sm">Contacto</th>
                    <th className="text-left p-3 font-medium text-sm">Interés</th>
                    <th className="text-left p-3 font-medium text-sm">Estado</th>
                    <th className="text-left p-3 font-medium text-sm">Fecha</th>
                    <th className="text-left p-3 font-medium text-sm"></th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => (
                    <tr key={lead.id} className="border-t hover:bg-muted/50">
                      <td className="p-3 font-medium">{lead.nombre || "Sin nombre"}</td>
                      <td className="p-3">
                        <div className="text-sm">
                          {lead.email && <div className="truncate max-w-[200px]">{lead.email}</div>}
                          {lead.telefono && <div>{lead.telefono}</div>}
                          {!lead.email && !lead.telefono && <div className="text-muted-foreground">Sin contacto</div>}
                        </div>
                      </td>
                      <td className="p-3">
                        {lead.plan_interes && (
                          <Badge variant="outline">{lead.plan_interes}</Badge>
                        )}
                      </td>
                      <td className="p-3">{getEstadoBadge(lead.estado)}</td>
                      <td className="p-4 text-sm text-muted-foreground">
                        {formatDate(lead.created_at)}
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

          {/* Mobile: Cards */}
          <div className="sm:hidden space-y-3">
            {leads.map((lead) => (
              <Card key={lead.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{lead.nombre || "Sin nombre"}</p>
                      {lead.plan_interes && (
                        <Badge variant="outline" className="text-[10px] mt-1">{lead.plan_interes}</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {getEstadoBadge(lead.estado)}
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedLead(lead)}>
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1.5 text-xs text-muted-foreground">
                    {lead.email && (
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Mail className="h-3 w-3 shrink-0" />
                        <span className="truncate">{lead.email}</span>
                      </div>
                    )}
                    {lead.telefono && (
                      <div className="flex items-center gap-1.5">
                        <Phone className="h-3 w-3 shrink-0" />
                        <span>{lead.telefono}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5">
                      <Calendar className="h-3 w-3 shrink-0" />
                      <span>{formatDate(lead.created_at)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Dialog de detalle */}
      {selectedLead && (
        <LeadDetailDialog
          lead={selectedLead}
          isOpen={!!selectedLead}
          onClose={() => setSelectedLead(null)}
          onUpdate={() => mutate()}
        />
      )}
    </div>
  )
}
