import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ClipboardList, Users, Package, DollarSign } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { redirect } from "next/navigation"

export default async function DashboardPage() {
  const session = await auth()
  if (!session) {
    redirect("/login")
  }

  const [
    totalOrdenes,
    ordenesPendientes,
    totalClientes,
    itemsBajoStock,
    ingresosMensuales,
  ] = await Promise.all([
    prisma.ordenServicio.count(),
    prisma.ordenServicio.count({
      where: { estado: { in: ["PENDIENTE", "EN_REPARACION"] } },
    }),
    prisma.cliente.count(),
    prisma.inventario.count({
      where: { stock: { lt: 5 } },
    }),
    prisma.factura.aggregate({
      where: {
        fecha: {
          gte: new Date(new Date().setDate(1)),
        },
        estadoPago: "PAGADO",
      },
      _sum: {
        total: true,
      },
    }),
  ])

  const ingresos = ingresosMensuales._sum.total || 0

  const stats = [
    {
      title: "Órdenes Totales",
      value: totalOrdenes.toString(),
      description: `${ordenesPendientes} pendientes`,
      icon: ClipboardList,
      color: "text-blue-600",
      bgColor: "bg-blue-50",
    },
    {
      title: "Clientes",
      value: totalClientes.toString(),
      description: "Total registrados",
      icon: Users,
      color: "text-green-600",
      bgColor: "bg-green-50",
    },
    {
      title: "Bajo Stock",
      value: itemsBajoStock.toString(),
      description: "Items a reponer",
      icon: Package,
      color: "text-yellow-600",
      bgColor: "bg-yellow-50",
    },
    {
      title: "Ingresos del Mes",
      value: formatCurrency(ingresos),
      description: "Facturas pagadas",
      icon: DollarSign,
      color: "text-purple-600",
      bgColor: "bg-purple-50",
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">
          Bienvenido, {session.user?.name || "Usuario"}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <Card key={stat.title}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {stat.title}
                </CardTitle>
                <div className={`p-2 rounded-lg ${stat.bgColor}`}>
                  <Icon className={`h-4 w-4 ${stat.color}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {stat.description}
                </p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Órdenes Recientes</CardTitle>
            <CardDescription>Últimas órdenes de servicio</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Lista de órdenes recientes aparecerá aquí
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Alertas</CardTitle>
            <CardDescription>Notificaciones importantes</CardDescription>
          </CardHeader>
          <CardContent>
            {itemsBajoStock > 0 && (
              <div className="text-sm text-yellow-600">
                {itemsBajoStock} items con stock bajo
              </div>
            )}
            {ordenesPendientes > 0 && (
              <div className="text-sm text-blue-600 mt-2">
                {ordenesPendientes} órdenes pendientes
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

