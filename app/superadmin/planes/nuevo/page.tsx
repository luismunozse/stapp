"use client"

import { Package } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { PlanForm } from "../_components/plan-form"

export default function NuevoPlanPage() {
  return (
    <PageShell
      title="Nuevo plan"
      description="Definí un nuevo plan de suscripción para el sistema"
      icon={Package}
      backHref="/superadmin/planes"
      backLabel="Volver a planes"
    >
      <PlanForm mode="create" />
    </PageShell>
  )
}
