import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { canEditConfiguration } from "@/lib/auth-utils"
import { PageShell } from "@/components/ui/page-shell"
import { RolesPermisos } from "@/components/configuracion/roles-permisos"

/**
 * /configuracion/roles — quién es cada uno en el taller y qué puede hacer.
 *
 * El middleware ya cubre la ruta: `/configuracion` está en RUTAS_ADMIN y
 * `esRuta()` matchea por segmento, así que `/configuracion/roles` entra sola.
 * El redirect de acá es la segunda capa, igual que en /configuracion.
 */
export default async function RolesPermisosPage() {
  const session = await auth()

  if (!session) redirect("/login")
  if (session.user?.role !== "ADMIN") redirect("/dashboard")

  const allowEdit = await canEditConfiguration()

  return (
    <PageShell
      title="Roles y permisos"
      description="Quién es cada uno en el taller y qué puede hacer"
      backHref="/configuracion"
    >
      {!allowEdit && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950/50 dark:text-yellow-300">
          <p className="text-sm font-medium">
            Las cuentas demo no pueden cambiar roles ni permisos
          </p>
        </div>
      )}

      <RolesPermisos allowEdit={allowEdit} />
    </PageShell>
  )
}
