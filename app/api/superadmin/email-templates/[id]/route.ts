import { NextRequest, NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"

// GET - leer un template
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { error: authErr } = await requireSuperadmin()
    if (authErr) return authErr

    const { id } = await params

    const { data, error } = await supabaseAdmin
      .from("email_templates")
      .select("*")
      .eq("id", id)
      .maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: "No encontrado" }, { status: 404 })

    return NextResponse.json({ template: data })
  } catch (err) {
    console.error("Error GET email-template:", err)
    return NextResponse.json({ error: "Error" }, { status: 500 })
  }
}

// PATCH - editar subject/html_body/status/notes con audit
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { error: authErr, email } = await requireSuperadmin()
    if (authErr) return authErr

    const { id } = await params
    const body = await req.json()
    const {
      subject,
      html_body,
      status,
      notes,
    } = body as {
      subject?: string
      html_body?: string
      status?: "DRAFT" | "PUBLISHED" | "ARCHIVED"
      notes?: string
    }

    // Validar status
    if (status && !["DRAFT", "PUBLISHED", "ARCHIVED"].includes(status)) {
      return NextResponse.json({ error: "status inválido" }, { status: 400 })
    }

    // Leer estado previo
    const { data: prev, error: prevErr } = await supabaseAdmin
      .from("email_templates")
      .select("id, type, subject, html_body, status, notes")
      .eq("id", id)
      .maybeSingle()

    if (prevErr) return NextResponse.json({ error: prevErr.message }, { status: 500 })
    if (!prev) return NextResponse.json({ error: "No encontrado" }, { status: 404 })

    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      updated_by: email,
    }
    let bodyChanged = false
    let subjectChanged = false
    if (typeof subject === "string" && subject !== prev.subject) {
      update.subject = subject
      subjectChanged = true
    }
    if (typeof html_body === "string" && html_body !== prev.html_body) {
      update.html_body = html_body
      bodyChanged = true
      update.custom_overrides = true
    }
    if (typeof notes === "string" && notes !== prev.notes) {
      update.notes = notes
    }
    let statusChanged = false
    if (status && status !== prev.status) {
      update.status = status
      statusChanged = true
    }

    // Si quieren publicar pero no hay cuerpo (ni en DB ni en el body de la request) → bloquear
    if (status === "PUBLISHED") {
      const finalBody = typeof html_body === "string" ? html_body : prev.html_body
      const finalSubject = typeof subject === "string" ? subject : prev.subject
      if (!finalBody || finalBody.trim() === "") {
        return NextResponse.json(
          {
            error:
              "No se puede publicar un template con html_body vacío. Editá el contenido y guardá primero.",
          },
          { status: 400 }
        )
      }
      if (!finalSubject || finalSubject.trim() === "") {
        return NextResponse.json(
          { error: "No se puede publicar sin subject." },
          { status: 400 }
        )
      }
    }

    const { data: updated, error: upErr } = await supabaseAdmin
      .from("email_templates")
      .update(update)
      .eq("id", id)
      .select("*")
      .single()

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

    // Audit history
    const actions: string[] = []
    if (statusChanged) {
      if (status === "PUBLISHED") actions.push("PUBLISHED")
      else if (prev.status === "PUBLISHED") actions.push("UNPUBLISHED")
      if (status === "ARCHIVED") actions.push("ARCHIVED")
    }
    if ((bodyChanged || subjectChanged) && actions.length === 0) {
      actions.push("EDITED")
    }
    for (const action of actions) {
      await supabaseAdmin.from("email_template_history").insert({
        template_id: id,
        type: prev.type,
        subject: updated.subject,
        html_body: updated.html_body,
        status_before: prev.status,
        status_after: updated.status,
        action,
        changed_by: email,
        notes: typeof notes === "string" ? notes : null,
      })
    }

    return NextResponse.json({ template: updated })
  } catch (err) {
    console.error("Error PATCH email-template:", err)
    return NextResponse.json({ error: "Error" }, { status: 500 })
  }
}
