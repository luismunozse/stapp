"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"
import { Button } from "@/components/ui/button"
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
} from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/ordenes", label: "Órdenes", icon: ClipboardList },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/tecnicos", label: "Técnicos", icon: Wrench },
  { href: "/inventario", label: "Inventario", icon: Package },
  { href: "/facturacion", label: "Facturación", icon: FileText },
  { href: "/reportes", label: "Reportes", icon: BarChart3 },
]

export function Navbar() {
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 lg:border-r bg-white">
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center h-16 px-6 border-b">
            <h1 className="text-xl font-bold">Servicio Técnico</h1>
          </div>
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive = pathname === item.href || pathname.startsWith(item.href + "/")
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-gray-700 hover:bg-gray-100"
                  )}
                >
                  <Icon className="mr-3 h-5 w-5" />
                  {item.label}
                </Link>
              )
            })}
          </nav>
          <div className="p-4 border-t">
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              <LogOut className="mr-3 h-5 w-5" />
              Cerrar Sesión
            </Button>
          </div>
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-white border-b">
        <div className="flex items-center justify-between h-16 px-4">
          <h1 className="text-lg font-bold">Servicio Técnico</h1>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? (
              <X className="h-6 w-6" />
            ) : (
              <Menu className="h-6 w-6" />
            )}
          </Button>
        </div>
      </header>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-white pt-16">
          <nav className="flex flex-col px-4 py-2 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive = pathname === item.href || pathname.startsWith(item.href + "/")
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    "flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-gray-700 hover:bg-gray-100"
                  )}
                >
                  <Icon className="mr-3 h-5 w-5" />
                  {item.label}
                </Link>
              )
            })}
            <Button
              variant="ghost"
              className="w-full justify-start mt-4"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              <LogOut className="mr-3 h-5 w-5" />
              Cerrar Sesión
            </Button>
          </nav>
        </div>
      )}

      {/* Mobile Bottom Navigation */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t">
        <div className="grid grid-cols-4 gap-1">
          {navItems.slice(0, 4).map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/")
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center py-2 text-xs transition-colors",
                  isActive ? "text-primary" : "text-gray-600"
                )}
              >
                <Icon className="h-5 w-5 mb-1" />
                <span className="truncate">{item.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}

