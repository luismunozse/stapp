"use client"

import { useState, useEffect } from "react"
import { redirect } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Package, Plus, Users, Building2, Check, X, Edit, Power, History } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import type { PlanWithUsage } from "@/types/superadmin"

export default function PlanesPage() {
  const [plans, setPlans] = useState<PlanWithUsage[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchPlans()
  }, [])

  const fetchPlans = async () => {
    try {
      const res = await fetch("/api/superadmin/plans")
      if (!res.ok) throw new Error("Error fetching plans")

      const data = await res.json()
      setPlans(data.plans || [])
    } catch (error) {
      console.error("Error:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleToggle = async (planId: string, currentStatus: boolean) => {
    if (!confirm(`¿Estás seguro de ${currentStatus ? "desactivar" : "activar"} este plan?`)) {
      return
    }

    try {
      const res = await fetch(`/api/superadmin/plans/${planId}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: !currentStatus }),
      })

      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || "Error al cambiar estado del plan")
        return
      }

      toast.success(data.message)
      fetchPlans()
    } catch (error) {
      console.error("Error:", error)
      toast.error("Error al cambiar estado del plan")
    }
  }

  const getPlanTypeColor = (tipo: string) => {
    return tipo === "FREE" ? "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300" : "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300"
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Package className="h-8 w-8" />
            Gestión de Planes
          </h1>
          <p className="text-muted-foreground mt-1">
            Administra los planes de suscripción del sistema
          </p>
        </div>
        <Link href="/superadmin/planes/nuevo">
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            Crear Plan
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Planes</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{plans.length}</div>
            <p className="text-xs text-muted-foreground">
              {plans.filter(p => p.activo).length} activos
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Organizaciones</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {plans.reduce((sum, p) => sum + (p.organizations_count || 0), 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              Usando los planes
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Suscripciones Activas</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {plans.reduce((sum, p) => sum + (p.active_subscriptions || 0), 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              Con estado ACTIVE
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Plans Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-2">
        {plans.map((plan) => (
          <Card key={plan.id} className={!plan.activo ? "opacity-60" : ""}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-xl">{plan.nombre}</CardTitle>
                    <Badge className={getPlanTypeColor(plan.tipo)}>
                      {plan.tipo}
                    </Badge>
                  </div>
                  {plan.descripcion && (
                    <CardDescription className="text-sm">
                      {plan.descripcion}
                    </CardDescription>
                  )}
                </div>
                <Badge variant={plan.activo ? "default" : "secondary"}>
                  {plan.activo ? "Activo" : "Inactivo"}
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              {/* Precios */}
              <div className="flex items-baseline gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">Mensual</div>
                  <div className="text-2xl font-bold">
                    {formatCurrency(plan.precio_mensual)}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Anual</div>
                  <div className="text-2xl font-bold">
                    {formatCurrency(plan.precio_anual)}
                  </div>
                </div>
              </div>

              {/* Límites */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex items-center justify-between py-2 px-3 bg-muted rounded-lg">
                  <span className="text-muted-foreground">Órdenes/mes</span>
                  <span className="font-semibold">
                    {plan.limite_ordenes === null ? "∞" : plan.limite_ordenes}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 px-3 bg-muted rounded-lg">
                  <span className="text-muted-foreground">Técnicos</span>
                  <span className="font-semibold">
                    {plan.limite_tecnicos === null ? "∞" : plan.limite_tecnicos}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 px-3 bg-muted rounded-lg">
                  <span className="text-muted-foreground">Clientes</span>
                  <span className="font-semibold">
                    {plan.limite_clientes === null ? "∞" : plan.limite_clientes}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 px-3 bg-muted rounded-lg">
                  <span className="text-muted-foreground">Storage (MB)</span>
                  <span className="font-semibold">
                    {plan.limite_storage_mb === null ? "∞" : plan.limite_storage_mb}
                  </span>
                </div>
              </div>

              {/* Uso */}
              <div className="flex items-center justify-between py-3 border-t">
                <div className="flex items-center gap-2 text-sm">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Organizaciones:</span>
                  <span className="font-semibold">{plan.organizations_count}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Activas:</span>
                  <span className="font-semibold">{plan.active_subscriptions}</span>
                </div>
              </div>

              {/* Features */}
              {plan.features && plan.features.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm font-medium">Características:</div>
                  <div className="space-y-1">
                    {plan.features.slice(0, 3).map((feature) => (
                      <div key={feature} className="flex items-center gap-2 text-sm">
                        <Check className="h-3.5 w-3.5 text-green-600" />
                        <span className="text-muted-foreground">{feature}</span>
                      </div>
                    ))}
                    {plan.features.length > 3 && (
                      <div className="text-xs text-muted-foreground ml-5">
                        +{plan.features.length - 3} más
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 pt-2">
                <Link href={`/superadmin/planes/${plan.id}`} className="flex-1">
                  <Button variant="outline" className="w-full gap-2">
                    <Edit className="h-4 w-4" />
                    Editar
                  </Button>
                </Link>
                <Link href={`/superadmin/planes/${plan.id}/historial`}>
                  <Button variant="ghost" size="icon">
                    <History className="h-4 w-4" />
                  </Button>
                </Link>
                <Button
                  variant={plan.activo ? "destructive" : "default"}
                  size="icon"
                  onClick={() => handleToggle(plan.id, plan.activo)}
                  title={plan.activo ? "Desactivar" : "Activar"}
                >
                  <Power className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {plans.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Package className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">No hay planes creados</p>
            <p className="text-sm text-muted-foreground mb-4">
              Crea tu primer plan de suscripción
            </p>
            <Link href="/superadmin/planes/nuevo">
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Crear Plan
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
