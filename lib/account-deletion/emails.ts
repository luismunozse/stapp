import { supabaseAdmin } from "@/lib/supabase"
import { sendPlatform } from "@/lib/email/index"
import { CONTACT_EMAIL } from "@/lib/contact"
import { DEFAULT_TIMEZONE } from "@/lib/timezone"
import { GRACE_DAYS } from "./state"

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

// User-supplied text in a subject must not carry CR/LF or other control chars
// (header injection). Subjects are plain text, so no HTML escaping here.
function cleanSubject(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim()
}

// getBaseTemplate (lib/email.ts) is not exported: minimal own HTML.
function shell(titulo: string, cuerpo: string): string {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f3f4f6;">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;">
<h1 style="font-size:20px;color:#1f2937;margin:0 0 16px;">${escapeHtml(titulo)}</h1>
${cuerpo}
<p style="color:#9ca3af;font-size:12px;margin:24px 0 0;">Este correo fue enviado automáticamente por STApp.</p>
</div></body></html>`
}

const p = (s: string) => `<p style="color:#4b5563;font-size:15px;line-height:1.5;margin:0 0 12px;">${s}</p>`

function formatDate(d: Date): string {
  return d.toLocaleDateString("es-AR", { timeZone: DEFAULT_TIMEZONE, day: "numeric", month: "long", year: "numeric" })
}

export function buildUserDeletedEmail(x: { nombre: string; email: string; rol: string }) {
  const nombre = escapeHtml(x.nombre)
  return {
    subject: `Un usuario de tu taller se dio de baja: ${cleanSubject(x.nombre)}`,
    html: shell(
      "Un usuario se dio de baja",
      p(`<strong>${nombre}</strong> (${escapeHtml(x.email)}, rol ${escapeHtml(x.rol)}) eliminó su cuenta de STApp.`) +
        p(`Sus operaciones registradas se conservan y quedan firmadas como "Usuario eliminado". Sus datos personales se anonimizan a los ${GRACE_DAYS} días.`) +
        p(`Si fue un error, escribí a ${escapeHtml(CONTACT_EMAIL)} antes de ese plazo.`)
    ),
  }
}

export function buildOrgDeletedEmail(x: { orgNombre: string; solicitante: string; borradoDefinitivo: Date }) {
  return {
    subject: `Se pidió eliminar el taller ${cleanSubject(x.orgNombre)}`,
    html: shell(
      "Eliminación de taller solicitada",
      p(`<strong>${escapeHtml(x.solicitante)}</strong> pidió eliminar el taller <strong>${escapeHtml(x.orgNombre)}</strong>.`) +
        p(`El acceso se desactivó y la suscripción se canceló. Vas a poder revertirlo hasta el <strong>${escapeHtml(formatDate(x.borradoDefinitivo))}</strong>: después de esa fecha todos los datos se borran de forma definitiva, sin posibilidad de recuperarlos.`) +
        p(`Para revertirlo escribí a ${escapeHtml(CONTACT_EMAIL)}.`) +
        p("Conservar la documentación fiscal emitida es obligación del taller. Si todavía no descargaste tu respaldo, pedí la restauración para hacerlo.")
    ),
  }
}

async function adminEmails(organizationId: string, excludeUserId?: string): Promise<string[]> {
  let q = supabaseAdmin
    .from("users")
    .select("email")
    .eq("organization_id", organizationId)
    .eq("rol", "ADMIN")
    .is("deleted_at", null)
  if (excludeUserId) q = q.neq("id", excludeUserId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []).map((r: { email: string }) => r.email).filter(Boolean)
}

async function sendAll(emails: string[], msg: { subject: string; html: string }) {
  const results = await Promise.allSettled(emails.map((to) => sendPlatform({ to, subject: msg.subject, html: msg.html })))
  for (const r of results) {
    if (r.status === "rejected") console.error("[account-deletion] fallo el envio de un aviso:", r.reason)
  }
}

export async function notifyAdminsUserDeleted(x: {
  organizationId: string
  userId: string
  nombre: string
  email: string
  rol: string
}): Promise<void> {
  try {
    await sendAll(await adminEmails(x.organizationId, x.userId), buildUserDeletedEmail(x))
  } catch (err) {
    console.error("[account-deletion] no se pudo avisar la baja del usuario:", err)
  }
}

export async function notifyAdminsOrgDeleted(x: {
  organizationId: string
  orgNombre: string
  solicitante: string
  borradoDefinitivo: Date
}): Promise<void> {
  try {
    await sendAll(await adminEmails(x.organizationId), buildOrgDeletedEmail(x))
  } catch (err) {
    console.error("[account-deletion] no se pudo avisar la baja del taller:", err)
  }
}
