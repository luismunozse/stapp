import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

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
