"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowRight, Building2, Trash2, Loader2 } from "lucide-react"

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
const PROTOCOL = "https"
const STORAGE_KEY = "stapp-tenant-slug"
const RECENT_KEY = "stapp-recent-tenants"

export default function AppEntryPage() {
  const [slug, setSlug] = useState("")
  const [recentTenants, setRecentTenants] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    // Verificar si hay un tenant guardado para auto-redirect
    const savedSlug = localStorage.getItem(STORAGE_KEY)
    const recent = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]") as string[]
    setRecentTenants(recent)

    if (savedSlug) {
      // Auto-redirect al último tenant usado
      navigateToTenant(savedSlug)
    } else {
      setLoading(false)
    }
  }, [])

  const navigateToTenant = (tenantSlug: string) => {
    setLoading(true)
    setError("")

    // Guardar el slug
    localStorage.setItem(STORAGE_KEY, tenantSlug)

    // Guardar en recientes (máximo 5)
    const recent = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]") as string[]
    const updated = [tenantSlug, ...recent.filter((s) => s !== tenantSlug)].slice(0, 5)
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated))

    // Navegar al subdominio del tenant
    window.location.href = `${PROTOCOL}://${tenantSlug}.${ROOT_DOMAIN}/login`
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = slug.trim().toLowerCase()

    if (!trimmed) {
      setError("Ingresa el nombre de tu empresa")
      return
    }

    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(trimmed)) {
      setError("Solo letras, números y guiones (sin espacios)")
      return
    }

    navigateToTenant(trimmed)
  }

  const removeTenant = (tenantSlug: string) => {
    const updated = recentTenants.filter((s) => s !== tenantSlug)
    setRecentTenants(updated)
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated))

    if (localStorage.getItem(STORAGE_KEY) === tenantSlug) {
      localStorage.removeItem(STORAGE_KEY)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-white dark:from-gray-950 dark:to-gray-900">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center mx-auto">
            <span className="text-white font-bold text-2xl">ST</span>
          </div>
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-blue-600" />
          <p className="text-sm text-muted-foreground">Cargando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-white dark:from-gray-950 dark:to-gray-900 p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="text-center space-y-2">
          <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center mx-auto">
            <span className="text-white font-bold text-2xl">ST</span>
          </div>
          <h1 className="text-2xl font-bold">STApp</h1>
          <p className="text-sm text-muted-foreground">
            Gestión de Servicio Técnico
          </p>
        </div>

        {/* Formulario */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Acceder a tu empresa</CardTitle>
            <CardDescription>
              Ingresa el identificador de tu empresa
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="slug">Empresa</Label>
                <div className="flex items-center gap-0">
                  <Input
                    id="slug"
                    value={slug}
                    onChange={(e) => {
                      setSlug(e.target.value.toLowerCase().replace(/\s/g, "-"))
                      setError("")
                    }}
                    placeholder="mi-empresa"
                    className="rounded-r-none"
                    autoCapitalize="none"
                    autoCorrect="off"
                  />
                  <div className="h-10 px-3 flex items-center bg-muted border border-l-0 rounded-r-md text-sm text-muted-foreground whitespace-nowrap">
                    .{ROOT_DOMAIN}
                  </div>
                </div>
                {error && (
                  <p className="text-sm text-destructive">{error}</p>
                )}
              </div>
              <Button type="submit" className="w-full">
                Acceder
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Empresas recientes */}
        {recentTenants.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Empresas recientes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {recentTenants.map((tenant) => (
                <div
                  key={tenant}
                  className="flex items-center justify-between group"
                >
                  <button
                    onClick={() => navigateToTenant(tenant)}
                    className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-muted flex-1 text-left transition-colors"
                  >
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <div className="font-medium text-sm">{tenant}</div>
                      <div className="text-xs text-muted-foreground">
                        {tenant}.{ROOT_DOMAIN}
                      </div>
                    </div>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => removeTenant(tenant)}
                  >
                    <Trash2 className="h-3 w-3 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
