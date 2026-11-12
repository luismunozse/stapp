"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut, useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import {
  LogOut,
  MoreHorizontal,
  HelpCircle,
  User,
  PanelLeft,
  ChevronsLeft,
  BookOpen,
  ChevronDown,
  CreditCard,
} from "lucide-react"
import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { cn } from "@/lib/utils"
import { BusinessLogo } from "@/components/shared/business-logo"
import { useFocusTrap } from "@/hooks/use-focus-trap"
import { useEscapeKey } from "@/hooks/use-escape-key"
import { isNativePlatform } from "@/lib/capacitor"
import { ApkDownloadBanner } from "@/components/shared/apk-download-banner"
import { GlobalSearch } from "@/components/shared/global-search"
import { CommandPaletteTrigger } from "@/components/shared/command-palette-trigger"
import { NotificationBell } from "@/components/notifications/notification-bell"
import { useSidebar } from "@/components/layout/sidebar-context"
import { SucursalSwitcher } from "@/components/layout/sucursal-switcher"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { UserAvatar } from "@/components/shared/user-avatar"
import { DeadlineCalendar } from "@/components/ordenes/deadline-calendar"
import { PlanBadge } from "@/components/billing/plan-badge"
import { AsistenteNavButton } from "@/components/asistente/asistente-nav-button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
  ORG_FEATURES_APAGADAS,
  accionesVisibles,
  bottomNavItems,
  esRutaActiva,
  seccionesVisibles,
  type OrgFeatures,
} from "@/lib/navegacion"

/** La suscripción a STApp. Solo el ADMIN la gestiona (la ruta es admin-only). */
const MI_PLAN_HREF = "/configuracion/billing"

