import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * GET/PUT /api/configuracion/danos — si la org exige registrar el estado físico
 * del equipo al crear una orden (migración 408). Solo ADMIN.
 *
 * Va aparte de PUT /api/configuracion por lo mismo que garantías: si la 408 no
 * corrió, solo falla este guardado (con mensaje claro) y no el resto.
 */
export async function GET() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { data, error: dbError } = await supabaseAdmin
      .from("organizations")
      .select("danos_recepcion_obligatorio")
      .eq("id", organizationId!)
      .single()

    // Columna inexistente (408 sin correr): se lee como "no obligatorio".
    if (dbError || !data) return NextResponse.json({ obligatorio: false })

    return NextResponse.json({ obligatorio: data.danos_recepcion_obligatorio === true })
  } catch (err) {
    console.error("Error leyendo la configuración de daños:", err)
    return NextResponse.json({ error: "Error al obtener la configuración de daños" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 })
    }

    const obligatorio = (body as { obligatorio?: unknown } | null)?.obligatorio
    if (typeof obligatorio !== "boolean") {
      return NextResponse.json({ error: "obligatorio debe ser verdadero o falso" }, { status: 400 })
    }

    const { error: dbError } = await supabaseAdmin
      .from("organizations")
      .update({ danos_recepcion_obligatorio: obligatorio })
      .eq("id", organizationId!)

    if (dbError) {
      console.error("Error guardando la configuración de daños:", dbError)
      return NextResponse.json({ error: "No se pudo guardar la configuración del estado físico" }, { status: 500 })
    }

    return NextResponse.json({ obligatorio })
  } catch (err) {
    console.error("Error guardando la configuración de daños:", err)
    return NextResponse.json({ error: "No se pudo guardar la configuración del estado físico" }, { status: 500 })
  }
}
