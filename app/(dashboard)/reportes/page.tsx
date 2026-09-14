import { auth } from "@/lib/auth"
import { resolveVendedoresVenIngresos } from "@/lib/auth-utils"
import { ReportesAvanzadosView } from "@/components/reportes-avanzados/reportes-avanzados-view"

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
 * El ADMIN no paga la consulta —el permiso no lo toca— y el TECNICO no llega
 * hasta acá: lo frena el middleware.
 */
export default async function ReportesPage() {
  const session = await auth()
  const esVendedor = session?.user?.role === "VENDEDOR"

  const verTopClientes = esVendedor
    ? await resolveVendedoresVenIngresos(session!.user.organizationId as string)
    : true

  return (
    <div className="container py-6">
      <ReportesAvanzadosView verTopClientes={verTopClientes} />
    </div>
  )
}
