"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Package } from "lucide-react"
import { PlanForm } from "../_components/plan-form"
import type { PlanWithUsage } from "@/types/superadmin"

export default function EditPlanPage() {
  const params = useParams()
  const router = useRouter()
  const planId = params.id as string

  const [plan, setPlan] = useState<PlanWithUsage | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchPlan()
  }, [planId])

  const fetchPlan = async () => {
    try {
      const res = await fetch(`/api/superadmin/plans/${planId}`)
      if (!res.ok) {
        alert("Error al cargar el plan")
        router.push("/superadmin/planes")
        return
      }

      const data = await res.json()
      setPlan(data.plan)
    } catch (error) {
      console.error("Error:", error)
      alert("Error al cargar el plan")
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

      {/* Form */}
      <PlanForm
        mode="edit"
        planId={planId}
        initialData={{
          nombre: plan.nombre,
          tipo: plan.tipo,
          descripcion: plan.descripcion,
          precio_mensual: plan.precio_mensual,
          precio_anual: plan.precio_anual,
          limite_ordenes: plan.limite_ordenes,
          limite_tecnicos: plan.limite_tecnicos,
          limite_clientes: plan.limite_clientes,
          limite_storage_mb: plan.limite_storage_mb,
          features: plan.features || [],
        }}
      />
    </div>
  )
}
