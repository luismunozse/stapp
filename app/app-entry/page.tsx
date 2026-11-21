"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { STAppLogo } from "@/components/shared/stapp-logo"
import { AuthSplitLayout } from "@/components/auth/auth-split-layout"
import { AuthHeader } from "@/components/auth/auth-header"
import { isValidTenantSlug } from "@/lib/account-deletion/urls"
import { ArrowRight, Building2, Trash2, Loader2, UserPlus } from "lucide-react"
import { RECENT_TENANTS_KEY, TENANT_STORAGE_KEY, rememberTenant } from "@/lib/app-entry-tenants"

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
const PROTOCOL = "https"

/**
 * Pantalla de entrada de la app nativa (Capacitor carga
 * https://stapp.com.ar/app-entry). Elige el negocio y redirige a su login.
 * Si ya hay uno guardado, redirige directo.
 *
 * El alta de negocios va por /registro, el mismo formulario de la web: acá
 * había un registro propio que no pedía rubro (los negocios arrancaban con el
 * pack genérico) y aceptaba contraseñas que la API después rechazaba.
 */
export default function AppEntryPage() {
  const [slug, setSlug] = useState("")
  const [recentTenants, setRecentTenants] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [navigating, setNavigating] = useState(false)
  const [error, setError] = useState("")

  const navigateToTenant = (tenantSlug: string) => {
    setNavigating(true)
    setError("")
    rememberTenant(tenantSlug)
    window.location.href = `${PROTOCOL}://${tenantSlug}.${ROOT_DOMAIN}/login`
  }

  useEffect(() => {
    const savedSlug = localStorage.getItem(TENANT_STORAGE_KEY)
    const recent = JSON.parse(localStorage.getItem(RECENT_TENANTS_KEY) || "[]") as string[]
    setRecentTenants(recent)

    if (savedSlug) {
      navigateToTenant(savedSlug)
    } else {
      setLoading(false)
    }
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = slug.trim().toLowerCase()

    if (!trimmed) {
      setError("Ingresá el identificador de tu negocio")
      return
    }

    if (!isValidTenantSlug(trimmed)) {
      setError("Solo letras, números y guiones (sin espacios)")
      return
    }

    navigateToTenant(trimmed)
  }

  const removeTenant = (tenantSlug: string) => {
    const updated = recentTenants.filter((s) => s !== tenantSlug)
    setRecentTenants(updated)
    localStorage.setItem(RECENT_TENANTS_KEY, JSON.stringify(updated))

    if (localStorage.getItem(TENANT_STORAGE_KEY) === tenantSlug) {
      localStorage.removeItem(TENANT_STORAGE_KEY)
    }
  }

  // --- Cargando / redirigiendo ---
  if (loading || navigating) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background" aria-live="polite">
        <div className="text-center space-y-6">
          <STAppLogo size="xl" showText={false} className="justify-center" />
          <div className="space-y-2">
            <p className="text-2xl font-bold">
              <span className="text-primary">ST</span>
              <span className="text-foreground">App</span>
            </p>
            <p className="text-sm text-muted-foreground">Gestión de servicio técnico</p>
          </div>
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" aria-hidden="true" />
          <p className="text-xs text-muted-foreground">
            {navigating ? "Conectando con tu negocio..." : "Cargando..."}
          </p>
        </div>
      </div>
    )
  }

  return (
    <AuthSplitLayout>
      <div className="space-y-8">
        <AuthHeader
          title="Entrá a tu negocio"
          description="Ingresá el identificador de tu negocio para ir a su login"
        />

        <form onSubmit={handleSubmit} className="space-y-3">
          <Label htmlFor="slug">Identificador</Label>
          <div className="flex h-10 items-center rounded-md border border-input bg-background text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
            <input
              id="slug"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value.toLowerCase().replace(/\s/g, "-"))
                setError("")
              }}
              placeholder="mi-negocio"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={!!error || undefined}
              aria-describedby={error ? "slug-error" : undefined}
              className="h-full min-w-0 flex-1 rounded-l-md bg-transparent px-3 placeholder:text-muted-foreground focus:outline-none"
            />
            <span className="shrink-0 border-l border-input px-3 text-muted-foreground">
              .{ROOT_DOMAIN}
            </span>
          </div>
          {error && (
            <p id="slug-error" role="alert" className="text-sm text-destructive-text">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full h-11">
            Continuar
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </form>

        {recentTenants.length > 0 && (
          <section className="space-y-2" aria-labelledby="recientes">
            <h2 id="recientes" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Negocios recientes
            </h2>
            <ul className="divide-y rounded-xl border">
              {recentTenants.map((tenant) => (
                <li key={tenant} className="flex items-center">
                  <button
                    onClick={() => navigateToTenant(tenant)}
                    className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-accent first:rounded-t-xl"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <Building2 className="h-4 w-4 text-primary" aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{tenant}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {tenant}.{ROOT_DOMAIN}
                      </span>
                    </span>
                  </button>
                  <button
                    onClick={() => removeTenant(tenant)}
                    aria-label={`Quitar ${tenant} de recientes`}
                    className="mr-2 rounded-lg p-2 text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive-text"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">¿No tenés cuenta?</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <Button asChild variant="outline" className="w-full h-11">
            <Link href="/registro">
              <UserPlus className="mr-2 h-4 w-4" />
              Registrar mi negocio
            </Link>
          </Button>
        </div>
      </div>
    </AuthSplitLayout>
  )
}
