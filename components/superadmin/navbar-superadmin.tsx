"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { STAppLogo } from "@/components/shared/stapp-logo"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import {
  LayoutDashboard,
  Building2,
  CreditCard,
  Receipt,
  FileText,
  LogOut,
  Shield,
  Menu,
  X,
  Package,
  Headset,
  Smartphone,
  Megaphone,
  HeartPulse,
  Newspaper,
  MailCheck,
  Puzzle,
} from "lucide-react"
import { useState, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { useFocusTrap } from "@/hooks/use-focus-trap"
import { useEscapeKey } from "@/hooks/use-escape-key"
import { TicketBadge } from "@/components/superadmin/ticket-badge"
import { GlobalSearch } from "@/components/superadmin/global-search"

const navItems = [
  { href: "/superadmin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/superadmin/organizaciones", label: "Organizaciones", icon: Building2 },
  { href: "/superadmin/suscripciones", label: "Suscripciones", icon: CreditCard },
  { href: "/superadmin/pagos", label: "Pagos", icon: Receipt },
  { href: "/superadmin/planes", label: "Planes", icon: Package },
  { href: "/superadmin/soporte", label: "Soporte", icon: Headset },
  { href: "/superadmin/engagement", label: "Engagement", icon: HeartPulse },
  { href: "/superadmin/lifecycle-emails", label: "Lifecycle Emails", icon: MailCheck },
  { href: "/superadmin/feature-usage", label: "Feature Usage", icon: Puzzle },
  { href: "/superadmin/broadcast", label: "Broadcast", icon: Megaphone },
  { href: "/superadmin/changelog", label: "Changelog", icon: Newspaper },
  { href: "/superadmin/waitlist", label: "Waitlist iOS", icon: Smartphone },
  { href: "/superadmin/logs", label: "Auditoría", icon: FileText },
]

interface NavbarSuperadminProps {
  userEmail: string
}

export function NavbarSuperadmin({ userEmail }: NavbarSuperadminProps) {
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Hooks de accesibilidad para menú móvil
  useFocusTrap(menuRef, mobileMenuOpen)
  useEscapeKey(() => setMobileMenuOpen(false), mobileMenuOpen)

  // Prevenir scroll cuando el menú está abierto
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
    return () => {
      document.body.style.overflow = ""
    }
  }, [mobileMenuOpen])

  const handleLogout = async () => {
    await signOut({ redirect: false })
    window.location.href = "/superadmin-login"
  }

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 lg:border-r border-sidebar-border bg-sidebar">
        <div className="flex flex-col flex-1 min-h-0">
          {/* Header con logo STApp + SUPERADMIN */}
          <div className="flex flex-col items-center justify-center h-24 px-6 border-b border-sidebar-border">
            <div className="mb-2">
              <STAppLogo size="md" />
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/15 border border-primary/30">
              <Shield className="h-3.5 w-3.5 text-primary" />
              <span className="text-[11px] font-bold text-primary uppercase tracking-widest">
                SuperAdmin
              </span>
            </div>
          </div>

          {/* Búsqueda global */}
          <div className="px-3 pt-4 pb-2">
            <GlobalSearch />
          </div>

          {/* Navegación */}
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto scrollbar-thin">
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive =
                pathname === item.href || pathname.startsWith(item.href + "/")
              return (
                <Link
                  key={item.href}
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
                  {item.href === "/superadmin/soporte" && <TicketBadge />}
                </Link>
              )
            })}
          </nav>

          {/* Footer con info del usuario */}
          <div className="p-4 border-t border-sidebar-border space-y-3">
            <div className="text-xs text-muted-foreground truncate px-1">
              {userEmail}
            </div>
            <ThemeToggle variant="dropdown" />
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
      <header className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-2">
            <STAppLogo size="sm" />
            <span className="text-[10px] font-bold text-primary uppercase tracking-wider">
              SuperAdmin
            </span>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle variant="icon" />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={mobileMenuOpen ? "Cerrar menú" : "Abrir menú"}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-menu-superadmin"
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
        id="mobile-menu-superadmin"
        ref={menuRef}
        className={cn(
          "lg:hidden fixed top-0 right-0 bottom-0 z-40 w-72 bg-background shadow-xl transition-transform duration-200 ease-out",
          mobileMenuOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        <div className="flex flex-col h-full pt-16">
          <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive =
                pathname === item.href || pathname.startsWith(item.href + "/")
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    "flex items-center px-3 py-3 text-sm font-medium rounded-lg transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <Icon className="mr-3 h-5 w-5" />
                  {item.label}
                  {item.href === "/superadmin/soporte" && <TicketBadge />}
                </Link>
              )
            })}
          </nav>
          <div className="p-4 border-t border-border">
            <div className="text-xs text-muted-foreground truncate px-1 mb-3">
              {userEmail}
            </div>
            <Button
              variant="ghost"
              className="w-full justify-start py-3"
              onClick={handleLogout}
            >
              <LogOut className="mr-3 h-5 w-5" />
              Cerrar Sesión
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
