import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { createSuperadminAuditLogger } from "@/lib/superadmin-audit"
import { safeParseBody } from "@/lib/api-utils"
import { sendSupportReplyEmail } from "@/lib/email"
import { BETA_ASUNTO_CONTACTO, contactarSchema } from "@/lib/android-beta"

interface FilaContacto {
  id: string
  user_id: string
  organization_id: string
  users: { nombre: string; email: string } | null
  organizations: { nombre: string; slug: string } | null
}

/**
 * Le escribe a un inscripto por el chat de soporte. Si ya hay una conversacion
 * de la beta abierta con ese usuario, el mensaje va ahi; si no, se crea una.
 * El usuario la ve en /soporte y recibe el aviso por mail.
 */
export async function POST(request: Request) {
  const { error, email } = await requireSuperadmin()
  if (error) return error

  const parsed = await safeParseBody(request, contactarSchema)
  if ("error" in parsed) return parsed.error
  const { id, mensaje } = parsed.data

  const { data: fila, error: filaError } = await supabaseAdmin
    .from("android_beta_testers")
    .select("id, user_id, organization_id, users(nombre, email), organizations(nombre, slug)")
    .eq("id", id)
    .maybeSingle()

  if (filaError) {
    console.error("[superadmin/beta-android/contactar] inscripto", filaError)
    return NextResponse.json({ error: "Error al buscar el inscripto" }, { status: 500 })
  }
  if (!fila) {
    return NextResponse.json({ error: "Inscripto no encontrado" }, { status: 404 })
  }
  const tester = fila as unknown as FilaContacto

  const { data: abierto, error: buscarError } = await supabaseAdmin
    .from("support_tickets")
    .select("id")
    .eq("user_id", tester.user_id)
    .eq("asunto", BETA_ASUNTO_CONTACTO)
    .neq("estado", "CERRADO")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (buscarError) {
    console.error("[superadmin/beta-android/contactar] buscar ticket", buscarError)
    return NextResponse.json({ error: "Error al buscar la conversación" }, { status: 500 })
  }

  let ticketId = (abierto as { id: string } | null)?.id ?? null
  const nuevo = !ticketId

  if (!ticketId) {
    const { data: creado, error: crearError } = await supabaseAdmin
      .from("support_tickets")
      .insert({
        organization_id: tester.organization_id,
        user_id: tester.user_id,
        tipo: "PREGUNTA",
        prioridad: "BAJA",
        asunto: BETA_ASUNTO_CONTACTO,
        descripcion: "Conversación iniciada por soporte por la beta de Android.",
        // Arranca con un mensaje de soporte: del lado del superadmin no hay
        // nada que responder todavia.
        estado: "EN_PROCESO",
      })
      .select("id")
      .single()

    if (crearError || !creado) {
      console.error("[superadmin/beta-android/contactar] crear ticket", crearError)
      return NextResponse.json({ error: "Error al abrir la conversación" }, { status: 500 })
    }
    ticketId = (creado as { id: string }).id
  }

  const { error: msgError } = await supabaseAdmin.from("support_ticket_messages").insert({
    ticket_id: ticketId,
    autor_tipo: "SUPERADMIN",
    autor_id: email!,
    autor_nombre: "Soporte STApp",
    contenido: mensaje,
  })

  if (msgError) {
    console.error("[superadmin/beta-android/contactar] mensaje", msgError)
    return NextResponse.json({ error: "Error al enviar el mensaje" }, { status: 500 })
  }

  createSuperadminAuditLogger(email, request)
    .ticketReply(ticketId, tester.organizations?.nombre ?? "")
    .catch(() => {})

  if (tester.users?.email) {
    sendSupportReplyEmail({
      email: tester.users.email,
      nombreUsuario: tester.users.nombre || "Usuario",
      asuntoTicket: BETA_ASUNTO_CONTACTO,
      contenidoRespuesta: mensaje,
      ticketId,
      slug: tester.organizations?.slug || "",
    }).catch((err) => {
      console.error("[superadmin/beta-android/contactar] email", err)
    })
  }

  return NextResponse.json({ ticketId, nuevo }, { status: 201 })
}
