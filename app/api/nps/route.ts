import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"

// GET - Verificar si debe mostrarse el NPS al usuario actual
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ show: false })
    }

    const userId = session.user.id
    const now = new Date()

    // Verificar schedule
    const { data: schedule } = await supabaseAdmin
      .from("nps_schedule")
      .select("next_prompt_at, dismissed_count")
      .eq("user_id", userId)
      .single()

    if (schedule) {
      // Si tiene schedule y no es hora todavía, no mostrar
      if (new Date(schedule.next_prompt_at) > now) {
        return NextResponse.json({ show: false })
      }
      // Si dismisseó 3+ veces, no molestar más
      if (schedule.dismissed_count >= 3) {
        return NextResponse.json({ show: false })
      }
    } else {
      // Sin schedule: verificar que la cuenta tenga al menos 14 días
      const { data: user } = await supabaseAdmin
        .from("users")
        .select("created_at")
        .eq("id", userId)
        .single()

      if (user) {
        const accountAge = Math.floor((now.getTime() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24))
        if (accountAge < 14) {
          return NextResponse.json({ show: false })
        }
      }

      // Verificar que no haya respondido en los últimos 60 días
      const sixtyDaysAgo = new Date(now)
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60)

      const { count } = await supabaseAdmin
        .from("nps_responses")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", sixtyDaysAgo.toISOString())

      if ((count || 0) > 0) {
        return NextResponse.json({ show: false })
      }
    }

    return NextResponse.json({ show: true })
  } catch (error) {
    console.error("Error checking NPS:", error)
    return NextResponse.json({ show: false })
  }
}

// POST - Enviar respuesta NPS
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id || !session?.user?.organizationId) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    const body = await request.json()
    const { score, comentario } = body

    if (score === undefined || score < 0 || score > 10) {
      return NextResponse.json({ error: "Score debe ser entre 0 y 10" }, { status: 400 })
    }

    // Guardar respuesta
    await supabaseAdmin.from("nps_responses").insert({
      organization_id: session.user.organizationId,
      user_id: session.user.id,
      score,
      comentario: comentario || null,
    })

    // Programar próximo NPS en 60 días
    const nextPrompt = new Date()
    nextPrompt.setDate(nextPrompt.getDate() + 60)

    await supabaseAdmin
      .from("nps_schedule")
      .upsert({
        user_id: session.user.id,
        next_prompt_at: nextPrompt.toISOString(),
        dismissed_count: 0,
      }, { onConflict: "user_id" })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error submitting NPS:", error)
    return NextResponse.json({ error: "Error al enviar respuesta" }, { status: 500 })
  }
}

// PATCH - Dismiss NPS (no quiero responder ahora)
export async function PATCH() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    // Postponer 7 días e incrementar dismiss count
    const nextPrompt = new Date()
    nextPrompt.setDate(nextPrompt.getDate() + 7)

    const { data: existing } = await supabaseAdmin
      .from("nps_schedule")
      .select("dismissed_count")
      .eq("user_id", session.user.id)
      .single()

    await supabaseAdmin
      .from("nps_schedule")
      .upsert({
        user_id: session.user.id,
        next_prompt_at: nextPrompt.toISOString(),
        dismissed_count: (existing?.dismissed_count || 0) + 1,
      }, { onConflict: "user_id" })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error dismissing NPS:", error)
    return NextResponse.json({ error: "Error" }, { status: 500 })
  }
}
