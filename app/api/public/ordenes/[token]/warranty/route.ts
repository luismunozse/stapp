import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { getOrderByPublicToken } from "@/lib/public-token"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const { orden, error } = await getOrderByPublicToken(token)
    if (error) return error

    const { data: garantia } = await supabaseAdmin
      .from("garantias")
      .select("id, dias_validez, fecha_inicio, fecha_vencimiento, estado, notas")
      .eq("orden_id", orden.id)
      .single()

    if (!garantia) {
      return NextResponse.json({ garantia: null })
    }

    const now = new Date()
    const vencimiento = new Date(garantia.fecha_vencimiento)
    const diasRestantes = Math.max(0, Math.ceil((vencimiento.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))

    return NextResponse.json({
      garantia: {
        diasValidez: garantia.dias_validez,
        fechaInicio: garantia.fecha_inicio,
        fechaVencimiento: garantia.fecha_vencimiento,
        estado: garantia.estado,
        diasRestantes,
        notas: garantia.notas,
      },
    })
  } catch (error) {
    console.error("Error fetching warranty:", error)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
