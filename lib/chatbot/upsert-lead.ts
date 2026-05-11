import { supabaseAdmin } from "@/lib/supabase"
import { sendNewLeadNotification } from "@/lib/email"

export interface LeadUpsertData {
  nombre?: string | null
  email?: string | null
  telefono?: string | null
  empresa?: string | null
  interes?: string | null
  planInteres?: string | null
  score?: number | null
  cantidadTecnicos?: number | null
  ciudad?: string | null
  sistemaActual?: string | null
  urgencia?: "alta" | "media" | "baja" | null
  resumen?: string | null
}

export interface UpsertLeadResult {
  leadId: string
  created: boolean
  updated: boolean
  notified: boolean
}

const NAME_BLACKLIST = new Set([
  "tecnico", "técnico", "tecnica", "técnica", "electricista", "dueño", "duenio",
  "vendedor", "vendedora", "administrador", "administradora", "comerciante",
  "estudiante", "freelance", "freelancer", "ingeniero", "ingeniera", "trabajador",
  "trabajadora", "empresario", "empresaria", "empleado", "empleada", "jefe", "jefa",
  "de", "del", "muy", "bastante", "el", "la", "un", "una", "los", "las", "ellos",
])

function sanitizeName(input: string | null | undefined): string | null {
  if (!input) return null
  const trimmed = input.trim()
  if (trimmed.length < 2 || trimmed.length > 80) return null
  const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase()
  if (!firstWord || NAME_BLACKLIST.has(firstWord)) return null
  return trimmed
}

function sanitizeEmail(input: string | null | undefined): string | null {
  if (!input) return null
  const trimmed = input.trim().toLowerCase()
  if (!/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(trimmed)) return null
  return trimmed
}

function sanitizePhone(input: string | null | undefined): string | null {
  if (!input) return null
  const digits = input.replace(/\D/g, "")
  if (digits.length < 8 || digits.length > 15) return null
  return digits
}

function sanitizeText(input: string | null | undefined, max = 200): string | null {
  if (!input) return null
  const trimmed = input.trim().slice(0, max)
  return trimmed.length > 0 ? trimmed : null
}

function sanitizeScore(input: number | null | undefined): number | null {
  if (input === null || input === undefined) return null
  if (!Number.isFinite(input)) return null
  return Math.max(0, Math.min(100, Math.round(input)))
}

function sanitizeTecnicos(input: number | null | undefined): number | null {
  if (input === null || input === undefined) return null
  if (!Number.isFinite(input) || input < 0 || input > 10000) return null
  return Math.round(input)
}

function sanitizeUrgencia(input: string | null | undefined): "alta" | "media" | "baja" | null {
  if (!input) return null
  const v = input.trim().toLowerCase()
  if (v === "alta" || v === "media" || v === "baja") return v
  return null
}

function buildUpdateFields(data: LeadUpsertData): Record<string, string | number | null> {
  const fields: Record<string, string | number | null> = {}
  const name = sanitizeName(data.nombre)
  const email = sanitizeEmail(data.email)
  const phone = sanitizePhone(data.telefono)
  const empresa = sanitizeText(data.empresa, 100)
  const interes = sanitizeText(data.interes, 200)
  const planInteres = sanitizeText(data.planInteres, 50)
  const score = sanitizeScore(data.score)
  const tecnicos = sanitizeTecnicos(data.cantidadTecnicos)
  const ciudad = sanitizeText(data.ciudad, 100)
  const sistemaActual = sanitizeText(data.sistemaActual, 100)
  const urgencia = sanitizeUrgencia(data.urgencia)
  const resumen = sanitizeText(data.resumen, 500)

  if (name) fields.nombre = name
  if (email) fields.email = email
  if (phone) fields.telefono = phone
  if (empresa) fields.empresa = empresa
  if (interes) fields.interes = interes
  if (planInteres) fields.plan_interes = planInteres
  if (score !== null) fields.score = score
  if (tecnicos !== null) fields.cantidad_tecnicos = tecnicos
  if (ciudad) fields.ciudad = ciudad
  if (sistemaActual) fields.sistema_actual = sistemaActual
  if (urgencia) fields.urgencia = urgencia
  if (resumen) fields.resumen_conversacion = resumen
  return fields
}

const CONTACT_FIELDS = ["nombre", "email", "telefono", "empresa"] as const

function hasContactField(fields: Record<string, unknown>): boolean {
  return CONTACT_FIELDS.some((f) => fields[f])
}

