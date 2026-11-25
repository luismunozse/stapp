import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth } from "@/lib/auth-utils"
import { actorDeSesion, cargarOrdenEnAlcance } from "@/lib/ordenes/alcance"
import { supabaseAdmin } from "@/lib/supabase"
import {
  SESION_CARGA_MAX_FOTOS,
  SESION_CARGA_MINUTOS,
  generarTokenCarga,
  hashTokenCarga,
} from "@/lib/fotos/carga-sesion"
import { reportarError } from "@/lib/api-error"

// Enlace temporal (QR) para subir fotos de la orden desde el celular sin
// iniciar sesión ahí. El token solo viaja en la respuesta del POST: en la base
// queda el hash (migración 413).

const crearSchema = z.object({
  tipo: z.enum(["INGRESO", "DIAGNOSTICO", "COMPONENTE", "REPARACION", "ENTREGA"]).default("REPARACION"),
})

// POST - Genera el enlace. Requiere el mismo permiso que subir una foto.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const autenticado = await requireAuth()
    const { error, organizationId, userId } = autenticado
    if (error) return error

    const { id: ordenId } = await params

    const cargada = await cargarOrdenEnAlcance(ordenId, actorDeSesion(autenticado), "reparar", { select: "id" })
    if ("error" in cargada) return cargada.error

    const { tipo } = crearSchema.parse(await request.json().catch(() => ({})))

    // Un enlace vivo por usuario y orden: generar otro invalida el anterior.
    const ahora = new Date()
    await supabaseAdmin
      .from("foto_carga_sesiones")
      .update({ revoked_at: ahora.toISOString() })
      .eq("orden_id", ordenId)
      .eq("created_by", userId!)
      .is("revoked_at", null)

    // Limpieza oportunista de las sesiones viejas de la organización.
    await supabaseAdmin
      .from("foto_carga_sesiones")
      .delete()
      .eq("organization_id", organizationId!)
      .lt("expires_at", new Date(ahora.getTime() - 60 * 60 * 1000).toISOString())

    const token = generarTokenCarga()
    const expiresAt = new Date(ahora.getTime() + SESION_CARGA_MINUTOS * 60 * 1000)

    const { data: sesion, error: dbError } = await supabaseAdmin
      .from("foto_carga_sesiones")
      .insert({
        organization_id: organizationId!,
        orden_id: ordenId,
        token_hash: hashTokenCarga(token),
        tipo,
        max_fotos: SESION_CARGA_MAX_FOTOS,
        created_by: userId!,
        expires_at: expiresAt.toISOString(),
      })
      .select("id")
      .single()

    if (dbError) throw dbError

    return NextResponse.json(
      {
        sesionId: sesion.id,
        token,
        expiresAt: expiresAt.toISOString(),
        maxFotos: SESION_CARGA_MAX_FOTOS,
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0].message }, { status: 400 })
    }
    console.error("Error creando sesión de carga de fotos:", error)
    return NextResponse.json({ error: "No se pudo generar el enlace" }, { status: 500 })
  }
}

// GET - Estado del enlace (?sesion=id): cuántas fotos llegaron y si sigue vivo.
// La PC lo consulta mientras muestra el QR.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const autenticado = await requireAuth()
    const { error } = autenticado
    if (error) return error

    const { id: ordenId } = await params

    const cargada = await cargarOrdenEnAlcance(ordenId, actorDeSesion(autenticado), "ver", { select: "id" })
    if ("error" in cargada) return cargada.error

    const sesionId = new URL(request.url).searchParams.get("sesion")
    if (!sesionId) {
      return NextResponse.json({ error: "Sesión requerida" }, { status: 400 })
    }

    const { data: sesion } = await supabaseAdmin
      .from("foto_carga_sesiones")
      .select("fotos_subidas, max_fotos, expires_at, revoked_at")
      .eq("id", sesionId)
      .eq("orden_id", ordenId)
      .maybeSingle()

    if (!sesion) {
      return NextResponse.json({ error: "Enlace no encontrado" }, { status: 404 })
    }

    return NextResponse.json({
      fotosSubidas: sesion.fotos_subidas,
      maxFotos: sesion.max_fotos,
      expiresAt: sesion.expires_at,
      activa:
        !sesion.revoked_at &&
        new Date(sesion.expires_at).getTime() > Date.now() &&
        sesion.fotos_subidas < sesion.max_fotos,
    })
  } catch (error) {
    console.error("Error consultando sesión de carga de fotos:", error)
    reportarError(error, { ruta: "/api/ordenes/[id]/fotos/sesion-celular" })
    return NextResponse.json({ error: "Error al consultar el enlace" }, { status: 500 })
  }
}

// DELETE - Invalida el enlace (?sesion=id) al cerrar el QR.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const autenticado = await requireAuth()
    const { error } = autenticado
    if (error) return error

    const { id: ordenId } = await params

    const cargada = await cargarOrdenEnAlcance(ordenId, actorDeSesion(autenticado), "reparar", { select: "id" })
    if ("error" in cargada) return cargada.error

    const sesionId = new URL(request.url).searchParams.get("sesion")
    if (!sesionId) {
      return NextResponse.json({ error: "Sesión requerida" }, { status: 400 })
    }

    const { error: dbError } = await supabaseAdmin
      .from("foto_carga_sesiones")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", sesionId)
      .eq("orden_id", ordenId)
      .is("revoked_at", null)

    if (dbError) throw dbError

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Error revocando sesión de carga de fotos:", error)
    reportarError(error, { ruta: "/api/ordenes/[id]/fotos/sesion-celular" })
    return NextResponse.json({ error: "Error al cerrar el enlace" }, { status: 500 })
  }
}
