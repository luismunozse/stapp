import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const aprobarSchema = z.object({
  firmaAprobacion: z.string().min(1, "Firma requerida"),
  firmaMime: z.string().min(1, "Tipo de firma requerido"),
  nombreAprobador: z.string().optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

    if (!token || token.length !== 32) {
      return NextResponse.json(
        { error: "Token invalido" },
        { status: 400 }
      )
    }

    const body = await request.json()
    const data = aprobarSchema.parse(body)

    // Find cotizacion by public token
    const { data: cotizacion, error: fetchError } = await supabaseAdmin
      .from("cotizaciones")
      .select("id, estado")
      .eq("public_token", token)
      .single()

    if (fetchError || !cotizacion) {
      return NextResponse.json(
        { error: "Cotizacion no encontrada" },
        { status: 404 }
      )
    }

    if (cotizacion.estado !== "ENVIADA") {
      return NextResponse.json(
        { error: "Solo se pueden aprobar cotizaciones enviadas" },
        { status: 400 }
      )
    }

    const { error: updateError } = await supabaseAdmin
      .from("cotizaciones")
      .update({
        estado: "ACEPTADA",
        firma_aprobacion: data.firmaAprobacion,
        firma_mime: data.firmaMime,
        fecha_aprobacion: new Date().toISOString(),
      })
      .eq("id", cotizacion.id)

    if (updateError) throw updateError

    return NextResponse.json({
      message: "Cotizacion aprobada exitosamente",
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error approving public cotizacion:", error)
    return NextResponse.json(
      { error: "Error al aprobar cotizacion" },
      { status: 500 }
    )
  }
}
