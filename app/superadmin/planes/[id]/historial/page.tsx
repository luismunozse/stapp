"use client"

import { useState, useEffect, useCallback, use } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, History, Package, ChevronLeft, ChevronRight } from "lucide-react"
import { AuditTimeline } from "../../_components/audit-timeline"
import { useSuperadminFetch } from "@/hooks/use-superadmin-fetch"
import type { PlanAudit } from "@/types/superadmin"

const PAGE_SIZE = 20

interface AuditResponse {
  plan: { id: string; nombre: string; tipo: string }
  audit: PlanAudit[]
  total: number
}

interface PageProps {
  params: Promise<{ id: string }>
}

export default function PlanHistorialPage({ params }: PageProps) {
  const { id: planId } = use(params)
  const router = useRouter()
  const [page, setPage] = useState(1)

  const { data, loading, fetchData } = useSuperadminFetch<AuditResponse>()

  const fetchAudit = useCallback(() => {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: PAGE_SIZE.toString(),
    })
    fetchData(`/api/superadmin/plans/${planId}/audit?${params}`)
  }, [planId, page, fetchData])

  useEffect(() => {
    fetchAudit()
  }, [fetchAudit])

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  const plan = data?.plan
  const auditLogs = data?.audit || []
  const total = data?.total || 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  if (!plan) {
    return (
      <div className="text-center py-12 space-y-3">
        <Package className="h-12 w-12 text-muted-foreground mx-auto" />
        <p className="text-muted-foreground">Plan no encontrado</p>
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Volver
          </Button>
          <Button onClick={fetchAudit}>Reintentar</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/superadmin/planes">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <History className="h-8 w-8" />
            Historial de Cambios
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <Package className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">{plan.nombre}</span>
            <Badge variant="outline">{plan.tipo}</Badge>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 p-4 bg-muted rounded-lg">
        <History className="h-5 w-5 text-muted-foreground" />
        <div className="text-sm">
          <span className="font-semibold">{total}</span>{" "}
          {total === 1 ? "cambio registrado" : "cambios registrados"}
        </div>
      </div>

      {/* Timeline */}
      <AuditTimeline auditLogs={auditLogs} />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Página {page} de {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
            >
              Siguiente
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
