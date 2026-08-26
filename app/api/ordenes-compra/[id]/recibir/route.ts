import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

// Techo sano por línea. No hay tope contra cantidad_pedida a propósito: se
// puede recibir más de lo pedido (el proveedor manda de más y hay que poder
// registrarlo). Esto solo frena un número absurdo que rompería el INTEGER.
const MAX_CANTIDAD_RECIBIDA = 1_000_000

const recibirSchema = z.object({
  items: z.array(z.object({
    itemId: z.string().min(1),
    cantidadRecibida: z.number().int().positive().max(MAX_CANTIDAD_RECIBIDA),
    inventarioId: z.string().min(1).nullable().optional(),
  })).min(1)
    // El mismo ítem dos veces en un request se sumaría dos veces sin que nadie
    // lo haya pedido: casi siempre es un bug del cliente, no una intención.
    .refine(
      (items) => new Set(items.map((i) => i.itemId)).size === items.length,
      { message: "Hay ítems repetidos en la recepción" }
    ),
  // Clave de idempotencia. Sin esto un reintento (red que se corta, retry del
  // móvil, dos pestañas) es indistinguible de una segunda recepción real.
  requestId: z.string().min(1).max(100),
  depositoId: z.string().min(1).nullable().optional(),
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
      p_items: data.items.map(i => ({
        itemId: i.itemId,
        cantidadRecibida: i.cantidadRecibida,
        ...(i.inventarioId ? { inventarioId: i.inventarioId } : {}),
      })),
      // El RPC revalida estado y scope adentro de la transacción: el chequeo de
      // arriba es para dar un 404/400 lindo, no la garantía.
      p_organization_id: organizationId,
      p_request_id: data.requestId,
      p_deposito_id: data.depositoId ?? null,
    })

    if (rpcError) {
      if (rpcError.code === "P0010") {
        return NextResponse.json(
          { error: "Stock insuficiente en el depósito seleccionado" },
          { status: 400 }
        )
      }
      if (rpcError.code === "P0011") {
        return NextResponse.json(
          { error: "La organización no tiene depósito principal configurado" },
          { status: 400 }
        )
      }
      if (rpcError.code === "P0012") {
        return NextResponse.json(
          { error: "Uno de los ítems no pertenece a esta orden de compra" },
          { status: 400 }
        )
      }
      if (rpcError.code === "P0013") {
        return NextResponse.json(
          { error: "Uno de los artículos no pertenece a tu organización" },
          { status: 400 }
        )
      }
      if (rpcError.code === "P0014") {
        // La OC cambió de estado entre el chequeo de arriba y la transacción:
        // otro la recibió o la canceló mientras tanto.
        return NextResponse.json(
          { error: "La orden cambió de estado mientras se recibía. Recargá y volvé a intentar." },
          { status: 409 }
        )
      }
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
