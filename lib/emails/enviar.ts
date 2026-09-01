import { supabaseAdmin } from "@/lib/supabase"

// Valores identicos a los de app/api/cron/lifecycle-emails/route.ts: no se
// migran los crons existentes a este modulo, pero el envio nuevo tiene que
// pegarle al mismo proveedor con el mismo remitente.
const ENVIALOSIMPLE_API_URL = "https://backend.envialosimple.email/api/v1/mail/send"
const EMAIL_FROM = process.env.EMAIL_FROM || "noreply@stapp.com.ar"

/** Devuelve true si el proveedor acepto el envio. Nunca lanza. */
export async function enviarEmail(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = process.env.ENVIALOSIMPLE_API_KEY
  if (!apiKey) return false
  try {
    const res = await fetch(ENVIALOSIMPLE_API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: EMAIL_FROM, to, subject, html }),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Idempotencia: una organizacion recibe cada email_type una sola vez. */
export async function yaSeEnvio(orgId: string, emailType: string): Promise<boolean> {
  const { count } = await supabaseAdmin
    .from("lifecycle_emails")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("email_type", emailType)
    .eq("status", "SENT")
  return (count || 0) > 0
}

export async function registrarEnvio(
  orgId: string,
  emailType: string,
  status: "SENT" | "FAILED",
  userId?: string
): Promise<void> {
  await supabaseAdmin.from("lifecycle_emails").insert({
    organization_id: orgId,
    user_id: userId || null,
    email_type: emailType,
    status,
  })
}
