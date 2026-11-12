import type { ReactNode } from "react"
import { BusinessLogo } from "@/components/shared/business-logo"
import { cn } from "@/lib/utils"

const TONOS = {
  success: "bg-success/10 text-success-text",
  error: "bg-destructive/10 text-destructive-text",
  info: "bg-primary/10 text-primary",
} as const

/**
 * Encabezado de las pantallas de acceso (dentro de AuthSplitLayout): el logo
 * —o un ícono de estado, para pantallas de resultado— más título y bajada.
 * Centrado en móvil, alineado a la izquierda junto al panel de fotos.
 */
export function AuthHeader({
  title,
  description,
  icon,
  tone = "info",
}: {
  title: ReactNode
  description?: ReactNode
  /** Reemplaza al logo; p. ej. un check en "Contraseña actualizada" */
  icon?: ReactNode
  tone?: keyof typeof TONOS
}) {
  return (
    <div className="space-y-6">
      <div className="flex justify-center lg:justify-start">
        {icon ? (
          <span
            className={cn(
              "flex h-14 w-14 items-center justify-center rounded-2xl [&_svg]:h-7 [&_svg]:w-7",
              TONOS[tone],
            )}
          >
            {icon}
          </span>
        ) : (
          <BusinessLogo size="xl" showText={false} />
        )}
      </div>
      <div className="space-y-1.5 text-center lg:text-left">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <div className="text-sm text-muted-foreground">{description}</div>}
      </div>
    </div>
  )
}
