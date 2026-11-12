import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface SectionHeaderProps {
  /** Título de la sección. Usa la escala `.text-title`. */
  title: React.ReactNode
  /** Línea de apoyo opcional bajo el título. */
  description?: React.ReactNode
  /** Acciones alineadas a la derecha (bajan bajo el título en mobile). */
  actions?: React.ReactNode
  /** Ícono opcional antes del título. */
  icon?: LucideIcon
  /** Nivel del encabezado. Por defecto h2 (la página ya tiene su h1). */
  as?: "h2" | "h3"
  /** id del encabezado, para `aria-labelledby` de la sección. */
  id?: string
  className?: string
}

/**
 * Encabezado de una sección dentro de una página: título + descripción
 * opcional + acciones. Reemplaza los `<h2 className="text-lg font-semibold">`
 * armados a mano y, junto con `Card variant="flat"`, permite separar bloques
 * por espacio en lugar de envolver todo en tarjetas.
 *
 *   <section aria-labelledby="comisiones">
 *     <SectionHeader id="comisiones" title="Comisiones" actions={<Button…/>} />
 *     …
 *   </section>
 */
export function SectionHeader({
  title,
  description,
  actions,
  icon: Icon,
  as: Heading = "h2",
  id,
  className,
}: SectionHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between",
        className
      )}
    >
      <div className="min-w-0 space-y-0.5">
        <Heading id={id} className="text-title flex items-center gap-2 text-balance">
          {Icon && (
            <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          {title}
        </Heading>
        {description && (
          <p className="text-pretty text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  )
}
