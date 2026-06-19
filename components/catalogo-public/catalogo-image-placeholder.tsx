import { ImageOff } from "lucide-react"

interface Props {
  /** Nombre del item o categoría — su primera letra alfanumérica es el monograma. */
  name: string
  /** Clases del contenedor (aspect, rounding, etc. las pone el caller). */
  className?: string
}

function monogram(name: string): string | null {
  const m = name.match(/[a-z0-9]/i)
  return m ? m[0].toUpperCase() : null
}

/**
 * Placeholder de imagen para items/categorías sin foto: monograma sobre un tinte
 * del brand color (vía las CSS vars `--brand-tint` / `--brand`), escalable a
 * cualquier tamaño gracias al `<text>` SVG con viewBox. Reemplaza los emojis.
 */
export function CatalogoImagePlaceholder({ name, className }: Props) {
  const letter = monogram(name)
  return (
    <div
      className={`flex items-center justify-center overflow-hidden ${className ?? ""}`}
      style={{ backgroundColor: "var(--brand-tint, #f1f5f9)" }}
      aria-hidden="true"
    >
      {letter ? (
        <svg viewBox="0 0 100 100" className="h-3/5 w-3/5" role="presentation">
          <text
            x="50"
            y="50"
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="60"
            fontWeight="700"
            fill="var(--brand, #64748b)"
          >
            {letter}
          </text>
        </svg>
      ) : (
        <ImageOff className="h-1/4 w-1/4 text-muted-foreground" />
      )}
    </div>
  )
}
