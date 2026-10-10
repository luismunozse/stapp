import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { isLabelSize } from "@/lib/etiqueta-tamano"

/**
 * Tamaño de etiqueta térmica de la org (organizations.etiqueta_tamano).
 *
 * Endpoint angosto a propósito, fuera de /api/configuracion: esa ruta degrada
 * por una cascada de SELECTs (uno por migración) y una columna nueva sin
 * aplicar tumbaría la cascada entera. Acá solo se toca esta columna.
 *
 * Las migraciones se aplican a mano, así que el código tiene que andar con la
 * columna ausente (42703 de Postgres / PGRST204 de PostgREST): GET devuelve
 * null y PATCH responde 503 claro. El cliente cae al localStorage.
 *
 * GET lo puede leer cualquier miembro de la org y PATCH cualquiera que llegue
 * al detalle de una orden (donde se imprimen las etiquetas): no es una
 * configuración sensible ni de plata, por eso no es solo ADMIN.
 */
const ROLES_QUE_IMPRIMEN = ["ADMIN", "VENDEDOR", "TECNICO"]

function columnaAusente(err: { code?: string } | null): boolean {
  if (!err) return false
  return err.code === "42703" || err.code === "PGRST204"
}

export async function GET() {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { data, error: dbError } = await supabaseAdmin
      .from("organizations")
      .select("etiqueta_tamano")
      .eq("id", organizationId!)
      .single()

    if (columnaAusente(dbError)) return NextResponse.json({ tamano: null })
    if (dbError) {
      console.error("Error leyendo etiqueta_tamano:", dbError)
      return NextResponse.json({ error: "Error al obtener el tamaño de etiqueta" }, { status: 500 })
    }

    const tamano = data?.etiqueta_tamano
    return NextResponse.json({ tamano: isLabelSize(tamano) ? tamano : null })
  } catch (error) {
    console.error("Error en GET configuracion/etiqueta:", error)
    return NextResponse.json({ error: "Error al obtener el tamaño de etiqueta" }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const { error, organizationId, role } = await requireAuth()
    if (error) return error

    if (!role || !ROLES_QUE_IMPRIMEN.includes(role)) {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 })
    }

    let body: { tamano?: unknown }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 })
    }

    if (!isLabelSize(body?.tamano)) {
      return NextResponse.json({ error: "Tamaño de etiqueta inválido" }, { status: 400 })
    }
    const tamano = body.tamano

    // La org sale SIEMPRE de la sesión, nunca del body.
    const { error: dbError } = await supabaseAdmin
      .from("organizations")
      .update({ etiqueta_tamano: tamano })
      .eq("id", organizationId!)

    if (columnaAusente(dbError)) {
      return NextResponse.json(
        {
          error: "El tamaño por taller todavía no está disponible. Se guardó solo en este equipo.",
          code: "COLUMNA_NO_DISPONIBLE",
        },
        { status: 503 }
      )
    }
    if (dbError) {
      console.error("Error guardando etiqueta_tamano:", dbError)
      return NextResponse.json({ error: "Error al guardar el tamaño de etiqueta" }, { status: 500 })
    }

    return NextResponse.json({ tamano })
  } catch (error) {
    console.error("Error en PATCH configuracion/etiqueta:", error)
    return NextResponse.json({ error: "Error al guardar el tamaño de etiqueta" }, { status: 500 })
  }
}
