import { auth } from "@/lib/auth"
import { resolveVendedoresVenIngresos } from "@/lib/auth-utils"
import { hasPlanFeature } from "@/lib/subscriptions"
import { ReportesAvanzadosView } from "@/components/reportes-avanzados/reportes-avanzados-view"

export const dynamic = "force-dynamic"

/**
 * La pestaña "Clientes" (Top clientes) muestra cuánto gastó cada cliente, así
 * que queda detrás de `vendedores_ven_ingresos` (migración 326) igual que el
 * resto de los reportes de ingresos.
 *
 * Se resuelve acá, en el server, y baja como prop: la vista es un componente
 * cliente y pedirle que lea la sesión y consulte /api/org/features la ataría a
 * un <SessionProvider> y haría aparecer y desaparecer la pestaña. Además sale
 * del mismo resolver que usa requireIngresosAccess(), que es fail-open: ante
 * una columna sin migrar o una lectura fallida, el vendedor sigue viendo.
 *
 * Lo mismo con `reportesAvanzados`: las pestañas de tiempos, retorno, fallas,
 * rentabilidad y predicción son del plan Profesional (`advanced_reports`, el
 * mismo chequeo que hacen sus APIs). Técnicos, Vendedores, Clientes e
 * Inventario no lo piden, así que la página no se cierra entera: se bloquea
 * pestaña por pestaña. Si la lectura del plan falla se deja pasar: la API
 * decide igual y el gráfico reconoce su 403 FEATURE_REQUIRED.
 *
 * El ADMIN no paga la consulta de ingresos —el permiso no lo toca— y el
 * TECNICO no llega hasta acá: lo frena el middleware.
 */
export default async function ReportesPage() {
  const session = await auth()
  const esVendedor = session?.user?.role === "VENDEDOR"
  const organizationId = session?.user?.organizationId as string | undefined

  const [verTopClientes, reportesAvanzados] = await Promise.all([
    esVendedor ? resolveVendedoresVenIngresos(organizationId as string) : Promise.resolve(true),
    organizationId
      ? hasPlanFeature(organizationId, "advanced_reports").catch(() => true)
      : Promise.resolve(true),
  ])

  return (
    <div className="container py-6">
      <ReportesAvanzadosView verTopClientes={verTopClientes} reportesAvanzados={reportesAvanzados} />
    </div>
  )
}
