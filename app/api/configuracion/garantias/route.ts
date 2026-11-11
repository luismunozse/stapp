import { NextResponse } from "next/server"
import { revalidateTag } from "next/cache"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { leerConfigGarantias } from "@/lib/garantias/config-org"
import { validarConfigGarantias } from "@/lib/garantias/config"

/**
 * GET/PUT /api/configuracion/garantias — términos de garantía de la org,
 * ventana "por vencer" y aviso al cliente antes del vencimiento (migración
 * 402). Solo ADMIN.
 *
 * Va aparte de PUT /api/configuracion a propósito: esa ruta arma su SELECT en
 * cascada según qué migraciones corrieron, y sumarle columnas nuevas obliga a
 * otro escalón. Acá una columna que falta (402 sin correr) solo rompe este
 * guardado, con un mensaje claro, y nunca el resto de la configuración.
 */
export async function GET() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error
    return NextResponse.json(await leerConfigGarantias(organizationId!))
  } catch (err) {
    console.error("Error leyendo la configuración de garantías:", err)
    return NextResponse.json({ error: "Error al obtener la configuración de garantías" }, { status: 500 })
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

    const validado = validarConfigGarantias(body)
    if (!validado.ok) return NextResponse.json({ error: validado.error }, { status: 400 })

    const { error: dbError } = await supabaseAdmin
      .from("organizations")
      .update(validado.update)
      .eq("id", organizationId!)

    if (dbError) {
      console.error("Error guardando la configuración de garantías:", dbError)
      return NextResponse.json({ error: "No se pudo guardar la configuración de garantías" }, { status: 500 })
    }

    // La tarjeta "Garantías por vencer" del dashboard está cacheada: con otra
    // ventana tiene que contar de nuevo.
    revalidateTag("dashboard", "max")

    return NextResponse.json(await leerConfigGarantias(organizationId!))
  } catch (err) {
    console.error("Error guardando la configuración de garantías:", err)
    return NextResponse.json({ error: "No se pudo guardar la configuración de garantías" }, { status: 500 })
  }
}
