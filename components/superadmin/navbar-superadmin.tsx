"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"
import { Button } from "@/components/ui/button"
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
} from "lucide-react"
import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"

const navItems = [
  { href: "/superadmin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/superadmin/organizaciones", label: "Organizaciones", icon: Building2 },
  { href: "/superadmin/suscripciones", label: "Suscripciones", icon: CreditCard },
  { href: "/superadmin/pagos", label: "Pagos", icon: Receipt },
  { href: "/superadmin/logs", label: "Auditoría", icon: FileText },
]

interface NavbarSuperadminProps {
  userEmail: string
}

export function NavbarSuperadmin({ userEmail }: NavbarSuperadminProps) {
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // Cerrar menú cuando cambia la ruta
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [pathname])

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
          {/* Header con logo SUPERADMIN */}
          <div className="flex items-center h-16 px-6 border-b border-sidebar-border bg-red-950/20">
            <Shield className="h-6 w-6 text-red-500 mr-2" />
            <span className="font-bold text-lg text-red-500">SUPERADMIN</span>
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
                      ? "bg-red-600 text-white"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <Icon className="mr-3 h-5 w-5" />
                  {item.label}
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
          <div className="flex items-center">
            <Shield className="h-5 w-5 text-red-500 mr-2" />
            <span className="font-bold text-red-500">SUPERADMIN</span>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle variant="icon" />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={mobileMenuOpen ? "Cerrar menú" : "Abrir menú"}
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
      />

      {/* Mobile Menu Drawer */}
      <div
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
                      ? "bg-red-600 text-white"
                      : "text-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <Icon className="mr-3 h-5 w-5" />
                  {item.label}
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
