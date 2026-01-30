"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Package } from "lucide-react"
import { PlanForm } from "../_components/plan-form"

export default function NuevoPlanPage() {
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
            Crear Nuevo Plan
          </h1>
          <p className="text-muted-foreground mt-1">
            Define un nuevo plan de suscripción para el sistema
          </p>
        </div>
      </div>

      {/* Form */}
      <PlanForm mode="create" />
    </div>
  )
}
