import { Badge } from "@/components/ui/badge"

interface TipoPrecioBadgeProps {
  tipoPrecio?: string | null
  /**
   * Magnitud opcional. Identidad siempre gana sobre magnitud (REQ-17.5): un
   * cliente MAYORISTA con 0% activo sigue mostrando "Mayorista", nunca
   * "Mayorista −0%" — la etiqueta indica el tier, no el número.
   */
  descuentoPct?: number | null
  className?: string
}

export function TipoPrecioBadge({ tipoPrecio, descuentoPct, className }: TipoPrecioBadgeProps) {
  if (tipoPrecio !== "MAYORISTA") return null

  const magnitud = descuentoPct != null && descuentoPct > 0 ? ` −${descuentoPct}%` : ""

  return (
    <Badge variant="infoSoft" className={className}>
      Mayorista{magnitud}
    </Badge>
  )
}
