"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  ArrowLeft,
  Search,
  BookOpen,
  ClipboardList,
  Package,
  FileText,
  Users,
  ChevronDown,
  LayoutDashboard,
  Wrench,
  ShoppingCart,
  Receipt,
  Calculator,
  BarChart3,
  Settings,
  Smartphone,
  Shield,
  Menu,
  X,
  Store,
  Truck,
  Mail,
  Headset,
  Bot,
  CreditCard,
  Monitor,
  BookMarked,
} from "lucide-react"
import { manualSections, type Role, type ManualSection as ManualSectionData } from "@/lib/manual-content"

// ─── Types ───────────────────────────────────────────────────────────────────

interface ManualSection extends ManualSectionData {
  icon: React.ElementType
}

// ─── Data ────────────────────────────────────────────────────────────────────

const roleBadgeColors: Record<Role, string> = {
  ADMIN: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400",
  TECNICO: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
  VENDEDOR: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400",
}

const sectionIcons: Record<string, React.ElementType> = {
  "primeros-pasos": BookOpen,
  dashboard: LayoutDashboard,
  ordenes: ClipboardList,
  clientes: Users,
  tecnicos: Wrench,
  vendedores: Store,
  inventario: Package,
  ventas: ShoppingCart,
  pos: Monitor,
  cotizaciones: FileText,
  facturacion: Receipt,
  caja: Calculator,
  proveedores: Truck,
  garantias: Shield,
  reportes: BarChart3,
  emails: Mail,
  leads: Bot,
  soporte: Headset,
  configuracion: Settings,
  "app-movil": Smartphone,
  seguridad: Shield,
  glosario: BookMarked,
  suscripcion: CreditCard,
}

const sections: ManualSection[] = manualSections.map((s) => ({
  ...s,
  icon: sectionIcons[s.id] ?? BookOpen,
}))

const sectionsById = new Map(sections.map((s) => [s.id, s]))

// ─── Component ───────────────────────────────────────────────────────────────

