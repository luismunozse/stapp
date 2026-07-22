import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"

interface BlogCtaProps {
  // "inline" = banda liviana insertada a mitad de artículo.
  // "block" = tarjeta destacada de cierre.
  variant?: "inline" | "block"
  title?: string
  description?: string
}

// CTA de conversión para los artículos del blog. El lector del blog es
// top-of-funnel: llegó por SEO, todavía no conoce el producto. El copy
// vende el resultado, no la función, igual que la landing.
export function BlogCta({
  variant = "block",
  title = "Ordená tu taller sin cambiar cómo trabajás",
  description = "STApp registra tus reparaciones, avisa a tus clientes por WhatsApp y te muestra cuánto ganás. Probalo gratis 30 días, sin tarjeta.",
}: BlogCtaProps) {
  if (variant === "inline") {
    return (
      <div className="my-10 flex flex-col gap-4 rounded-xl border border-primary/20 bg-primary/5 p-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-base font-medium text-foreground">
          ¿Querés aplicar esto en tu taller sin planillas?
        </p>
        <Link href="/registro?plan=profesional" className="shrink-0">
          <Button className="group w-full rounded-full sm:w-auto">
            Probar gratis
            <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="mt-12 rounded-2xl border border-primary/20 bg-primary/5 p-8 text-center">
      <h3 className="text-xl font-bold text-foreground sm:text-2xl">{title}</h3>
      <p className="mx-auto mt-3 max-w-md text-muted-foreground">{description}</p>
      <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Link href="/registro?plan=profesional">
          <Button size="lg" className="group rounded-full px-8">
            Probar gratis
            <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
          </Button>
        </Link>
        <Link href="/precios">
          <Button size="lg" variant="outline" className="rounded-full px-6">
            Ver planes
          </Button>
        </Link>
      </div>
    </div>
  )
}
