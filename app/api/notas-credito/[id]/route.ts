import { NextResponse } from "next/server"
import { requireAdmin, requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { cargarDocumentoNC, NC_NO_ENCONTRADA } from "@/lib/notas-credito/documento"

/**
 * GET /api/notas-credito/[id] — el documento de una NC de cualquiera de los
 * dos motores: lo usan el ticket y el envío por WhatsApp. Lo ve quien ve la
 * operación de origen (ver lib/notas-credito/documento.ts).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role, session } = await requireAuth()
    if (error) return error

    const { id } = await params
    const documento = await cargarDocumentoNC(id, {
      organizationId: organizationId!,
      userId: userId!,
      role,
      userSucursalId: session!.user.sucursalId ?? null,
    })
    if (!documento) return NextResponse.json({ error: NC_NO_ENCONTRADA }, { status: 404 })

    return NextResponse.json(documento, { headers: { "Cache-Control": "no-store" } })
  } catch (err) {
    console.error("Error leyendo nota de credito:", err)
    return NextResponse.json({ error: "Error al obtener la nota de crédito" }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const { searchParams } = new URL(request.url)
    const motivo = searchParams.get("motivo") || "Anulada por administrador"

    const { data: nc } = await supabaseAdmin
      .from("notas_credito")
      .select("id, anulada")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (!nc) return NextResponse.json({ error: "NC no encontrada" }, { status: 404 })
    if (nc.anulada) return NextResponse.json({ error: "Ya anulada" }, { status: 400 })

    await supabaseAdmin
      .from("notas_credito")
      .update({
        anulada: true,
        anulada_at: new Date().toISOString(),
        anulada_por: userId!,
        anulada_motivo: motivo,
      })
      .eq("id", id)

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("Error anulando NC:", err)
    return NextResponse.json({ error: "Error" }, { status: 500 })
  }
}
