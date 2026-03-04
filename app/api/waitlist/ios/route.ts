import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const schema = z.object({
  email: z.string().email("Email inválido"),
})

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { email } = schema.parse(body)

    const { error } = await supabaseAdmin
      .from("ios_waitlist")
      .upsert({ email }, { onConflict: "email", ignoreDuplicates: true })

    if (error) throw error

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("iOS waitlist error:", error)
    return NextResponse.json(
      { error: "Error al registrar el email" },
      { status: 500 }
    )
  }
}
