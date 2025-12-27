import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { getAuthSession } from "@/lib/auth-utils"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const slug = searchParams.get("slug")

    let organization = null

    // Si hay sesión activa, usar la organización del usuario
    const { organizationId } = await getAuthSession()
    if (organizationId) {
      const { data } = await supabaseAdmin
        .from("organizations")
        .select("logo_url, nombre_mostrar")
        .eq("id", organizationId)
        .single()
      organization = data
    }
    // Si hay slug, buscar la organización por slug (para login personalizado)
    else if (slug) {
      const { data } = await supabaseAdmin
        .from("organizations")
        .select("logo_url, nombre_mostrar")
        .eq("slug", slug)
        .eq("activo", true)
        .single()
      organization = data
    }

    if (!organization?.logo_url) {
      return NextResponse.json({
        hasLogo: false,
        nombreEmpresa: organization?.nombre_mostrar || "STApp"
      })
    }

    return NextResponse.json({
      hasLogo: true,
      logoUrl: organization.logo_url,
      nombreEmpresa: organization.nombre_mostrar
    })
  } catch (error) {
    console.error("Error fetching logo:", error)
    return NextResponse.json({
      hasLogo: false,
      nombreEmpresa: "STApp"
    })
  }
}
