import type { ReactNode } from "react"
import { AuthPhotoRotator } from "@/components/auth/auth-photo-rotator"
import { ClipboardList, Package, MessageCircle } from "lucide-react"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { STAppLogo } from "@/components/shared/stapp-logo"

const BENEFICIOS = [
  { icon: ClipboardList, texto: "Órdenes de reparación con seguimiento de punta a punta" },
  { icon: Package, texto: "Inventario, ventas y caja en un solo lugar" },
  { icon: MessageCircle, texto: "Avisos automáticos a tus clientes por WhatsApp" },
]

/**
 * Esqueleto de las pantallas de acceso: panel con foto a la izquierda (solo
 * desde `lg`) y el contenido a la derecha. En móvil queda solo el contenido:
 * la foto no aporta en la PWA/app nativa y le resta espacio al formulario.
 *
 * Las fotos se alternan con un fundido (ver AuthPhotoRotator).
 */
export function AuthSplitLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] bg-background">
      <aside className="relative hidden lg:block overflow-hidden bg-slate-950">
        <AuthPhotoRotator />
        {/* Degradado para que el texto se lea sobre cualquiera de las fotos */}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/95 via-slate-950/40 to-transparent" />
        {/* …y para el logo de arriba, que en fotos claras queda sin contraste */}
        <div className="absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-slate-950/60 to-transparent" />

        <div className="relative z-10 flex h-full flex-col justify-between p-10 xl:p-14 text-white">
          <div className="flex items-center gap-2">
            <STAppLogo size="md" showText={false} />
            <span className="text-xl font-bold tracking-tight">STApp</span>
          </div>

          <div className="max-w-lg space-y-6">
            <h2 className="text-4xl xl:text-5xl font-bold leading-tight tracking-tight text-balance">
              Tu taller, en orden.
            </h2>
            <ul className="space-y-3">
              {BENEFICIOS.map(({ icon: Icon, texto }) => (
                <li key={texto} className="flex items-start gap-3 text-white/85">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15 backdrop-blur-sm">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="leading-relaxed">{texto}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>

      <main className="relative flex items-center justify-center px-4 py-12 sm:px-8 bg-muted/30 dark:bg-background lg:bg-background">
        <div className="absolute top-4 right-4">
          <ThemeToggle variant="icon" />
        </div>
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  )
}