export function Navbar() {
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const { data: session } = useSession()
  const userRole = session?.user?.role || ""
  const isAdmin = userRole === "ADMIN"
  const menuRef = useRef<HTMLDivElement>(null)
  const { collapsed, toggle } = useSidebar()

  // El nombre y avatar los leemos directo del API en vez de session.user,
  // porque NextAuth v5 beta no refresca confiablemente useSession() después
  // de un update(). Acá nos aseguramos de mostrar siempre el valor actual
  // de la BD. Refrescamos en mount, en focus y al recibir un evento custom
  // disparado desde /perfil después de un cambio.
  const [liveName, setLiveName] = useState<string | null>(null)
  const [liveAvatar, setLiveAvatar] = useState<string | null>(null)
  const [orgFeatures, setOrgFeatures] = useState<OrgFeatures>(ORG_FEATURES_APAGADAS)

  useEffect(() => {
    let cancelled = false
    const loadFeatures = () => {
      fetch("/api/org/features", { cache: "no-store" })
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (cancelled || !d) return
          setOrgFeatures({
            moduloAgenda: !!d.moduloAgenda,
            vendedoresAdministranInventario: !!d.vendedoresAdministranInventario,
            tecnicosOperanPos: !!d.tecnicosOperanPos,
            vendedoresManejanCaja: !!d.vendedoresManejanCaja,
          })
        })
        .catch(() => {})
    }
    loadFeatures()
    const onUpdated = () => loadFeatures()
    window.addEventListener("stapp:org-features-updated", onUpdated)
    return () => {
      cancelled = true
      window.removeEventListener("stapp:org-features-updated", onUpdated)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const fetchProfile = async () => {
      try {
        const res = await fetch("/api/users/profile", { cache: "no-store" })
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        setLiveName(data.nombre || null)
        setLiveAvatar(data.avatarUrl || null)
      } catch {
        // Silencioso: si falla, caemos al fallback de session.user.name
      }
    }
    fetchProfile()
    const onFocus = () => fetchProfile()
    const onProfileUpdate = () => fetchProfile()
    window.addEventListener("focus", onFocus)
    window.addEventListener("stapp:profile-updated", onProfileUpdate)
    return () => {
      cancelled = true
      window.removeEventListener("focus", onFocus)
      window.removeEventListener("stapp:profile-updated", onProfileUpdate)
    }
  }, [])

  const displayName = liveName ?? session?.user?.name ?? null
  const displayAvatar = liveAvatar ?? session?.user?.avatar ?? null

  // Hooks de accesibilidad para menú móvil
  useFocusTrap(menuRef, mobileMenuOpen)
  useEscapeKey(() => setMobileMenuOpen(false), mobileMenuOpen)

  // Prevenir scroll cuando el menú está abierto
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileMenuOpen])

  // Todo sale de lib/navegacion: sidebar, menú mobile, barra inferior y paleta.
  const filteredSections = useMemo(() => seccionesVisibles(userRole, orgFeatures), [userRole, orgFeatures])
  const allNavItems = useMemo(() => filteredSections.flatMap((section) => section.items), [filteredSections])
  const acciones = useMemo(() => accionesVisibles(userRole, orgFeatures), [userRole, orgFeatures])

  // Collapsible sections state - persisted in localStorage
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const saved = localStorage.getItem("stapp-sidebar-sections")
      if (saved) setCollapsedSections(JSON.parse(saved))
    } catch {}
  }, [])

  const toggleSection = useCallback((label: string) => {
    setCollapsedSections(prev => {
      const next = { ...prev, [label]: !prev[label] }
      try { localStorage.setItem("stapp-sidebar-sections", JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

  // Logout que redirige al login del mismo dominio/subdominio
  // Keep cleanup steps in sync with components/perfil/cerrar-sesion-tras-baja.ts
  const handleLogout = async () => {
    const { clearPWATokens } = await import("@/components/auth/session-refresher")
    await clearPWATokens()
    await signOut({ redirect: false })
    if (isNativePlatform()) {
      // En la app nativa, volver a la pantalla de seleccion de empresa
      localStorage.removeItem("stapp-tenant-slug")
      const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
      window.location.href = `https://${rootDomain}/app-entry`
    } else {
      window.location.href = "/login"
    }
  }

  const filteredBottomNavItems = bottomNavItems(userRole, orgFeatures)

  // Items que no están en el bottom nav (para el menú "Más")
  const moreItems = allNavItems.filter(
    item => !filteredBottomNavItems.some(bottomItem => bottomItem.href === item.href)
  )

  // Verificar si algún item de "más" está activo
  const isMoreActive = moreItems.some(item => esRutaActiva(pathname, item.href))

  return (
    <>
      {/* Paleta de comandos: un solo montaje (y un solo Ctrl/Cmd+K) para
          escritorio y mobile. Los disparadores de cada barra solo la abren. */}
      <GlobalSearch navItems={allNavItems} acciones={acciones} />

      {/* Desktop Sidebar */}
      <aside
        className={cn(
          "hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:border-r border-sidebar-border bg-sidebar transition-all duration-300 ease-in-out z-30",
          collapsed ? "lg:w-14" : "lg:w-64"
        )}
      >
        <div className="flex flex-col flex-1 min-h-0">
          {/* Header con logo y botón toggle */}
          <div className={cn(
            "flex items-center border-b border-sidebar-border transition-all duration-300",
            collapsed ? "justify-center px-2 py-4" : "justify-between px-6 py-4"
          )}>
            <Link href="/dashboard" className="hover:opacity-80 active:opacity-60 transition-opacity overflow-hidden">
              <BusinessLogo size="sm" showText={!collapsed} textClassName="text-xl" />
            </Link>
            {!collapsed && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent shrink-0"
                onClick={toggle}
                aria-label="Colapsar sidebar"
                title="Colapsar sidebar (Ctrl+B)"
              >
                <ChevronsLeft className="h-4 w-4" />
              </Button>
            )}
          </div>

          {/* Botón para expandir cuando está colapsado */}
          {collapsed && (
            <div className="flex justify-center py-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent"
                onClick={toggle}
                aria-label="Expandir sidebar"
                title="Expandir sidebar (Ctrl+B)"
              >
                <PanelLeft className="h-4 w-4" />
              </Button>
            </div>
          )}

          {/* Navigation */}
          <TooltipProvider delayDuration={0}>
            <nav className={cn(
              "flex-1 py-4 overflow-y-auto scrollbar-thin transition-all duration-300",
              collapsed ? "px-2 space-y-1" : "px-3 space-y-0.5"
            )}>
              {filteredSections.map((section) => {
                const userCollapsed = section.label ? !!collapsedSections[section.label] : false
                const hasActiveChild = section.items.some(
                  item => esRutaActiva(pathname, item.href)
                )
                // Auto-expand when section contains the active route, even if user collapsed it
                const isSectionCollapsed = userCollapsed && !hasActiveChild

                return (
                  <div key={section.label || "_top"} className={section.label ? "mt-4 first:mt-0" : ""}>
                    {/* Section header */}
                    {section.label && !collapsed && (
                      <button
                        onClick={() => toggleSection(section.label)}
                        className={cn(
                          "flex items-center justify-between w-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] rounded-md transition-colors",
                          hasActiveChild
                            ? "text-primary/90"
                            : "text-sidebar-foreground/55 hover:text-sidebar-foreground/85"
                        )}
                      >
                        <span>{section.label}</span>
                        <ChevronDown className={cn(
                          "h-3 w-3 transition-transform duration-200 opacity-70",
                          isSectionCollapsed && "-rotate-90"
                        )} />
                      </button>
                    )}

                    {/* Section items - animated collapse */}
                    <div
                      className={cn(
                        "space-y-0.5 overflow-hidden transition-all duration-300 ease-in-out",
                        isSectionCollapsed && !collapsed && section.label
                          ? "max-h-0 opacity-0"
                          : "max-h-[500px] opacity-100"
                      )}
                    >
                      <div className="space-y-0.5">
                        {section.items.map((item) => {
                          const Icon = item.icon
                          const isActive = esRutaActiva(pathname, item.href)

                          const linkContent = (
                            <Link
                              key={item.href}
                              id={`nav-${item.href.replace("/", "")}`}
                              href={item.href}
                              className={cn(
                                "relative flex items-center text-sm font-medium rounded-lg transition-colors duration-150",
                                collapsed ? "justify-center px-2 py-2" : "px-3 py-2",
                                isActive
                                  ? "bg-primary/10 text-primary font-semibold before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-5 before:w-1 before:rounded-r-full before:bg-primary"
                                  : "text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:bg-sidebar-accent/80 active:scale-[0.98] transition-transform"
                              )}
                            >
                              <Icon className={cn(
                                "h-5 w-5 shrink-0",
                                !collapsed && "mr-3",
                                isActive ? "text-primary" : "text-sidebar-foreground/70"
                              )} />
                              {!collapsed && (
                                <span className="truncate">{item.label}</span>
                              )}
                            </Link>
                          )

                          if (collapsed) {
                            return (
                              <Tooltip key={item.href}>
                                <TooltipTrigger asChild>
                                  {linkContent}
                                </TooltipTrigger>
                                <TooltipContent side="right" sideOffset={8}>
                                  {item.label}
                                </TooltipContent>
                              </Tooltip>
                            )
                          }

                          return <div key={item.href}>{linkContent}</div>
                        })}
                      </div>
                    </div>
                  </div>
                )
              })}
            </nav>
          </TooltipProvider>

          {!collapsed && <ApkDownloadBanner variant="sidebar" />}
        </div>
      </aside>

      {/* Desktop Top-Right Bar */}
      <div className={cn(
        "hidden lg:flex items-center gap-1.5 fixed top-3 right-4 z-40",
        "bg-background/85 backdrop-blur-md border border-border/60 rounded-full shadow-sm",
        "px-2 py-1"
      )}>
        <PlanBadge />
        <AsistenteNavButton variant="pill" />
        <CommandPaletteTrigger variant="pill" />
        <DeadlineCalendar />
        <SucursalSwitcher />
        <NotificationBell />
        <ThemeToggle variant="icon" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button aria-label="Menú de tu cuenta" className="hover:opacity-80 transition-opacity rounded-full focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2">
              <UserAvatar
                src={displayAvatar}
                nombre={displayName}
                size="sm"
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="px-3 py-2">
              <p className="text-sm font-medium truncate">{displayName}</p>
              <p className="text-xs text-muted-foreground truncate">{session?.user?.role}</p>
            </div>
            <DropdownMenuSeparator />
            <Link href="/perfil">
              <DropdownMenuItem className="cursor-pointer">
                <User className="mr-2 h-4 w-4" />
                Mi perfil
              </DropdownMenuItem>
            </Link>
            {isAdmin && (
              <Link href={MI_PLAN_HREF}>
                <DropdownMenuItem className="cursor-pointer">
                  <CreditCard className="mr-2 h-4 w-4" />
                  Mi plan
                </DropdownMenuItem>
              </Link>
            )}
            <Link href="/ayuda/manual">
              <DropdownMenuItem className="cursor-pointer">
                <BookOpen className="mr-2 h-4 w-4" />
                Manual de uso
              </DropdownMenuItem>
            </Link>
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() => window.dispatchEvent(new Event("start-tour"))}
            >
              <HelpCircle className="mr-2 h-4 w-4" />
              Tour guiado
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer text-destructive-text focus:text-destructive-text"
              onClick={handleLogout}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Cerrar Sesión
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Mobile Header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border safe-area-inset-top">
        <div className="flex items-center justify-between h-14 pl-4 pr-2 gap-2">
          <Link href="/dashboard" className="hover:opacity-80 transition-opacity min-w-0 flex-shrink overflow-hidden">
            <BusinessLogo size="sm" showText={true} textClassName="text-base truncate" />
          </Link>
          <div className="flex items-center gap-1 flex-shrink-0">
            <AsistenteNavButton variant="icon" />
            <CommandPaletteTrigger variant="icon" />
            <NotificationBell />
            <DeadlineCalendar />
            <ThemeToggle variant="icon" />
            <button
              data-touch-icon=""
              className="inline-flex items-center justify-center h-11 w-11 rounded-full active:bg-accent/60 focus:outline-none focus:ring-2 focus:ring-primary"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={mobileMenuOpen ? "Cerrar menú" : "Abrir menú"}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-menu-drawer"
            >
              <UserAvatar src={displayAvatar} nombre={displayName} size="sm" />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      <div
        className={cn(
          "lg:hidden fixed inset-0 z-40 bg-black/50 transition-opacity duration-200",
          mobileMenuOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={() => setMobileMenuOpen(false)}
        aria-hidden="true"
      />

      {/* Mobile Menu Drawer */}
      <div
        id="mobile-menu-drawer"
        ref={menuRef}
        className={cn(
          // Ends above the fixed bottom-nav (z-50): anything the drawer paints
          // inside that band is covered by it and swallows the tap, which left
          // the footer's logout button unreachable on mobile.
          "lg:hidden fixed top-0 right-0 bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] z-40 w-[min(18rem,85vw)] bg-background shadow-xl transition-transform duration-200 ease-out",
          mobileMenuOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        <div className="flex flex-col h-full pt-[calc(3.5rem+env(safe-area-inset-top,0px))] safe-area-inset">
          <div className="px-4 pt-4 pb-3 border-b border-border">
            <p className="text-sm font-semibold truncate">{displayName}</p>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="text-xs text-muted-foreground capitalize truncate">
                {session?.user?.role?.toLowerCase()}
              </span>
              <PlanBadge />
            </div>
            {/* The desktop top-right bar is `hidden lg:flex`, so this is the only
                place the branch switcher reaches a phone. It renders null when
                there is nothing to switch between, hence no wrapper: the margin
                lives on the trigger so it collapses with it. */}
            <SucursalSwitcher variant="block" />
          </div>
          <nav className="flex-1 px-3 py-3 overflow-y-auto">
            {filteredSections.map((section) => (
              <div key={section.label || "_top"} className={section.label ? "mt-5 first:mt-0" : ""}>
                {section.label && (
                  <p className="px-3 pb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground/60">
                    {section.label}
                  </p>
                )}
                <div className="space-y-0.5">
                  {section.items.map((item) => {
                    const Icon = item.icon
                    const isActive = esRutaActiva(pathname, item.href)
                    return (
                      <Link
                        key={`${item.href}-${item.label}`}
                        href={item.href}
                        onClick={() => setMobileMenuOpen(false)}
                        className={cn(
                          "relative flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-colors touch-target",
                          "active:scale-[0.98] active:bg-accent/80",
                          isActive
                            ? "bg-primary/10 text-primary font-semibold before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-5 before:w-1 before:rounded-r-full before:bg-primary"
                            : "text-foreground/85 hover:bg-accent hover:text-accent-foreground"
                        )}
                      >
                        <Icon className={cn(
                          "mr-3 h-5 w-5 flex-shrink-0",
                          isActive ? "text-primary" : "text-foreground/65"
                        )} />
                        {item.label}
                      </Link>
                    )
                  })}
                </div>
              </div>
            ))}
          </nav>
          <div className="border-t border-border p-3 space-y-1">
            {/* The avatar dropdown is `hidden lg:flex`, so on a phone this is the
                only route to /perfil (and the account deletion section in it). */}
            <Link
              href="/perfil"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center px-3 py-2.5 text-sm font-medium rounded-lg text-foreground hover:bg-accent hover:text-accent-foreground transition-colors touch-target active:scale-[0.98]"
            >
              <User className="mr-3 h-5 w-5 flex-shrink-0" />
              Mi perfil
            </Link>
            {isAdmin && (
              <Link
                href={MI_PLAN_HREF}
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center px-3 py-2.5 text-sm font-medium rounded-lg text-foreground hover:bg-accent hover:text-accent-foreground transition-colors touch-target active:scale-[0.98]"
              >
                <CreditCard className="mr-3 h-5 w-5 flex-shrink-0" />
                Mi plan
              </Link>
            )}
            <Link
              href="/ayuda/manual"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center px-3 py-2.5 text-sm font-medium rounded-lg text-foreground hover:bg-accent hover:text-accent-foreground transition-colors touch-target active:scale-[0.98]"
            >
              <BookOpen className="mr-3 h-5 w-5 flex-shrink-0" />
              Manual de uso
            </Link>
            <Button
              variant="ghost"
              className="w-full justify-start py-2.5 text-foreground hover:bg-accent hover:text-accent-foreground touch-target active:scale-[0.98]"
              onClick={() => {
                setMobileMenuOpen(false)
                window.dispatchEvent(new Event("start-tour"))
              }}
            >
              <HelpCircle className="mr-3 h-5 w-5" />
              Tour guiado
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start py-2.5 text-destructive-text hover:text-destructive-text hover:bg-destructive/10 touch-target active:scale-[0.98]"
              onClick={handleLogout}
            >
              <LogOut className="mr-3 h-5 w-5" />
              Cerrar sesión
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile Bottom Navigation - Optimizado para touch */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-sm border-t border-border safe-bottom">
        <div className={`grid h-16`} style={{ gridTemplateColumns: `repeat(${filteredBottomNavItems.length + 1}, minmax(0, 1fr))` }}>
          {filteredBottomNavItems.map((item) => {
            const Icon = item.icon
            const isActive = esRutaActiva(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors",
                  "active:bg-accent/50 active:scale-95",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon className={cn("h-5 w-5", isActive && "text-primary")} />
                <span className="truncate max-w-full px-1">{item.label}</span>
              </Link>
            )
          })}

          {/* Botón "Más" para acceder al resto del menú */}
          <button
            onClick={() => setMobileMenuOpen(true)}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors",
              "active:bg-accent/50 active:scale-95",
              isMoreActive
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
            aria-label="Más opciones"
          >
            <MoreHorizontal className={cn("h-5 w-5", isMoreActive && "text-primary")} />
            <span>Más</span>
          </button>
        </div>
      </nav>
    </>
  )
}
