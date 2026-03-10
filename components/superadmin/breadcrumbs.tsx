"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronRight, Home } from "lucide-react"

const segmentLabels: Record<string, string> = {
  dashboard: "Dashboard",
  organizaciones: "Organizaciones",
  suscripciones: "Suscripciones",
  pagos: "Pagos",
  planes: "Planes",
  soporte: "Soporte",
  waitlist: "Waitlist iOS",
  logs: "Auditoría",
  nuevo: "Nuevo",
  historial: "Historial",
}

function getLabel(segment: string): string {
  if (segmentLabels[segment]) return segmentLabels[segment]
  // Dynamic segments like UUIDs or IDs
  if (segment.match(/^[0-9a-fA-F-]{8,}$/) || segment.match(/^\d+$/)) {
    return "Detalle"
  }
  return segment.charAt(0).toUpperCase() + segment.slice(1)
}

export function Breadcrumbs() {
  const pathname = usePathname()

  // Remove /superadmin prefix and split
  const fullSegments = pathname.split("/").filter(Boolean)
  const superadminIndex = fullSegments.indexOf("superadmin")
  if (superadminIndex === -1) return null

  const segments = fullSegments.slice(superadminIndex + 1)

  // Don't show breadcrumbs on the dashboard root
  if (segments.length === 0 || (segments.length === 1 && segments[0] === "dashboard")) {
    return null
  }

  const crumbs = segments.map((segment, index) => {
    const href = "/superadmin/" + segments.slice(0, index + 1).join("/")
    const label = getLabel(segment)
    const isLast = index === segments.length - 1

    return { href, label, isLast }
  })

  return (
    <nav aria-label="Breadcrumbs" className="flex items-center gap-1 text-sm mb-4">
      <Link
        href="/superadmin/dashboard"
        className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
      >
        <Home className="h-4 w-4" />
        <span>Dashboard</span>
      </Link>
      {crumbs.map((crumb) => (
        <span key={crumb.href} className="flex items-center gap-1">
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          {crumb.isLast ? (
            <span className="font-medium">{crumb.label}</span>
          ) : (
            <Link
              href={crumb.href}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  )
}
