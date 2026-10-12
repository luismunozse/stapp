import { cn } from "@/lib/utils"

interface ChipsProps {
  /** Accessible name of the group, e.g. "Marcas sugeridas". */
  etiqueta: string
  opciones: string[]
  activa: (opcion: string) => boolean
  onElegir: (opcion: string) => void
}

/** Suggestion chips that fill a text input. They are not a selection control: the input stays editable. */
export function Chips({ etiqueta, opciones, activa, onElegir }: ChipsProps) {
  return (
    <div role="group" aria-label={etiqueta} className="flex flex-wrap gap-2 pt-1">
      {opciones.map((opcion) => {
        const encendida = activa(opcion)
        return (
          <button
            key={opcion}
            type="button"
            aria-pressed={encendida}
            onClick={() => onElegir(opcion)}
            className={cn(
              "inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-medium",
              "transition-[color,background-color,border-color,transform] duration-150 ease-snappy active:scale-[0.97]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "disabled:cursor-not-allowed disabled:opacity-50 [@media(pointer:coarse)]:min-h-11",
              encendida
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground [@media(hover:hover)]:hover:border-primary/50 [@media(hover:hover)]:hover:text-foreground"
            )}
          >
            {opcion}
          </button>
        )
      })}
    </div>
  )
}
