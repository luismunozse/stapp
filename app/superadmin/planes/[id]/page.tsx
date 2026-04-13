"use client"

import { useEffect, useCallback, use } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Package } from "lucide-react"
import { PlanForm } from "../_components/plan-form"
import { useSuperadminFetch } from "@/hooks/use-superadmin-fetch"
import type { PlanWithUsage } from "@/types/superadmin"

interface PageProps {
  params: Promise<{ id: string }>
}

export default function EditPlanPage({ params }: PageProps) {
  const { id: planId } = use(params)
  const router = useRouter()
  const { data, loading, fetchData } = useSuperadminFetch<{ plan: PlanWithUsage }>()

  const loadPlan = useCallback(() => {
    fetchData(`/api/superadmin/plans/${planId}`)
  }, [planId, fetchData])

  useEffect(() => {
    loadPlan()
  }, [loadPlan])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  const plan = data?.plan
  if (!plan) {
    return null
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/superadmin/planes">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Package className="h-8 w-8" />
            Editar Plan: {plan.nombre}
          </h1>
          <p className="text-muted-foreground mt-1">
            Modifica la configuración del plan de suscripción
          </p>
        </div>
      </div>

      <PlanForm
        mode="edit"
        planId={planId}
        initialData={{
          nombre: plan.nombre,
          tipo: plan.tipo,
          descripcion: plan.descripcion,
          precio_mensual: plan.precio_mensual,
          precio_anual: plan.precio_anual,
          precio_mensual_usd: plan.precio_mensual_usd,
          precio_anual_usd: plan.precio_anual_usd,
          limite_ordenes: plan.limite_ordenes,
          limite_tecnicos: plan.limite_tecnicos,
          limite_clientes: plan.limite_clientes,
          limite_storage_mb: plan.limite_storage_mb,
          features: plan.features || [],
          feature_flags: plan.feature_flags || {},
        }}
      />
    </div>
  )
}
