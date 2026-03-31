import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"
import { sendNewLeadNotification } from "@/lib/email"

const leadCaptureSchema = z.object({
  sessionId: z.string().min(1, "Session ID es requerido"),
  conversacionId: z.string().min(1, "Conversación ID es requerido"),
  nombre: z.string().optional(),
  email: z.string().email("Email inválido").optional(),
  telefono: z.string().optional(),
  empresa: z.string().optional(),
  interes: z.string().optional(),
  planInteres: z.string().optional(),
})

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const data = leadCaptureSchema.parse(body)

    // Validar que al menos tenga email o teléfono
    if (!data.email && !data.telefono) {
      return NextResponse.json(
        { error: "Debés proporcionar al menos un email o teléfono" },
        { status: 400 }
      )
    }

    // Verificar que la conversación existe y pertenece a la sesión
    const { data: conversacion } = await supabaseAdmin
      .from("chatbot_conversaciones")
      .select("*")
      .eq("id", data.conversacionId)
      .eq("session_id", data.sessionId)
      .single()

    if (!conversacion) {
      return NextResponse.json(
        { error: "Conversación no encontrada" },
        { status: 404 }
      )
    }

    // Verificar si ya existe un lead para esta conversación
    if (conversacion.lead_id) {
      // Actualizar el lead existente con nueva información (solo campos no vacíos)
      const updateFields: Record<string, string | null> = {}
      if (data.nombre) updateFields.nombre = data.nombre
      if (data.email) updateFields.email = data.email
      if (data.telefono) updateFields.telefono = data.telefono
      if (data.empresa) updateFields.empresa = data.empresa
      if (data.interes) updateFields.interes = data.interes
      if (data.planInteres) updateFields.plan_interes = data.planInteres

      if (Object.keys(updateFields).length === 0) {
        return NextResponse.json({ success: true, leadId: conversacion.lead_id, message: "Sin datos nuevos" })
      }

      const { data: leadExistente, error: updateError } = await supabaseAdmin
        .from("leads")
        .update(updateFields)
        .eq("id", conversacion.lead_id)
        .select()
        .single()

      if (updateError) throw updateError

      return NextResponse.json({
        success: true,
        leadId: leadExistente.id,
        message: "Lead actualizado correctamente",
      })
    }

    // Buscar lead existente por email o teléfono (deduplicación)
    let existingLead = null
    if (data.email) {
      const { data: byEmail } = await supabaseAdmin
        .from("leads")
        .select("id")
        .eq("email", data.email)
        .limit(1)
        .single()
      existingLead = byEmail
    }
    if (!existingLead && data.telefono) {
      const { data: byPhone } = await supabaseAdmin
        .from("leads")
        .select("id")
        .eq("telefono", data.telefono)
        .limit(1)
        .single()
      existingLead = byPhone
    }

    if (existingLead) {
      // Actualizar lead existente y vincular a esta conversación
      const updateFields: Record<string, string | null> = {}
      if (data.nombre) updateFields.nombre = data.nombre
      if (data.email) updateFields.email = data.email
      if (data.telefono) updateFields.telefono = data.telefono
      if (data.empresa) updateFields.empresa = data.empresa
      if (data.interes) updateFields.interes = data.interes
      if (data.planInteres) updateFields.plan_interes = data.planInteres

      if (Object.keys(updateFields).length > 0) {
        await supabaseAdmin.from("leads").update(updateFields).eq("id", existingLead.id)
      }

      await supabaseAdmin
        .from("chatbot_conversaciones")
        .update({ lead_id: existingLead.id, lead_capturado: true })
        .eq("id", data.conversacionId)

      return NextResponse.json({
        success: true,
        leadId: existingLead.id,
        message: "Lead existente vinculado y actualizado",
      })
    }

    // Crear nuevo lead
    const { data: lead, error: leadError } = await supabaseAdmin
      .from("leads")
      .insert({
        nombre: data.nombre || null,
        email: data.email || null,
        telefono: data.telefono || null,
        empresa: data.empresa || null,
        estado: "NUEVO",
        origen: "CHATBOT",
        interes: data.interes || null,
        plan_interes: data.planInteres || null,
      })
      .select()
      .single()

    if (leadError) throw leadError

    // Actualizar conversación con el lead_id
    await supabaseAdmin
      .from("chatbot_conversaciones")
      .update({
        lead_id: lead.id,
        lead_capturado: true,
      })
      .eq("id", data.conversacionId)

    // Enviar notificación por email al admin (no bloquear la respuesta)
    sendNewLeadNotification({
      nombre: data.nombre,
      email: data.email,
      telefono: data.telefono,
      empresa: data.empresa,
      interes: data.interes,
      origen: "Chatbot",
    }).catch((err) => console.error("[Lead] Error enviando notificación:", err))

    return NextResponse.json({
      success: true,
      leadId: lead.id,
      message: "Lead capturado exitosamente",
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error capturando lead:", error)
    return NextResponse.json(
      { error: "Error al capturar lead. Por favor intentá de nuevo." },
      { status: 500 }
    )
  }
}
