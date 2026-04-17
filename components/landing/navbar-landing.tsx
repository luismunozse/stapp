"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { STAppLogo } from "@/components/shared/stapp-logo"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { Menu, X, LayoutDashboard } from "lucide-react"
import { useFocusTrap } from "@/hooks/use-focus-trap"
import { useEscapeKey } from "@/hooks/use-escape-key"

export function NavbarLanding() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [isChecking, setIsChecking] = useState(true)
  const menuRef = useRef<HTMLDivElement>(null)

  // Hooks de accesibilidad para menú móvil
  useFocusTrap(menuRef, mobileMenuOpen)
  useEscapeKey(() => setMobileMenuOpen(false), mobileMenuOpen)

  // Verificar sesión del lado del cliente para permitir caching de la landing
  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/auth/session", { signal: controller.signal })
      .then(res => res.json())
      .then(data => { setIsLoggedIn(!!data?.user); setIsChecking(false) })
      .catch(() => { if (!controller.signal.aborted) { setIsLoggedIn(false); setIsChecking(false) } })
    return () => controller.abort()
  }, [])

  const navigation = [
    { name: "Características", href: "/#features" },
    { name: "Precios", href: "/precios" },
    { name: "Casos de uso", href: "/casos-de-uso" },
    { name: "Blog", href: "/empresa/blog" },
    { name: "Ayuda", href: "/ayuda" },
  ]

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b w-full max-w-[100vw]">
      <nav className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-full">
        <div className="flex items-center justify-between h-16 gap-4">
          {/* Logo */}
          <Link href="/" className="flex items-center flex-shrink-0">
            <STAppLogo size="lg" />
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center justify-center flex-1 gap-4 lg:gap-8 min-w-0">
            {navigation.map((item) => {
              const isHashLink = item.href.includes("#")
              return isHashLink ? (
                <a
                  key={item.name}
                  href={item.href}
                  className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm whitespace-nowrap"
                >
                  {item.name}
                </a>
              ) : (
                <Link
                  key={item.name}
                  href={item.href}
                  className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm whitespace-nowrap"
                >
                  {item.name}
                </Link>
              )
            })}
          </div>

          {/* Desktop CTA */}
          <div className="hidden md:flex items-center gap-2 lg:gap-4 flex-shrink-0">
            <ThemeToggle variant="icon" />
            {isChecking ? (
              <div className="w-32 h-9" /> // Placeholder para evitar layout shift
            ) : isLoggedIn ? (
              <Link href="/dashboard">
                <Button className="whitespace-nowrap">
                  <LayoutDashboard className="mr-2 h-4 w-4" />
                  Ir al Dashboard
                </Button>
              </Link>
            ) : (
              <>
                <Link href="/login">
                  <Button variant="ghost" className="whitespace-nowrap">Iniciar Sesión</Button>
                </Link>
                <Link href="/registro">
                  <Button className="whitespace-nowrap">Comenzar Gratis</Button>
                </Link>
              </>
            )}
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden flex items-center gap-2">
            <ThemeToggle variant="icon" />
            <button
              type="button"
              className="p-2"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={mobileMenuOpen ? "Cerrar menú" : "Abrir menú"}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-menu"
            >
              {mobileMenuOpen ? (
                <X className="h-6 w-6" />
              ) : (
                <Menu className="h-6 w-6" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div id="mobile-menu" ref={menuRef} className="md:hidden py-4 border-t">
            <div className="flex flex-col gap-4">
              {navigation.map((item) => {
                const isHashLink = item.href.includes("#")
                return isHashLink ? (
                  <a
                    key={item.name}
                    href={item.href}
                    className="text-sm font-medium text-muted-foreground hover:text-primary"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {item.name}
                  </a>
                ) : (
                  <Link
                    key={item.name}
                    href={item.href}
                    className="text-sm font-medium text-muted-foreground hover:text-primary"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {item.name}
                  </Link>
                )
              })}
              <div className="flex flex-col gap-2 pt-4 border-t">
                {isChecking ? null : isLoggedIn ? (
                  <Link href="/dashboard">
                    <Button className="w-full">
                      <LayoutDashboard className="mr-2 h-4 w-4" />
                      Ir al Dashboard
                    </Button>
                  </Link>
                ) : (
                  <>
                    <Link href="/login">
                      <Button variant="outline" className="w-full">
                        Iniciar Sesión
                      </Button>
                    </Link>
                    <Link href="/registro">
                      <Button className="w-full">Comenzar Gratis</Button>
                    </Link>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </nav>
    </header>
  )
}
