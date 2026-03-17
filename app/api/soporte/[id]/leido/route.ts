import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id } = await params

    // Verificar que el ticket pertenece a la org
    const { data: ticket, error: fetchError } = await supabaseAdmin
      .from("support_tickets")
      .select("id")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (fetchError || !ticket) {
      return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 })
    }

    // Marcar como leídos los mensajes del SUPERADMIN que aún no fueron leídos
    const { error: updateError } = await supabaseAdmin
      .from("support_ticket_messages")
      .update({ leido_at: new Date().toISOString() })
      .eq("ticket_id", id)
      .eq("autor_tipo", "SUPERADMIN")
      .is("leido_at", null)

    if (updateError) throw updateError

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Error marking messages as read:", error)
    return NextResponse.json(
      { error: "Error al marcar mensajes como leídos" },
      { status: 500 }
    )
  }
}