function notifyLead(data: LeadUpsertData, origen: string) {
  sendNewLeadNotification({
    nombre: data.nombre ?? undefined,
    email: data.email ?? undefined,
    telefono: data.telefono ?? undefined,
    empresa: data.empresa ?? undefined,
    interes: data.interes ?? undefined,
    origen,
  }).catch((err) => console.error("[upsertLead] notify failed:", err))
}


export async function upsertLeadFromConversation(
  conversacionId: string,
  sessionId: string,
  data: LeadUpsertData
): Promise<UpsertLeadResult | null> {
  const updateFields = buildUpdateFields(data)
  if (Object.keys(updateFields).length === 0) return null

  const { data: conversacion } = await supabaseAdmin
    .from("chatbot_conversaciones")
    .select("id, lead_id, session_id")
    .eq("id", conversacionId)
    .eq("session_id", sessionId)
    .maybeSingle()

  if (!conversacion) return null

  const stringField = (v: string | number | null | undefined): string | undefined =>
    typeof v === "string" ? v : undefined
  const sanitized: LeadUpsertData = {
    nombre: stringField(updateFields.nombre),
    email: stringField(updateFields.email),
    telefono: stringField(updateFields.telefono),
    empresa: stringField(updateFields.empresa),
    interes: stringField(updateFields.interes),
    planInteres: stringField(updateFields.plan_interes),
  }

  const newScore = typeof updateFields.score === "number" ? updateFields.score : null

  if (conversacion.lead_id) {
    const { data: previous } = await supabaseAdmin
      .from("leads")
      .select("score")
      .eq("id", conversacion.lead_id)
      .maybeSingle()
    const previousScore = (previous?.score as number | null | undefined) ?? null

    const finalUpdate: Record<string, string | number | boolean | null> = { ...updateFields }
    if (newScore !== null && previousScore !== null && newScore >= 80 && previousScore < 80) {
      finalUpdate.visto = false
    }

    const { data: updated, error } = await supabaseAdmin
      .from("leads")
      .update(finalUpdate)
      .eq("id", conversacion.lead_id)
      .select("id")
      .single()
    if (error) {
      console.error("[upsertLead] update failed:", error)
      return null
    }
    const newContact = Boolean(updateFields.email || updateFields.telefono)
    if (newContact) notifyLead(sanitized, "Chatbot (datos actualizados)")
    return { leadId: updated.id, created: false, updated: true, notified: newContact }
  }

  let existingLead: { id: string; score: number | null } | null = null
  if (updateFields.email) {
    const { data: byEmail } = await supabaseAdmin
      .from("leads")
      .select("id, score")
      .eq("email", updateFields.email)
      .limit(1)
      .maybeSingle()
    existingLead = byEmail as { id: string; score: number | null } | null
  }
  if (!existingLead && updateFields.telefono) {
    const { data: byPhone } = await supabaseAdmin
      .from("leads")
      .select("id, score")
      .eq("telefono", updateFields.telefono)
      .limit(1)
      .maybeSingle()
    existingLead = byPhone as { id: string; score: number | null } | null
  }

  if (existingLead) {
    const previousScore = existingLead.score ?? null
    const finalUpdate: Record<string, string | number | boolean | null> = { ...updateFields }
    if (newScore !== null && previousScore !== null && newScore >= 80 && previousScore < 80) {
      finalUpdate.visto = false
    }
    await supabaseAdmin.from("leads").update(finalUpdate).eq("id", existingLead.id)
    await supabaseAdmin
      .from("chatbot_conversaciones")
      .update({ lead_id: existingLead.id, lead_capturado: true })
      .eq("id", conversacionId)
    notifyLead(sanitized, "Chatbot (lead recurrente)")
    return { leadId: existingLead.id, created: false, updated: true, notified: true }
  }

  if (!hasContactField(updateFields)) {
    return null
  }

  const { data: lead, error: insertError } = await supabaseAdmin
    .from("leads")
    .insert({
      ...updateFields,
      estado: "NUEVO",
      origen: "CHATBOT",
    })
    .select("id")
    .single()

  if (insertError) {
    console.error("[upsertLead] insert failed:", insertError)
    return null
  }

  await supabaseAdmin
    .from("chatbot_conversaciones")
    .update({ lead_id: lead.id, lead_capturado: true })
    .eq("id", conversacionId)

  const notified = Boolean(updateFields.email || updateFields.telefono)
  if (notified) notifyLead(sanitized, "Chatbot")

  return { leadId: lead.id, created: true, updated: false, notified }
}
