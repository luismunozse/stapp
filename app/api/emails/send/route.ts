import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sendAdminEmail } from "@/lib/email"
import { EmailSuprimidoError, replyToDelTaller } from "@/lib/email/index"

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
      .select("nombre, nombre_mostrar, email")
      .eq("id", organizationId!)
      .single()

    // Mismo nombre visible que usan cotizaciones y notificaciones.
    const nombreOrganizacion = org?.nombre_mostrar || org?.nombre || "Mi Negocio"

    // Enviar email
    try {
      await sendAdminEmail({
        to: destinatarioEmail,
        nombreDestinatario: destinatarioNombre || destinatarioEmail,
        asunto,
        contenido,
        nombreOrganizacion,
        replyTo: replyToDelTaller(org?.email),
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
      // Destinatario suprimido (rebote o queja): no es una falla del servidor,
      // se le explica al taller y queda asentado en el historial.
      const suprimido = sendError instanceof EmailSuprimidoError

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
        error_message: suprimido
          ? "Dirección bloqueada: rebotó o marcó un envío anterior como no deseado"
          : sendError.message || "Error desconocido",
      })

      if (suprimido) {
        return NextResponse.json(
          {
            error:
              "No se puede enviar a este correo: la dirección rebotó o marcó un envío anterior como no deseado, y está bloqueada para proteger la entrega. Use otra dirección de correo o contacte al destinatario por WhatsApp.",
          },
          { status: 422 }
        )
      }

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
