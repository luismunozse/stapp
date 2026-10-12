import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { ConfiguracionForm } from "@/components/configuracion/configuracion-form"
import { CookieSettings } from "@/components/cookie-settings"
import { canEditConfiguration } from "@/lib/auth-utils"
import { SecuritySettings } from "@/components/configuracion/security-settings"
import { SettingsNav } from "@/components/configuracion/settings-nav"
import { parseConfigTab } from "@/components/configuracion/config-tabs"
import { supabaseAdmin } from "@/lib/supabase"
import { PageShell } from "@/components/ui/page-shell"

interface ConfiguracionPageProps {
  searchParams: Promise<{ tab?: string | string[] }>
}

export default async function ConfiguracionPage({ searchParams }: ConfiguracionPageProps) {
  const session = await auth()

  if (!session) {
    redirect("/login")
  }

  if (session.user?.role !== "ADMIN") {
    redirect("/dashboard")
  }

  const allowEdit = await canEditConfiguration()

  // Obtener estado de 2FA del usuario
  const { data: userData } = await supabaseAdmin
    .from("users")
    .select("totp_enabled")
    .eq("id", session.user.id)
    .single()

  const totpEnabled = userData?.totp_enabled || false

  const { tab } = await searchParams

  return (
    <PageShell
      title="Configuración"
      description="Ajustes de tu taller: operación, finanzas, comunicación y sucursales"
    >
      {!allowEdit && (
        <div className="bg-yellow-50 dark:bg-yellow-950/50 border border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-300 px-4 py-3 rounded-lg">
          <p className="text-sm font-medium">Las cuentas demo no pueden editar la configuración</p>
        </div>
      )}

      <ConfiguracionForm
        allowEdit={allowEdit}
        initialTab={parseConfigTab(tab)}
        secciones={<SettingsNav />}
        seguridad={
          <>
            <SecuritySettings totpEnabled={totpEnabled} />
            <CookieSettings />
          </>
        }
      />
    </PageShell>
  )
}
