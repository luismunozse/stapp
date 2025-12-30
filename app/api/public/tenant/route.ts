import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

// GET: Obtener info pública del tenant por slug
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const slug = searchParams.get("slug")

  if (!slug) {
    return NextResponse.json({ error: "Slug requerido" }, { status: 400 })
  }

  const { data: tenant, error } = await supabaseAdmin
    .from("organizations")
    .select("nombre, nombre_mostrar, logo_url, activo")
    .eq("slug", slug)
    .eq("activo", true)
    .single()

  if (error || !tenant) {
    return NextResponse.json({ tenant: null })
  }

  return NextResponse.json({
    tenant: {
      nombre: tenant.nombre_mostrar || tenant.nombre,
      logoUrl: tenant.logo_url,
    },
  })
}

// POST: Verificar disponibilidad de slug
export async function POST(request: NextRequest) {
  try {
    const { slug } = await request.json()

    if (!slug) {
      return NextResponse.json({ error: "Slug requerido" }, { status: 400 })
    }

    // Importar validación
    const { isValidSlug, RESERVED_SUBDOMAINS } = await import("@/lib/tenant")

    // Validar formato
    const validation = isValidSlug(slug)
    if (!validation.valid) {
      return NextResponse.json({
        available: false,
        error: validation.error,
      })
    }

    // Verificar si está reservado
    if (RESERVED_SUBDOMAINS.has(slug.toLowerCase())) {
      return NextResponse.json({
        available: false,
        error: "Este subdominio está reservado",
      })
    }

    // Verificar si existe en DB
    const { data: existing } = await supabaseAdmin
      .from("organizations")
      .select("id")
      .eq("slug", slug)
      .single()

    if (existing) {
      return NextResponse.json({
        available: false,
        error: "Este subdominio ya está en uso",
      })
    }

    return NextResponse.json({ available: true })
  } catch (error) {
    console.error("Error checking slug:", error)
    return NextResponse.json(
      { error: "Error al verificar disponibilidad" },
      { status: 500 }
    )
  }
}
