import { supabaseAdmin } from "@/lib/supabase"
import { headers } from "next/headers"
import { cache } from "react"

export interface TenantInfo {
  id: string
  slug: string
  nombre: string
  nombreMostrar: string
  logoUrl: string | null
  activo: boolean
}

// Subdominios reservados que no pueden usarse
export const RESERVED_SUBDOMAINS = new Set([
  "www",
  "api",
  "app",
  "admin",
  "dashboard",
  "mail",
  "email",
  "ftp",
  "cdn",
  "static",
  "assets",
  "blog",
  "help",
  "support",
  "status",
  "docs",
  "dev",
  "staging",
  "test",
  "login",
  "registro",
  "signup",
  "signin",
])

// Cache tenant lookup por la duración del request
export const getTenantBySlug = cache(
  async (slug: string): Promise<TenantInfo | null> => {
    const { data, error } = await supabaseAdmin
      .from("organizations")
      .select("id, slug, nombre, nombre_mostrar, logo_url, activo")
      .eq("slug", slug)
      .eq("activo", true)
      .single()

    if (error || !data) {
      return null
    }

    return {
      id: data.id,
      slug: data.slug,
      nombre: data.nombre,
      nombreMostrar: data.nombre_mostrar || data.nombre,
      logoUrl: data.logo_url,
      activo: data.activo,
    }
  }
)

// Obtener tenant desde headers (seteado por middleware)
export async function getCurrentTenant(): Promise<TenantInfo | null> {
  const headersList = await headers()
  const slug = headersList.get("x-tenant-slug")

  if (!slug) {
    return null
  }

  return getTenantBySlug(slug)
}

// Obtener slug del tenant desde headers
export async function getTenantSlug(): Promise<string | null> {
  const headersList = await headers()
  return headersList.get("x-tenant-slug")
}

// Validar que usuario pertenece al tenant
export async function validateUserTenant(
  userOrganizationId: string,
  tenantSlug: string
): Promise<boolean> {
  const tenant = await getTenantBySlug(tenantSlug)

  if (!tenant) {
    return false
  }

  return tenant.id === userOrganizationId
}

// Extraer subdomain del hostname
export function extractSubdomain(hostname: string): string | null {
  // Quitar puerto si existe
  const host = hostname.split(":")[0]

  // Desarrollo local sin subdominio
  if (host === "localhost" || host === "127.0.0.1") {
    return null
  }

  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
  const parts = host.split(".")

  // stapp.com.ar (2 partes) o www.stapp.com.ar (www = no subdominio)
  if (parts.length <= rootDomain.split(".").length) {
    return null
  }

  // guru-tech.stapp.com.ar → "guru-tech"
  const subdomain = parts[0]

  // www no es subdominio de tenant
  if (subdomain === "www") {
    return null
  }

  return subdomain
}

// Validar formato de slug
export function isValidSlug(slug: string): {
  valid: boolean
  error?: string
} {
  // Longitud
  if (slug.length < 3) {
    return { valid: false, error: "El subdominio debe tener al menos 3 caracteres" }
  }
  if (slug.length > 50) {
    return { valid: false, error: "El subdominio no puede tener más de 50 caracteres" }
  }

  // Debe empezar con letra
  if (!/^[a-z]/.test(slug)) {
    return { valid: false, error: "El subdominio debe empezar con una letra" }
  }

  // Solo letras minúsculas, números y guiones
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return {
      valid: false,
      error: "Solo se permiten letras minúsculas, números y guiones",
    }
  }

  // No guiones consecutivos
  if (/--/.test(slug)) {
    return { valid: false, error: "No se permiten guiones consecutivos" }
  }

  // No terminar en guion
  if (slug.endsWith("-")) {
    return { valid: false, error: "El subdominio no puede terminar en guion" }
  }

  // No reservado
  if (RESERVED_SUBDOMAINS.has(slug)) {
    return { valid: false, error: "Este subdominio está reservado" }
  }

  return { valid: true }
}

// Sanitizar input para slug
export function sanitizeSlug(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Quitar acentos
    .replace(/[^a-z0-9-]/g, "-") // Reemplazar caracteres no válidos
    .replace(/-+/g, "-") // Colapsar guiones múltiples
    .replace(/^-|-$/g, "") // Quitar guiones al inicio/final
    .substring(0, 50)
}
