import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import {
  SESION_CARGA_MAX_FOTOS,
  SESION_CARGA_MINUTOS,
  generarTokenCarga,
  hashTokenCarga,
} from "@/lib/fotos/carga-sesion"

// Enlace temporal (QR) para sacar fotos con el celular mientras se carga una
// orden NUEVA en la PC. Como la orden todavía no existe, las fotos quedan en
// tránsito (migración 414) y este endpoint se las entrega al formulario que
// mostró el QR; se guardan en la orden recién cuando se crea, por el camino
// de siempre. La sesión es de quien la creó: nadie más puede leerla.

/** Sesión sin orden, de esta organización y de este usuario. */
function sesionPropia(sesionId: string, organizationId: string, userId: string) {
  return supabaseAdmin
    .from("foto_carga_sesiones")
    .select("id, fotos_subidas, max_fotos, expires_at, revoked_at")
    .eq("id", sesionId)
    .eq("organization_id", organizationId)
    .eq("created_by", userId)
    .is("orden_id", null)
    .maybeSingle()
}

// POST - Genera el enlace.
export async function POST() {
  try {
    const { error, organizationId, userId } = await requireAuth()
    if (error) return error

    const ahora = new Date()

    // Limpieza oportunista: las sesiones viejas de la organización (y sus
    // fotos en tránsito, por cascada) no tienen por qué quedar guardadas.
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
        orden_id: null,
        token_hash: hashTokenCarga(token),
        tipo: "INGRESO",
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
    console.error("Error creando sesión de carga de fotos:", error)
    return NextResponse.json({ error: "No se pudo generar el enlace" }, { status: 500 })
  }
}

// GET - Estado del enlace (?sesion=id) y, si hay, la foto en tránsito más
// vieja. De a una por respuesta: varias juntas pasarían el tope de tamaño.
// `recibida=<id>` confirma la entrega anterior y la borra: una respuesta que
// se pierde en el camino no pierde la foto.
export async function GET(request: Request) {
  try {
    const { error, organizationId, userId } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const sesionId = searchParams.get("sesion")
    if (!sesionId) {
      return NextResponse.json({ error: "Sesión requerida" }, { status: 400 })
    }

    const { data: sesion } = await sesionPropia(sesionId, organizationId!, userId!)
    if (!sesion) {
      return NextResponse.json({ error: "Enlace no encontrado" }, { status: 404 })
    }

    const recibida = searchParams.get("recibida")
    if (recibida) {
      await supabaseAdmin
        .from("foto_carga_pendientes")
        .delete()
        .eq("id", recibida)
        .eq("sesion_id", sesion.id)
    }

    const { data: pendientes, count } = await supabaseAdmin
      .from("foto_carga_pendientes")
      .select("id, mime, data", { count: "exact" })
      .eq("sesion_id", sesion.id)
      .order("created_at", { ascending: true })
      .limit(1)

    const foto = pendientes?.[0] ?? null

    return NextResponse.json({
      fotosSubidas: sesion.fotos_subidas,
      maxFotos: sesion.max_fotos,
      expiresAt: sesion.expires_at,
      activa:
        !sesion.revoked_at &&
        new Date(sesion.expires_at).getTime() > Date.now() &&
        sesion.fotos_subidas < sesion.max_fotos,
      foto,
      pendientes: count ?? (foto ? 1 : 0),
    })
  } catch (error) {
    console.error("Error consultando sesión de carga de fotos:", error)
    return NextResponse.json({ error: "Error al consultar el enlace" }, { status: 500 })
  }
}

// DELETE - Invalida el enlace (?sesion=id) al cerrar el QR y descarta lo que
// haya quedado en tránsito.
export async function DELETE(request: Request) {
  try {
    const { error, organizationId, userId } = await requireAuth()
    if (error) return error

    const sesionId = new URL(request.url).searchParams.get("sesion")
    if (!sesionId) {
      return NextResponse.json({ error: "Sesión requerida" }, { status: 400 })
    }

    const { data: sesion } = await sesionPropia(sesionId, organizationId!, userId!)
    if (!sesion) return NextResponse.json({ ok: true })

    const { error: dbError } = await supabaseAdmin
      .from("foto_carga_sesiones")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", sesion.id)
      .is("revoked_at", null)
    if (dbError) throw dbError

    await supabaseAdmin.from("foto_carga_pendientes").delete().eq("sesion_id", sesion.id)

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Error revocando sesión de carga de fotos:", error)
    return NextResponse.json({ error: "Error al cerrar el enlace" }, { status: 500 })
  }
}
