import { NextRequest, NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { getLifecycleEmail, type LifecycleEmailType } from "@/lib/emails/lifecycle-templates"
import { EMAIL_SAMPLE_DATA, LIFECYCLE_TEMPLATE_TYPES, interpolateSample } from "@/lib/emails/sample-data"

/**
 * Live preview de borrador NO guardado.
 * Body: { subject?: string, html_body?: string }
 * Si html_body está vacío, intenta usar fallback hardcoded (si existe para ese type).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { error: authErr } = await requireSuperadmin()
    if (authErr) return authErr

    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const { subject: draftSubject, html_body: draftHtml } = body as {
      subject?: string
      html_body?: string
    }

    const { data: row, error } = await supabaseAdmin
      .from("email_templates")
      .select("type, subject, html_body")
      .eq("id", id)
      .maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!row) return NextResponse.json({ error: "No encontrado" }, { status: 404 })

    const subjectToUse = typeof draftSubject === "string" ? draftSubject : row.subject
    const htmlToUse = typeof draftHtml === "string" ? draftHtml : row.html_body

    let renderedSubject = ""
    let renderedHtml = ""
    let source: "draft" | "hardcoded" = "draft"

    if (htmlToUse && htmlToUse.trim() !== "") {
      renderedSubject = interpolateSample(subjectToUse || "")
      renderedHtml = interpolateSample(htmlToUse)
      source = "draft"
    } else if (LIFECYCLE_TEMPLATE_TYPES.has(row.type)) {
      const hard = getLifecycleEmail(row.type as LifecycleEmailType, EMAIL_SAMPLE_DATA)
      renderedSubject = hard.subject
      renderedHtml = hard.html
      source = "hardcoded"
    } else {
      return NextResponse.json(
        {
          error:
            "Sin cuerpo HTML y sin fallback hardcoded. Escribí HTML antes de previsualizar.",
        },
        { status: 400 }
      )
    }

    return NextResponse.json({
      subject: renderedSubject,
      html: renderedHtml,
      source,
      type: row.type,
    })
  } catch (err) {
    console.error("Error preview:", err)
    return NextResponse.json({ error: "Error" }, { status: 500 })
  }
}