export default function ManualPage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [activeSection, setActiveSection] = useState("primeros-pasos")
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(["primeros-pasos"])
  )
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [activeRole, setActiveRole] = useState<Role | null>(null)
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const scrollToSection = (id: string) => {
    setActiveSection(id)
    if (!expandedSections.has(id)) {
      setExpandedSections((prev) => new Set(prev).add(id))
    }
    setSidebarOpen(false)
    setTimeout(() => {
      sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 100)
  }

  // Filter sections based on search and role
  const filteredSections = sections
    .filter((s) => (activeRole ? s.roles.includes(activeRole) : true))
    .map((section) => {
      if (!searchQuery) return section
      const query = searchQuery.toLowerCase()
      const matchTitle = section.title.toLowerCase().includes(query)
      const matchContent = section.content.some(
        (c) =>
          c.subtitle.toLowerCase().includes(query) ||
          c.body.toLowerCase().includes(query) ||
          c.steps?.some((step) => step.toLowerCase().includes(query))
      )
      if (!matchTitle && !matchContent) return null
      if (matchTitle) return section
      return {
        ...section,
        content: section.content.filter(
          (c) =>
            c.subtitle.toLowerCase().includes(query) ||
            c.body.toLowerCase().includes(query) ||
            c.steps?.some((step) => step.toLowerCase().includes(query))
        ),
      }
    })
    .filter(Boolean) as ManualSection[]

  // Expand all matching sections when search query changes
  const expandMatchingSections = useCallback(() => {
    if (searchQuery) {
      const ids = sections
        .filter((s) => (activeRole ? s.roles.includes(activeRole) : true))
        .filter((section) => {
          const query = searchQuery.toLowerCase()
          return (
            section.title.toLowerCase().includes(query) ||
            section.content.some(
              (c) =>
                c.subtitle.toLowerCase().includes(query) ||
                c.body.toLowerCase().includes(query) ||
                c.steps?.some((step) => step.toLowerCase().includes(query))
            )
          )
        })
        .map((s) => s.id)
      setExpandedSections(new Set(ids))
    }
  }, [searchQuery, activeRole])

  useEffect(() => {
    expandMatchingSections() // eslint-disable-line react-hooks/set-state-in-effect -- expanding sections on search is intentional
  }, [expandMatchingSections])

  return (
    <div className="min-h-dvh bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="lg:hidden p-2 hover:bg-muted rounded-md"
              >
                {sidebarOpen ? (
                  <X className="h-5 w-5" />
                ) : (
                  <Menu className="h-5 w-5" />
                )}
              </button>
              <Link href="/ayuda">
                <Button variant="ghost" size="sm" className="gap-2">
                  <ArrowLeft className="h-4 w-4" />
                  <span className="hidden sm:inline">Centro de Ayuda</span>
                </Button>
              </Link>
              <div className="hidden sm:block h-6 w-px bg-border" />
              <h1 className="text-lg font-bold text-foreground">
                Manual de Uso
              </h1>
            </div>

            {/* Search */}
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Buscar en el manual..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 text-sm"
              />
            </div>
          </div>

          {/* Role filter */}
          <div className="flex items-center gap-2 mt-3 pb-1 overflow-x-auto">
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              Filtrar por rol:
            </span>
            <button
              type="button"
              onClick={() => setActiveRole(null)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                !activeRole
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              Todos
            </button>
            {(["ADMIN", "TECNICO", "VENDEDOR"] as Role[]).map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => setActiveRole(activeRole === role ? null : role)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  activeRole === role
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {role === "TECNICO"
                  ? "Técnico"
                  : role === "VENDEDOR"
                    ? "Vendedor"
                    : "Administrador"}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex gap-4 md:gap-8 relative">
          {/* Sidebar - Desktop */}
          <aside className="hidden lg:block w-64 shrink-0">
            <nav className="sticky top-36 py-6 max-h-[calc(100dvh-9rem)] overflow-y-auto">
              <ul className="space-y-1">
                {filteredSections.map((section) => (
                  <li key={section.id}>
                    <button
                      type="button"
                      onClick={() => scrollToSection(section.id)}
                      className={`flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-sm transition-colors ${
                        activeSection === section.id
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      <section.icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{section.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>

          {/* Sidebar - Mobile */}
          {sidebarOpen && (
            <div className="fixed inset-0 z-40 lg:hidden">
              <div
                className="fixed inset-0 bg-black/50"
                onClick={() => setSidebarOpen(false)}
              />
              <aside className="fixed left-0 top-0 bottom-0 w-72 bg-card border-r shadow-xl z-50 overflow-y-auto pt-20 px-4 pb-6">
                <ul className="space-y-1">
                  {filteredSections.map((section) => (
                    <li key={section.id}>
                      <button
                        type="button"
                        onClick={() => scrollToSection(section.id)}
                        className={`flex items-center gap-2.5 w-full px-3 py-2.5 rounded-md text-sm transition-colors ${
                          activeSection === section.id
                            ? "bg-primary/10 text-primary font-medium"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                      >
                        <section.icon className="h-4 w-4 shrink-0" />
                        <span>{section.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </aside>
            </div>
          )}

          {/* Main Content */}
          <main className="flex-1 min-w-0 py-6 pb-20">
            {filteredSections.length === 0 ? (
              <div className="text-center py-20">
                <Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">
                  No se encontraron resultados
                </h3>
                <p className="text-muted-foreground">
                  Probá con otros términos o cambiá el filtro de rol.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredSections.map((section) => {
                  const isExpanded = expandedSections.has(section.id)
                  return (
                    <div
                      key={section.id}
                      ref={(el) => { sectionRefs.current[section.id] = el }}
                      className="scroll-mt-36"
                    >
                      <Card>
                        <button
                          type="button"
                          onClick={() => {
                            toggleSection(section.id)
                            setActiveSection(section.id)
                          }}
                          className="flex items-center justify-between w-full px-6 py-4 text-left hover:bg-muted/30 transition-colors rounded-t-lg"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                              <section.icon className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                              <h2 className="text-lg font-semibold text-foreground">
                                {section.title}
                              </h2>
                              <div className="flex gap-1.5 mt-1">
                                {section.roles.map((role) => (
                                  <span
                                    key={role}
                                    className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium ${roleBadgeColors[role]}`}
                                  >
                                    {role === "TECNICO" ? "TÉCNICO" : role}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                          <ChevronDown
                            className={`h-5 w-5 text-muted-foreground transition-transform duration-200 ${
                              isExpanded ? "rotate-180" : ""
                            }`}
                          />
                        </button>

                        {isExpanded && (
                          <CardContent className="px-6 pb-6 pt-0">
                            <div className="border-t pt-4 space-y-6">
                              {section.content
                                .filter((block) =>
                                  block.roles
                                    ? activeRole
                                      ? block.roles.includes(activeRole)
                                      : true
                                    : true
                                )
                                .map((block, i) => (
                                  <div key={i}>
                                    <h3 className="text-base font-semibold text-foreground mb-2">
                                      {block.subtitle}
                                    </h3>
                                    <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                                      {block.body}
                                    </p>

                                    {block.steps && (
                                      <ol className="space-y-2 ml-1">
                                        {block.steps.map((step, j) => (
                                          <li
                                            key={j}
                                            className="flex gap-3 text-sm"
                                          >
                                            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center mt-0.5">
                                              {j + 1}
                                            </span>
                                            <span className="text-muted-foreground leading-relaxed">
                                              {step}
                                            </span>
                                          </li>
                                        ))}
                                      </ol>
                                    )}

                                    {block.tip && (
                                      <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg">
                                        <p className="text-sm text-amber-800 dark:text-amber-300">
                                          <span className="font-semibold">
                                            Consejo:{" "}
                                          </span>
                                          {block.tip}
                                        </p>
                                      </div>
                                    )}

                                    {block.roles && (
                                      <div className="flex gap-1.5 mt-3">
                                        {block.roles.map((role) => (
                                          <span
                                            key={role}
                                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium ${roleBadgeColors[role]}`}
                                          >
                                            {role === "TECNICO"
                                              ? "TÉCNICO"
                                              : role}
                                          </span>
                                        ))}
                                      </div>
                                    )}

                                    {block.seeAlso && block.seeAlso.length > 0 && (
                                      <div className="flex flex-wrap items-center gap-1.5 mt-3">
                                        <span className="text-xs text-muted-foreground mr-1">
                                          Ver también:
                                        </span>
                                        {block.seeAlso.map((id) => {
                                          const target = sectionsById.get(id)
                                          if (!target) return null
                                          const Icon = target.icon
                                          return (
                                            <button
                                              key={id}
                                              type="button"
                                              onClick={() => scrollToSection(id)}
                                              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs bg-muted hover:bg-primary/10 hover:text-primary transition-colors border"
                                            >
                                              <Icon className="h-3 w-3" />
                                              {target.title}
                                            </button>
                                          )
                                        })}
                                      </div>
                                    )}
                                  </div>
                                ))}
                            </div>
                          </CardContent>
                        )}
                      </Card>
                    </div>
                  )
                })}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}
