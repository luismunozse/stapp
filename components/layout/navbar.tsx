"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut, useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import {
  LayoutDashboard,
  ClipboardList,
  Users,
  Wrench,
  Package,
  FileText,
  BarChart3,
  LogOut,
  Menu,
  X,
  Settings,
  Store,
  MoreHorizontal,
  TrendingUp,
  ShoppingCart,
  Headset,
  Receipt,
  Landmark,
  HelpCircle,
  PanelLeft,
  ChevronsLeft,
  Mail,
} from "lucide-react"
import { useState, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { BusinessLogo } from "@/components/shared/business-logo"
import { useFocusTrap } from "@/hooks/use-focus-trap"
import { useEscapeKey } from "@/hooks/use-escape-key"
import { isNativePlatform } from "@/lib/capacitor"
import { ApkDownloadBanner } from "@/components/shared/apk-download-banner"
import { GlobalSearch } from "@/components/shared/global-search"
import { NotificationBell } from "@/components/notifications/notification-bell"
import { useSidebar } from "@/components/layout/sidebar-context"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard; roles?: string[] }

// roles = undefined means visible to all roles
const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/ordenes", label: "Órdenes", icon: ClipboardList },
  { href: "/clientes", label: "Clientes", icon: Users, roles: ["ADMIN", "VENDEDOR", "TECNICO"] },
  { href: "/tecnicos", label: "Técnicos", icon: Wrench, roles: ["ADMIN"] },
  { href: "/vendedores", label: "Vendedores", icon: TrendingUp, roles: ["ADMIN"] },
  { href: "/ventas", label: "Ventas", icon: ShoppingCart, roles: ["ADMIN", "VENDEDOR"] },
  { href: "/pos", label: "POS", icon: Store, roles: ["ADMIN", "VENDEDOR"] },
  { href: "/cotizaciones", label: "Cotizaciones", icon: Receipt, roles: ["ADMIN", "TECNICO"] },
  { href: "/inventario", label: "Inventario", icon: Package, roles: ["ADMIN"] },
  { href: "/caja", label: "Caja", icon: Landmark, roles: ["ADMIN"] },
  { href: "/facturacion", label: "Facturación", icon: FileText, roles: ["ADMIN"] },
  { href: "/reportes", label: "Reportes", icon: BarChart3, roles: ["ADMIN", "VENDEDOR"] },
  { href: "/emails", label: "Emails", icon: Mail, roles: ["ADMIN"] },
  { href: "/soporte", label: "Soporte", icon: Headset },
]

// Items principales para el bottom nav (los 4 más usados)
const bottomNavItems: NavItem[] = [
  { href: "/dashboard", label: "Inicio", icon: LayoutDashboard },
  { href: "/ordenes", label: "Órdenes", icon: ClipboardList },
  { href: "/clientes", label: "Clientes", icon: Users, roles: ["ADMIN", "VENDEDOR", "TECNICO"] },
  { href: "/inventario", label: "Inventario", icon: Package, roles: ["ADMIN"] },
]

