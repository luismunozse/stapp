import { NextRequest, NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { getLifecycleEmail, type LifecycleEmailType } from "@/lib/emails/lifecycle-templates"
import { EMAIL_SAMPLE_DATA, LIFECYCLE_TEMPLATE_TYPES, interpolateSample } from "@/lib/emails/sample-data"

const CATEGORY_ORDER: Record<string, number> = {
  onboarding: 0,
  conversion: 1,
  retention: 2,
  engagement: 3,
  reactivation: 4,
}

// GET - Lista todos los templates desde DB
export async function GET() {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const { data, error: dbErr } = await supabaseAdmin
      .from("email_templates")
      .select("id, type, category, label, description, status, html_body, subject, updated_at, notes")
      .order("category", { ascending: true })
      .order("type", { ascending: true })

    if (dbErr) {
      console.error("[lifecycle-preview] DB error:", dbErr)
      return NextResponse.json({ error: dbErr.message }, { status: 500 })
    }

    type Row = {
      id: string
      type: string
      category: string
      label: string
      description: string | null
      status: string
      html_body: string
      subject: string
      updated_at: string
      notes: string | null
    }

    const rows = (data as Row[] | null) || []

    rows.sort((a, b) => {
      const ca = CATEGORY_ORDER[a.category] ?? 999
      const cb = CATEGORY_ORDER[b.category] ?? 999
      if (ca !== cb) return ca - cb
      return a.type.localeCompare(b.type)
    })

    const templates = rows.map((r) => ({
      id: r.id,
      type: r.type,
      category: r.category,
      label: r.label,
      description: r.description || "",
      status: r.status,
      hasBody: !!(r.html_body && r.html_body.trim() !== ""),
      hasHardcodedFallback: LIFECYCLE_TEMPLATE_TYPES.has(r.type),
      updatedAt: r.updated_at,
      notes: r.notes || "",
    }))

    return NextResponse.json({ templates, types: templates })
  } catch (err) {
    console.error("Error:", err)
    return NextResponse.json({ error: "Error" }, { status: 500 })
  }
}

// POST - Renderizar preview de un template. NUNCA bloquea por DRAFT — sólo es preview.
export async function POST(request: NextRequest) {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const body = await request.json()
    const { type } = body as { type: string }

    if (!type) {
      return NextResponse.json({ error: "type es requerido" }, { status: 400 })
    }

    const { data: row } = await supabaseAdmin
      .from("email_templates")
      .select("subject, html_body, status")
      .eq("type", type)
      .maybeSingle()

    let subject = ""
    let html = ""
    let source: "db" | "hardcoded" = "hardcoded"

    if (row && row.html_body && row.html_body.trim() !== "") {
      subject = interpolateSample(row.subject || "")
      html = interpolateSample(row.html_body)
      source = "db"
    } else if (LIFECYCLE_TEMPLATE_TYPES.has(type)) {
      const hard = getLifecycleEmail(type as LifecycleEmailType, EMAIL_SAMPLE_DATA)
      subject = hard.subject
      html = hard.html
      source = "hardcoded"
    } else {
      return NextResponse.json(
        {
          error:
            "Este tipo no tiene cuerpo en DB ni fallback hardcoded. Edita el template y guardá un cuerpo antes de previsualizar.",
          type,
          status: row?.status || null,
        },
        { status: 404 }
      )
    }

    return NextResponse.json({ subject, html, type, source, status: row?.status || null })
  } catch (err) {
    console.error("Error rendering preview:", err)
    return NextResponse.json({ error: "Error al renderizar preview" }, { status: 500 })
  }
}
