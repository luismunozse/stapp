"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, History, Package } from "lucide-react"
import { AuditTimeline } from "../../_components/audit-timeline"
import type { PlanAudit } from "@/types/superadmin"

export default function PlanHistorialPage() {
  const params = useParams()
  const router = useRouter()
  const planId = params.id as string

  const [plan, setPlan] = useState<{ id: string; nombre: string; tipo: string } | null>(null)
  const [auditLogs, setAuditLogs] = useState<PlanAudit[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchAudit()
  }, [planId])

  const fetchAudit = async () => {
    try {
      const res = await fetch(`/api/superadmin/plans/${planId}/audit`)
      if (!res.ok) {
        alert("Error al cargar el historial")
        router.push("/superadmin/planes")
        return
      }

      const data = await res.json()
      setPlan(data.plan)
      setAuditLogs(data.audit || [])
    } catch (error) {
      console.error("Error:", error)
      alert("Error al cargar el historial")
      router.push("/superadmin/planes")
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!plan) {
    return null
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
          <span className="font-semibold">{auditLogs.length}</span>{" "}
          {auditLogs.length === 1 ? "cambio registrado" : "cambios registrados"}
        </div>
      </div>

      {/* Timeline */}
      <AuditTimeline auditLogs={auditLogs} />
    </div>
  )
}
