import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sendAdminEmail } from "@/lib/email"

export async function POST(request: Request) {
  try {
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const body = await request.json()
    const { destinatarioEmail, destinatarioNombre, destinatarioTipo, destinatarioId, asunto, contenido } = body

    if (!destinatarioEmail || !asunto || !contenido) {
      return NextResponse.json(
        { error: "Email, asunto y contenido son requeridos" },
        { status: 400 }
      )
    }

    // Obtener nombre de la organización
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("nombre")
      .eq("id", organizationId!)
      .single()

    const nombreOrganizacion = org?.nombre || "Mi Negocio"

    // Enviar email
    try {
      await sendAdminEmail({
        to: destinatarioEmail,
        nombreDestinatario: destinatarioNombre || destinatarioEmail,
        asunto,
        contenido,
        nombreOrganizacion,
      })

      // Registrar en historial
      await supabaseAdmin.from("admin_emails").insert({
        organization_id: organizationId!,
        sent_by: userId!,
        destinatario_email: destinatarioEmail,
        destinatario_nombre: destinatarioNombre || null,
        destinatario_tipo: destinatarioTipo || null,
        destinatario_id: destinatarioId || null,
        asunto,
        contenido,
        estado: "ENVIADO",
      })

      return NextResponse.json({ message: "Email enviado correctamente" })
    } catch (sendError: any) {
      // Registrar el error en historial
      await supabaseAdmin.from("admin_emails").insert({
        organization_id: organizationId!,
        sent_by: userId!,
        destinatario_email: destinatarioEmail,
        destinatario_nombre: destinatarioNombre || null,
        destinatario_tipo: destinatarioTipo || null,
        destinatario_id: destinatarioId || null,
        asunto,
        contenido,
        estado: "ERROR",
        error_message: sendError.message || "Error desconocido",
      })

      return NextResponse.json(
        { error: "Error al enviar el email. Se registró en el historial." },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error("Error sending admin email:", error)
    return NextResponse.json(
      { error: "Error al enviar email" },
      { status: 500 }
    )
  }
}
