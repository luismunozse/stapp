import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { isValidMediumSize } from "@/lib/labels/etiqueta-inventario"

/**
 * Medio (térmica/hoja) y tamaño de las etiquetas de INVENTARIO de la org
 * (organizations.etiqueta_inventario_medio / etiqueta_inventario_tamano).
 * Es una configuración aparte de la etiqueta de órdenes (/api/configuracion/etiqueta).
 *
 * Endpoint angosto a propósito, fuera de /api/configuracion: esa ruta degrada
 * por una cascada de SELECTs (uno por migración) y una columna nueva sin
 * aplicar tumbaría la cascada entera. Acá solo se tocan estas dos columnas.
 *
 * Las migraciones se aplican a mano, así que el código tiene que andar con las
 * columnas ausentes (42703 de Postgres / PGRST204 de PostgREST): GET devuelve
 * nulls y PATCH responde 503 claro. El cliente cae al localStorage.
 *
 * No es una configuración sensible ni de plata: la leen y la guardan todos los
 * roles que imprimen etiquetas, no solo ADMIN.
 */
const ROLES_QUE_IMPRIMEN = ["ADMIN", "VENDEDOR", "TECNICO"]
const COLUMNAS = "etiqueta_inventario_medio, etiqueta_inventario_tamano"

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
      .select(COLUMNAS)
      .eq("id", organizationId!)
      .single()

    if (columnaAusente(dbError)) return NextResponse.json({ medio: null, tamano: null })
    if (dbError) {
      console.error("Error leyendo etiqueta de inventario:", dbError)
      return NextResponse.json({ error: "Error al obtener la etiqueta de inventario" }, { status: 500 })
    }

    const row = data as { etiqueta_inventario_medio?: unknown; etiqueta_inventario_tamano?: unknown } | null
    const medio = row?.etiqueta_inventario_medio
    const tamano = row?.etiqueta_inventario_tamano
    // El par se valida junto: medio o tamaño sueltos o incompatibles = sin configurar.
    if (!isValidMediumSize(medio, tamano)) return NextResponse.json({ medio: null, tamano: null })
    return NextResponse.json({ medio, tamano })
  } catch (error) {
    console.error("Error en GET configuracion/etiqueta-inventario:", error)
    return NextResponse.json({ error: "Error al obtener la etiqueta de inventario" }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const { error, organizationId, role } = await requireAuth()
    if (error) return error

    if (!role || !ROLES_QUE_IMPRIMEN.includes(role)) {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 })
    }

    let body: { medio?: unknown; tamano?: unknown }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 })
    }

    const medio = body?.medio
    const tamano = body?.tamano
    if (!isValidMediumSize(medio, tamano)) {
      return NextResponse.json({ error: "Medio o tamaño de etiqueta inválido" }, { status: 400 })
    }

    // La org sale SIEMPRE de la sesión, nunca del body.
    const { error: dbError } = await supabaseAdmin
      .from("organizations")
      .update({ etiqueta_inventario_medio: medio, etiqueta_inventario_tamano: tamano })
      .eq("id", organizationId!)

    if (columnaAusente(dbError)) {
      return NextResponse.json(
        {
          error: "La etiqueta de inventario por taller todavía no está disponible. Se guardó solo en este equipo.",
          code: "COLUMNA_NO_DISPONIBLE",
        },
        { status: 503 }
      )
    }
    if (dbError) {
      console.error("Error guardando etiqueta de inventario:", dbError)
      return NextResponse.json({ error: "Error al guardar la etiqueta de inventario" }, { status: 500 })
    }

    return NextResponse.json({ medio, tamano })
  } catch (error) {
    console.error("Error en PATCH configuracion/etiqueta-inventario:", error)
    return NextResponse.json({ error: "Error al guardar la etiqueta de inventario" }, { status: 500 })
  }
}
