import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sendAdminEmail } from "@/lib/email"
import { EmailSuprimidoError } from "@/lib/email/index"
import { persistentRateLimit } from "@/lib/rate-limit"

/** Cupo diario de correos manuales por organización. */
const MAX_EMAILS_POR_DIA = 50
const UN_DIA_SEGUNDOS = 24 * 60 * 60

// Una sola línea: el asunto y el nombre terminan en cabeceras del correo.
const unaLinea = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !/[\r\n]/.test(v), "No puede contener saltos de línea")

const bodySchema = z.object({
  destinatarioEmail: z.string().trim().email().max(254),
  destinatarioNombre: unaLinea(150).optional().nullable(),
  destinatarioTipo: z.string().max(50).optional().nullable(),
  destinatarioId: z.string().max(100).optional().nullable(),
  asunto: unaLinea(150).pipe(z.string().min(1)),
  contenido: z.string().trim().min(1).max(10_000),
})

export async function POST(request: Request) {
  try {
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const parsed = bodySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Datos inválidos: revisá el email, el asunto (máx. 150 caracteres) y el contenido (máx. 10.000)" },
        { status: 400 }
      )
    }
    const { destinatarioEmail, destinatarioNombre, destinatarioTipo, destinatarioId, asunto, contenido } = parsed.data

    const limite = await persistentRateLimit(organizationId!, "emails:send", MAX_EMAILS_POR_DIA, UN_DIA_SEGUNDOS)
    if (!limite.success) {
      return NextResponse.json(
        { error: `Alcanzaste el límite de ${MAX_EMAILS_POR_DIA} emails por día. Probá de nuevo mañana.` },
        { status: 429 }
      )
    }

    // Obtener nombre de la organización
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("nombre")
      .eq("id", organizationId!)
      .single()

    const nombreOrganizacion = org?.nombre || "Mi Negocio"

    const historial = {
      organization_id: organizationId!,
      sent_by: userId!,
      destinatario_email: destinatarioEmail,
      destinatario_nombre: destinatarioNombre || null,
      destinatario_tipo: destinatarioTipo || null,
      destinatario_id: destinatarioId || null,
      asunto,
      contenido,
    }

    // Enviar email
    try {
      await sendAdminEmail({
        to: destinatarioEmail,
        nombreDestinatario: destinatarioNombre || destinatarioEmail,
        asunto,
        contenido,
        nombreOrganizacion,
      })

      await supabaseAdmin.from("admin_emails").insert({ ...historial, estado: "ENVIADO" })

      return NextResponse.json({ message: "Email enviado correctamente" })
    } catch (sendError: any) {
      await supabaseAdmin.from("admin_emails").insert({
        ...historial,
        estado: "ERROR",
        error_message: sendError?.message || "Error desconocido",
      })

      if (sendError instanceof EmailSuprimidoError) {
        return NextResponse.json(
          { error: "Esa dirección no acepta correos (rebotó o se dio de baja). Verificá el email del destinatario." },
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
