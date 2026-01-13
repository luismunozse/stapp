"use client"

import { useState, useEffect, use } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  ArrowLeft,
  Building2,
  Users,
  Package,
  CreditCard,
  Receipt,
  Power,
  PowerOff,
  Save,
  ExternalLink,
} from "lucide-react"
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils"
import type {
  OrganizationDetail,
  OrganizationUser,
  OrganizationUsage,
  SubscriptionWithPlan,
  PaymentWithOrg,
} from "@/types/superadmin"

interface PageProps {
  params: Promise<{ id: string }>
}

export default function OrganizacionDetallePage({ params }: PageProps) {
  const { id } = use(params)
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [organization, setOrganization] = useState<OrganizationDetail | null>(null)
  const [users, setUsers] = useState<OrganizationUser[]>([])
  const [usage, setUsage] = useState<OrganizationUsage | null>(null)
  const [subscription, setSubscription] = useState<SubscriptionWithPlan | null>(null)
  const [payments, setPayments] = useState<PaymentWithOrg[]>([])

  // Form state
  const [formData, setFormData] = useState({
    nombre: "",
    nombre_mostrar: "",
    email: "",
    telefono: "",
    direccion: "",
  })

  useEffect(() => {
    fetchOrganization()
  }, [id])

  const fetchOrganization = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/superadmin/organizations/${id}`)
      if (!res.ok) throw new Error("Error fetching organization")

      const data = await res.json()
      setOrganization(data.organization)
      setUsers(data.users || [])
      setUsage(data.usage)
      setSubscription(data.subscription)
      setPayments(data.payments || [])

      // Set form data
      setFormData({
        nombre: data.organization.nombre || "",
        nombre_mostrar: data.organization.nombre_mostrar || "",
        email: data.organization.email || "",
        telefono: data.organization.telefono || "",
        direccion: data.organization.direccion || "",
      })
    } catch (error) {
      console.error("Error:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleToggleStatus = async () => {
    if (!organization) return
    try {
      const res = await fetch(`/api/superadmin/organizations/${id}/toggle-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: !organization.activo }),
      })
      if (!res.ok) throw new Error("Error toggling status")
      fetchOrganization()
    } catch (error) {
      console.error("Error:", error)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/superadmin/organizations/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      })
      if (!res.ok) throw new Error("Error saving organization")
      fetchOrganization()
    } catch (error) {
      console.error("Error:", error)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!organization) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Organización no encontrada</p>
        <Button variant="link" onClick={() => router.back()}>
          Volver
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Building2 className="h-8 w-8" />
              {organization.nombre}
            </h1>
            <p className="text-muted-foreground flex items-center gap-2">
              {organization.slug}.stapp.com.ar
              <a
                href={`https://${organization.slug}.stapp.com.ar`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge
            variant={organization.activo ? "default" : "destructive"}
            className="text-sm px-3 py-1"
          >
            {organization.activo ? "Activa" : "Inactiva"}
          </Badge>
          <Button
            variant={organization.activo ? "destructive" : "default"}
            onClick={handleToggleStatus}
          >
            {organization.activo ? (
              <>
                <PowerOff className="h-4 w-4 mr-2" />
                Desactivar
              </>
            ) : (
              <>
                <Power className="h-4 w-4 mr-2" />
                Activar
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="info">
        <TabsList>
          <TabsTrigger value="info">Información</TabsTrigger>
          <TabsTrigger value="users">Usuarios ({users.length})</TabsTrigger>
          <TabsTrigger value="usage">Uso</TabsTrigger>
          <TabsTrigger value="subscription">Suscripción</TabsTrigger>
          <TabsTrigger value="payments">Pagos ({payments.length})</TabsTrigger>
        </TabsList>

        {/* Info Tab */}
        <TabsContent value="info" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Datos de la Organización</CardTitle>
              <CardDescription>
                Información general de la organización
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="nombre">Nombre</Label>
                  <Input
                    id="nombre"
                    value={formData.nombre}
                    onChange={(e) =>
                      setFormData({ ...formData, nombre: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nombre_mostrar">Nombre a mostrar</Label>
                  <Input
                    id="nombre_mostrar"
                    value={formData.nombre_mostrar}
                    onChange={(e) =>
                      setFormData({ ...formData, nombre_mostrar: e.target.value })
                    }
                    placeholder="Opcional"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) =>
                      setFormData({ ...formData, email: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="telefono">Teléfono</Label>
                  <Input
                    id="telefono"
                    value={formData.telefono}
                    onChange={(e) =>
                      setFormData({ ...formData, telefono: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="direccion">Dirección</Label>
                  <Input
                    id="direccion"
                    value={formData.direccion}
                    onChange={(e) =>
                      setFormData({ ...formData, direccion: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="flex justify-between items-center pt-4 border-t">
                <div className="text-sm text-muted-foreground">
                  Creada: {formatDateTime(organization.created_at)}
                </div>
                <Button onClick={handleSave} disabled={saving}>
                  <Save className="h-4 w-4 mr-2" />
                  {saving ? "Guardando..." : "Guardar cambios"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Users Tab */}
        <TabsContent value="users">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Usuarios
              </CardTitle>
              <CardDescription>
                {users.length} usuarios registrados en esta organización
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3 font-medium">Nombre</th>
                      <th className="text-left p-3 font-medium">Email</th>
                      <th className="text-left p-3 font-medium">Rol</th>
                      <th className="text-left p-3 font-medium">Email verificado</th>
                      <th className="text-left p-3 font-medium">Creado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.id} className="border-b last:border-0">
                        <td className="p-3 font-medium">{user.nombre}</td>
                        <td className="p-3">{user.email}</td>
                        <td className="p-3">
                          <Badge variant="outline">{user.rol}</Badge>
                        </td>
                        <td className="p-3">
                          <Badge variant={user.email_verified ? "default" : "secondary"}>
                            {user.email_verified ? "Sí" : "No"}
                          </Badge>
                        </td>
                        <td className="p-3 text-muted-foreground">
                          {formatDate(user.created_at)}
                        </td>
                      </tr>
                    ))}
                    {users.length === 0 && (
                      <tr>
                        <td colSpan={5} className="p-8 text-center text-muted-foreground">
                          No hay usuarios registrados
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Usage Tab */}
        <TabsContent value="usage">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Uso Actual
              </CardTitle>
              <CardDescription>
                Consumo de recursos de la organización
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 bg-muted rounded-lg text-center">
                  <div className="text-3xl font-bold">
                    {usage?.ordenes_mes_actual || 0}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Órdenes este mes
                  </div>
                </div>
                <div className="p-4 bg-muted rounded-lg text-center">
                  <div className="text-3xl font-bold">
                    {usage?.ordenes_count || 0}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Órdenes totales
                  </div>
                </div>
                <div className="p-4 bg-muted rounded-lg text-center">
                  <div className="text-3xl font-bold">
                    {usage?.tecnicos_count || 0}
                  </div>
                  <div className="text-sm text-muted-foreground">Técnicos</div>
                </div>
                <div className="p-4 bg-muted rounded-lg text-center">
                  <div className="text-3xl font-bold">
                    {usage?.clientes_count || 0}
                  </div>
                  <div className="text-sm text-muted-foreground">Clientes</div>
                </div>
              </div>

              {usage && (
                <div className="mt-4 p-4 bg-muted/50 rounded-lg">
                  <div className="text-sm text-muted-foreground">
                    Storage usado: {(usage.storage_used_mb || 0).toFixed(2)} MB
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Período inicio: {formatDate(usage.periodo_inicio)}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Subscription Tab */}
        <TabsContent value="subscription">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Suscripción
              </CardTitle>
            </CardHeader>
            <CardContent>
              {subscription ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <Badge className="text-lg px-4 py-1">
                      {subscription.plans?.nombre || "Plan"}
                    </Badge>
                    <Badge
                      variant={
                        subscription.status === "ACTIVE" ? "default" : "secondary"
                      }
                    >
                      {subscription.status}
                    </Badge>
                    {subscription.billing_period && (
                      <Badge variant="outline">{subscription.billing_period}</Badge>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
                    <div>
                      <div className="text-sm text-muted-foreground">
                        Período actual termina
                      </div>
                      <div className="font-medium">
                        {subscription.current_period_end
                          ? formatDate(subscription.current_period_end)
                          : "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">
                        Cancelación pendiente
                      </div>
                      <div className="font-medium">
                        {subscription.cancel_at_period_end ? "Sí" : "No"}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">
                        Proveedor de pago
                      </div>
                      <div className="font-medium">
                        {subscription.payment_provider || "N/A"}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Creada</div>
                      <div className="font-medium">
                        {formatDate(subscription.created_at)}
                      </div>
                    </div>
                  </div>

                  {subscription.plans && (
                    <div className="p-4 border rounded-lg">
                      <h4 className="font-medium mb-2">Límites del plan</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                        <div>
                          Órdenes:{" "}
                          {subscription.plans.limite_ordenes || "Ilimitado"}
                        </div>
                        <div>
                          Técnicos:{" "}
                          {subscription.plans.limite_tecnicos || "Ilimitado"}
                        </div>
                        <div>
                          Clientes:{" "}
                          {subscription.plans.limite_clientes || "Ilimitado"}
                        </div>
                        <div>
                          Storage:{" "}
                          {subscription.plans.limite_storage_mb
                            ? `${subscription.plans.limite_storage_mb} MB`
                            : "Ilimitado"}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground">
                  Esta organización no tiene una suscripción activa (Plan Free)
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Payments Tab */}
        <TabsContent value="payments">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Receipt className="h-5 w-5" />
                Historial de Pagos
              </CardTitle>
              <CardDescription>
                Últimos {payments.length} pagos de la organización
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3 font-medium">Fecha</th>
                      <th className="text-left p-3 font-medium">Monto</th>
                      <th className="text-left p-3 font-medium">Estado</th>
                      <th className="text-left p-3 font-medium">Proveedor</th>
                      <th className="text-left p-3 font-medium">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((payment) => (
                      <tr key={payment.id} className="border-b last:border-0">
                        <td className="p-3">
                          {payment.paid_at
                            ? formatDateTime(payment.paid_at)
                            : formatDateTime(payment.created_at)}
                        </td>
                        <td className="p-3 font-medium">
                          {formatCurrency(payment.amount)}
                        </td>
                        <td className="p-3">
                          <Badge
                            variant={
                              payment.status === "SUCCEEDED"
                                ? "default"
                                : payment.status === "PENDING"
                                  ? "secondary"
                                  : "destructive"
                            }
                          >
                            {payment.status}
                          </Badge>
                        </td>
                        <td className="p-3">{payment.payment_provider || "-"}</td>
                        <td className="p-3">
                          {payment.receipt_url && (
                            <a
                              href={payment.receipt_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline text-xs"
                            >
                              Ver recibo
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                    {payments.length === 0 && (
                      <tr>
                        <td colSpan={5} className="p-8 text-center text-muted-foreground">
                          No hay pagos registrados
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
