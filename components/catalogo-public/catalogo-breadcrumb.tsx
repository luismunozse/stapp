import Link from "next/link"
import { ChevronRight } from "lucide-react"

export interface Crumb {
  label: string
  href?: string
}

export function CatalogoBreadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav
      aria-label="Migas de pan"
      className="container mx-auto max-w-6xl px-4 pt-4"
    >
      <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        {items.map((it, i) => {
          const last = i === items.length - 1
          return (
            <li key={i} className="inline-flex items-center gap-1 min-w-0">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" />}
              {it.href && !last ? (
                <Link
                  href={it.href}
                  className="hover:text-foreground transition-colors truncate max-w-[140px] sm:max-w-none"
                >
                  {it.label}
                </Link>
              ) : (
                <span
                  className={`truncate max-w-[180px] sm:max-w-none ${
                    last ? "text-foreground font-medium" : ""
                  }`}
                  aria-current={last ? "page" : undefined}
                >
                  {it.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
