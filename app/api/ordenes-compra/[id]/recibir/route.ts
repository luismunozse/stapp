import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const recibirSchema = z.object({
  items: z.array(z.object({
    itemId: z.string().min(1),
    cantidadRecibida: z.number().int().positive(),
  })).min(1),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const data = recibirSchema.parse(body)

    // Verify OC exists and is in valid state
    const { data: oc, error: fetchError } = await supabaseAdmin
      .from("ordenes_compra")
      .select("id, estado")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (fetchError || !oc) {
      return NextResponse.json({ error: "Orden de compra no encontrada" }, { status: 404 })
    }

    if (!["ENVIADA", "RECIBIDA_PARCIAL"].includes(oc.estado)) {
      return NextResponse.json(
        { error: `No se puede recibir una OC en estado "${oc.estado}". Debe estar ENVIADA o RECIBIDA_PARCIAL.` },
        { status: 400 }
      )
    }

    const { data: result, error: rpcError } = await supabaseAdmin.rpc("recibir_orden_compra", {
      p_oc_id: id,
      p_user_id: userId,
      p_items: data.items,
    })

    if (rpcError) {
      console.error("Error in recibir_orden_compra:", rpcError)
      return NextResponse.json(
        { error: rpcError.message || "Error al recibir orden de compra" },
        { status: 400 }
      )
    }

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    console.error("Error receiving OC:", error)
    return NextResponse.json({ error: "Error al recibir orden de compra" }, { status: 500 })
  }
}
