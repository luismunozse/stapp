import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const { id } = await params

    // Verificar que el ticket existe
    const { data: ticket, error: fetchError } = await supabaseAdmin
      .from("support_tickets")
      .select("id")
      .eq("id", id)
      .single()

    if (fetchError || !ticket) {
      return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 })
    }

    // Marcar como leídos los mensajes del USUARIO que aún no fueron leídos
    const { error: updateError } = await supabaseAdmin
      .from("support_ticket_messages")
      .update({ leido_at: new Date().toISOString() })
      .eq("ticket_id", id)
      .eq("autor_tipo", "USUARIO")
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
