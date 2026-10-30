import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

// What annulling a payout would un-pay: the annul dialog reads this before asking for the reason.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params

    const { data: pago, error: pagoError } = await supabaseAdmin
      .from("comisiones_pagos")
      .select("id, beneficiario_id, fecha_pago, origen, total, anulado")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .maybeSingle()
    if (pagoError) throw pagoError
    if (!pago) return NextResponse.json({ error: "Pago no encontrado." }, { status: 404 })

    const { count, error: countError } = await supabaseAdmin
      .from("comisiones_pagos_items")
      .select("id", { count: "exact", head: true })
      .eq("pago_id", id)
      .eq("organization_id", organizationId!)
    if (countError) throw countError

    const { data: usuario } = await supabaseAdmin
      .from("users")
      .select("nombre")
      .eq("id", pago.beneficiario_id)
      .eq("organization_id", organizationId!)
      .maybeSingle()

    return NextResponse.json(
      {
        pagoId: pago.id,
        fechaPago: pago.fecha_pago,
        origen: pago.origen,
        total: Number(pago.total),
        anulado: Boolean(pago.anulado),
        filas: count ?? 0,
        beneficiarioNombre: usuario?.nombre || "—",
      },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (err) {
    console.error("Error fetching commission payout:", err)
    return NextResponse.json({ error: "Error al obtener el pago" }, { status: 500 })
  }
}
