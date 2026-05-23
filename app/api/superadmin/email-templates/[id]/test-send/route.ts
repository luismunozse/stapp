import { NextRequest, NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { getLifecycleEmail, type LifecycleEmailType } from "@/lib/emails/lifecycle-templates"
import { EMAIL_SAMPLE_DATA, LIFECYCLE_TEMPLATE_TYPES, interpolateSample } from "@/lib/emails/sample-data"

const ENVIALOSIMPLE_API_URL = "https://backend.envialosimple.email/api/v1/mail/send"
const EMAIL_FROM = process.env.EMAIL_FROM || "noreply@stapp.com.ar"

/**
 * Envía el template (estado actual en DB) por mail a un destinatario de prueba.
 * Body: { to: "email@x.com" }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { error: authErr } = await requireSuperadmin()
    if (authErr) return authErr

    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const { to } = body as { to?: string }

    if (!to || typeof to !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return NextResponse.json({ error: "Destinatario inválido" }, { status: 400 })
    }

    const apiKey = process.env.ENVIALOSIMPLE_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: "ENVIALOSIMPLE_API_KEY no configurada" }, { status: 500 })
    }

    const { data: row, error } = await supabaseAdmin
      .from("email_templates")
      .select("type, subject, html_body")
      .eq("id", id)
      .maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!row) return NextResponse.json({ error: "No encontrado" }, { status: 404 })

    let subject = ""
    let html = ""

    if (row.html_body && row.html_body.trim() !== "") {
      subject = interpolateSample(row.subject || "")
      html = interpolateSample(row.html_body)
    } else if (LIFECYCLE_TEMPLATE_TYPES.has(row.type)) {
      const hard = getLifecycleEmail(row.type as LifecycleEmailType, EMAIL_SAMPLE_DATA)
      subject = hard.subject
      html = hard.html
    } else {
      return NextResponse.json(
        { error: "Sin cuerpo y sin fallback hardcoded. Guardá un cuerpo antes." },
        { status: 400 }
      )
    }

    const res = await fetch(ENVIALOSIMPLE_API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: EMAIL_FROM, to, subject: `[TEST] ${subject}`, html }),
    })

    if (!res.ok) {
      const errBody = await res.text().catch(() => "")
      return NextResponse.json(
        { error: `Envío falló (${res.status}): ${errBody.slice(0, 300)}` },
        { status: 502 }
      )
    }

    return NextResponse.json({ success: true, to, subject })
  } catch (err) {
    console.error("Error test-send:", err)
    return NextResponse.json({ error: "Error" }, { status: 500 })
  }
}
