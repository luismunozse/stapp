import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET() {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { data } = await supabaseAdmin
      .from("onboarding_progress")
      .select("*")
      .eq("organization_id", organizationId!)
      .single()

    if (!data) {
      // Crear registro si no existe
      const { data: newProgress } = await supabaseAdmin
        .from("onboarding_progress")
        .insert({ organization_id: organizationId! })
        .select()
        .single()

      return NextResponse.json(newProgress)
    }

    return NextResponse.json(data)
  } catch (err) {
    console.error("Error fetching onboarding progress:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const body = await request.json()
    const allowedFields = ["step_logo", "step_first_client", "step_first_order", "step_checklist"]
    const updates: Record<string, unknown> = {}

    for (const field of allowedFields) {
      if (field in body) {
        updates[field] = body[field]
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No hay campos para actualizar" }, { status: 400 })
    }

    const { data, error: dbError } = await supabaseAdmin
      .from("onboarding_progress")
      .upsert(
        { organization_id: organizationId!, ...updates },
        { onConflict: "organization_id" }
      )
      .select()
      .single()

    if (dbError) throw dbError

    return NextResponse.json(data)
  } catch (err) {
    console.error("Error updating onboarding progress:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
