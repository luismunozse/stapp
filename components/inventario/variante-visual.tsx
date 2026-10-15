import { Package } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { Inventario } from "@/types"

// What the inventory list draws for a variant: the chip with its combination and the effective photo
// (own, else a dimmed one borrowed from a sibling, else the placeholder).

/** The combination of a grouped product ("Azul / M"). Nothing for a standalone product. */
export function ChipVariante({ item }: { item: Pick<Inventario, "grupoId" | "etiqueta"> }) {
  if (!item.grupoId || !item.etiqueta) return null
  return (
    <Badge data-testid="chip-variante" variant="secondary" className="h-4 shrink-0 px-1.5 text-[10px] font-normal">
      {item.etiqueta}
    </Badge>
  )
}

/**
 * The photo that fills the thumbnail box of its parent. Own photo first; otherwise the photo of a sibling,
 * dimmed and announced as "Foto de {etiqueta}" so nobody takes it for this product's own; otherwise the icon.
 */
export function FotoInventario({
  item,
  iconClassName,
}: {
  item: Pick<Inventario, "nombre" | "imagenUrl" | "imagenRespaldo">
  iconClassName: string
}) {
  if (item.imagenUrl) {
    return <img src={item.imagenUrl} alt={item.nombre} className="h-full w-full object-cover" loading="lazy" />
  }
  if (item.imagenRespaldo?.url) {
    return (
      <>
        <img src={item.imagenRespaldo.url} alt="" className="h-full w-full object-cover opacity-60" loading="lazy" />
        <span className="sr-only">Foto de {item.imagenRespaldo.etiqueta}</span>
      </>
    )
  }
  return <Package className={iconClassName} />
}