export function Navbar() {
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const { data: session } = useSession()
  const userRole = session?.user?.role || ""
  const isAdmin = userRole === "ADMIN"
  const menuRef = useRef<HTMLDivElement>(null)
  const { collapsed, toggle } = useSidebar()

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

  const allNavItems = [
    ...navItems.filter(item => !item.roles || item.roles.includes(userRole)),
    ...(userRole === "ADMIN" || userRole === "VENDEDOR" ? [
      { href: "/proveedores", label: "Proveedores", icon: Store }
    ] : []),
    ...(isAdmin ? [
      { href: "/configuracion", label: "Configuración", icon: Settings }
    ] : [])
  ]

  // Logout que redirige al login del mismo dominio/subdominio
  const handleLogout = async () => {
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

  const filteredBottomNavItems = bottomNavItems.filter(item => !item.roles || item.roles.includes(userRole))

  // Items que no están en el bottom nav (para el menú "Más")
  const moreItems = allNavItems.filter(
    item => !filteredBottomNavItems.some(bottomItem => bottomItem.href === item.href)
  )

  // Verificar si algún item de "más" está activo
  const isMoreActive = moreItems.some(
    item => pathname === item.href || pathname.startsWith(item.href + "/")
  )

  return (
    <>
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
            <Link href="/dashboard" className="hover:opacity-80 transition-opacity overflow-hidden">
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
              "flex-1 py-4 space-y-1 overflow-y-auto scrollbar-thin transition-all duration-300",
              collapsed ? "px-2" : "px-3"
            )}>
              {allNavItems.map((item) => {
                const Icon = item.icon
                const isActive = pathname === item.href || pathname.startsWith(item.href + "/")

                const linkContent = (
                  <Link
                    key={item.href}
                    id={`nav-${item.href.replace("/", "")}`}
                    href={item.href}
                    className={cn(
                      "flex items-center text-sm font-medium rounded-lg transition-colors",
                      collapsed ? "justify-center px-2 py-2" : "px-3 py-2",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    )}
                  >
                    <Icon className={cn("h-5 w-5 shrink-0", !collapsed && "mr-3")} />
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

                return linkContent
              })}
            </nav>
          </TooltipProvider>

          {!collapsed && <ApkDownloadBanner variant="sidebar" />}

          {/* Footer */}
          <div className={cn(
            "border-t border-sidebar-border transition-all duration-300",
            collapsed ? "p-2 space-y-1" : "p-4 space-y-2"
          )}>
            {collapsed ? (
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div><ThemeToggle variant="icon" /></div>
                  </TooltipTrigger>
                  <TooltipContent side="right">Cambiar tema</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="w-full text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      onClick={() => window.dispatchEvent(new Event("start-tour"))}
                    >
                      <HelpCircle className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">Tour guiado</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="w-full text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      onClick={handleLogout}
                    >
                      <LogOut className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">Cerrar Sesion</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <>
                <ThemeToggle variant="dropdown" />
                <Button
                  variant="ghost"
                  className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  onClick={() => window.dispatchEvent(new Event("start-tour"))}
                >
                  <HelpCircle className="mr-3 h-5 w-5" />
                  Tour guiado
                </Button>
                <Button
                  variant="ghost"
                  className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  onClick={handleLogout}
                >
                  <LogOut className="mr-3 h-5 w-5" />
                  Cerrar Sesion
                </Button>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* Desktop Top-Right Bar */}
      <div className={cn(
        "hidden lg:flex items-center gap-2 fixed top-3 right-4 z-40"
      )}>
        <GlobalSearch />
        <NotificationBell />
      </div>

      {/* Mobile Header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border safe-area-inset-top">
        <div className="flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-2">
            <Link href="/dashboard" className="hover:opacity-80 transition-opacity">
              <BusinessLogo size="sm" showText={true} textClassName="text-lg" />
            </Link>
          </div>
          <div className="flex items-center gap-1">
            <GlobalSearch />
            <NotificationBell />
            <ThemeToggle variant="icon" />
            <Button
              variant="ghost"
              size="icon"
              className="touch-target text-muted-foreground hover:text-destructive"
              onClick={handleLogout}
              aria-label="Cerrar sesión"
            >
              <LogOut className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="touch-target"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={mobileMenuOpen ? "Cerrar menú" : "Abrir menú"}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-menu-drawer"
            >
              {mobileMenuOpen ? (
                <X className="h-6 w-6" />
              ) : (
                <Menu className="h-6 w-6" />
              )}
            </Button>
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
          "lg:hidden fixed top-0 right-0 bottom-0 z-40 w-72 bg-background shadow-xl transition-transform duration-200 ease-out",
          mobileMenuOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        <div className="flex flex-col h-full pt-16 safe-area-inset">
          <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
            {allNavItems.map((item) => {
              const Icon = item.icon
              const isActive = pathname === item.href || pathname.startsWith(item.href + "/")
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    "flex items-center px-3 py-3 text-sm font-medium rounded-lg transition-colors touch-target",
                    "active:scale-[0.98] active:bg-accent/80",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <Icon className="mr-3 h-5 w-5 flex-shrink-0" />
                  {item.label}
                </Link>
              )
            })}
          </nav>
          <div className="p-4 border-t border-border safe-bottom">
            <Button
              variant="ghost"
              className="w-full justify-start py-3 touch-target active:scale-[0.98]"
              onClick={handleLogout}
            >
              <LogOut className="mr-3 h-5 w-5" />
              Cerrar Sesión
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile Bottom Navigation - Optimizado para touch */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-sm border-t border-border safe-bottom">
        <div className={`grid h-16`} style={{ gridTemplateColumns: `repeat(${filteredBottomNavItems.length + 1}, minmax(0, 1fr))` }}>
          {filteredBottomNavItems.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/")
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
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
              "flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
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
