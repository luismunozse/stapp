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
  HelpCircle,
} from "lucide-react"
import { useState, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { BusinessLogo } from "@/components/shared/business-logo"
import { useFocusTrap } from "@/hooks/use-focus-trap"
import { useEscapeKey } from "@/hooks/use-escape-key"
import { isNativePlatform } from "@/lib/capacitor"

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/ordenes", label: "Órdenes", icon: ClipboardList },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/tecnicos", label: "Técnicos", icon: Wrench },
  { href: "/vendedores", label: "Vendedores", icon: TrendingUp },
  { href: "/ventas", label: "Ventas", icon: ShoppingCart },
  { href: "/inventario", label: "Inventario", icon: Package },
  { href: "/facturacion", label: "Facturación", icon: FileText },
  { href: "/reportes", label: "Reportes", icon: BarChart3 },
  { href: "/soporte", label: "Soporte", icon: Headset },
]

// Items principales para el bottom nav (los 4 más usados)
const bottomNavItems = [
  { href: "/dashboard", label: "Inicio", icon: LayoutDashboard },
  { href: "/ordenes", label: "Órdenes", icon: ClipboardList },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/inventario", label: "Inventario", icon: Package },
]

export function Navbar() {
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === "ADMIN"
  const menuRef = useRef<HTMLDivElement>(null)

  // Hooks de accesibilidad para menú móvil
  useFocusTrap(menuRef, mobileMenuOpen)
  useEscapeKey(() => setMobileMenuOpen(false), mobileMenuOpen)

  // Cerrar menú cuando cambia la ruta
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [pathname])

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
    ...navItems,
    ...(isAdmin ? [
      { href: "/proveedores", label: "Proveedores", icon: Store },
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

  // Items que no están en el bottom nav (para el menú "Más")
  const moreItems = allNavItems.filter(
    item => !bottomNavItems.some(bottomItem => bottomItem.href === item.href)
  )

  // Verificar si algún item de "más" está activo
  const isMoreActive = moreItems.some(
    item => pathname === item.href || pathname.startsWith(item.href + "/")
  )

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 lg:border-r border-sidebar-border bg-sidebar">
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex flex-col gap-2 px-6 py-4 border-b border-sidebar-border">
            <Link href="/dashboard" className="hover:opacity-80 transition-opacity">
              <BusinessLogo size="sm" showText={true} textClassName="text-xl" />
            </Link>
          </div>
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto scrollbar-thin">
            {allNavItems.map((item) => {
              const Icon = item.icon
              const isActive = pathname === item.href || pathname.startsWith(item.href + "/")
              return (
                <Link
                  key={item.href}
                  id={`nav-${item.href.replace("/", "")}`}
                  href={item.href}
                  className={cn(
                    "flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <Icon className="mr-3 h-5 w-5" />
                  {item.label}
                </Link>
              )
            })}
          </nav>
          <div className="p-4 border-t border-sidebar-border space-y-2">
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
              Cerrar Sesión
            </Button>
          </div>
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border safe-area-inset-top">
        <div className="flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-2">
            <Link href="/dashboard" className="hover:opacity-80 transition-opacity">
              <BusinessLogo size="sm" showText={true} textClassName="text-lg" />
            </Link>
          </div>
          <div className="flex items-center gap-1">
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
        <div className="grid grid-cols-5 h-16">
          {bottomNavItems.map((item) => {
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
