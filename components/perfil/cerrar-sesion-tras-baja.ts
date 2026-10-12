import { signOut } from "next-auth/react"
import { isNativePlatform } from "@/lib/capacitor"

/**
 * Cierra la sesión local después de eliminar el usuario o el taller. Mismo
 * circuito que el logout del navbar; el destino es /app-entry en la app nativa
 * y la landing en web (el subdominio del taller ya no existe o ya no te sirve).
 *
 * Siempre redirige: tras borrar el taller el middleware puede responder 403 a
 * /api/auth y signOut lanzar; la sesión ya no sirve igual.
 */
export async function cerrarSesionTrasBaja(): Promise<void> {
  try {
    const { clearPWATokens } = await import("@/components/auth/session-refresher")
    await clearPWATokens()
  } catch {
    // best effort: el signOut de abajo es lo que importa
  }
  try {
    await signOut({ redirect: false })
  } catch {
    // el tenant borrado puede dar 403; igual seguimos al redirect
  }

  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
  if (isNativePlatform()) {
    try {
      localStorage.removeItem("stapp-tenant-slug")
    } catch {
      // storage bloqueado
    }
    window.location.href = `https://${rootDomain}/app-entry`
  } else {
    window.location.href = `https://${rootDomain}/`
  }
}
