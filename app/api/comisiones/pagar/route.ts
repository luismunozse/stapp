import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

export async function POST(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const body = await request.json()
    const { ordenIds, notas } = body as { ordenIds: string[]; notas?: string }

    if (!Array.isArray(ordenIds) || ordenIds.length === 0) {
      return NextResponse.json({ error: "Debe indicar al menos una orden" }, { status: 400 })
    }

    const { data, error: updErr } = await supabaseAdmin
      .from("ordenes_servicio")
      .update({
        comision_pagada: true,
        fecha_pago_comision: new Date().toISOString(),
        comision_pago_notas: notas || null,
      })
      .in("id", ordenIds)
      .eq("organization_id", organizationId!)
      .select("id")

    if (updErr) throw updErr

    return NextResponse.json({ updated: data?.length || 0 })
  } catch (err) {
    console.error("Error pagando comisiones:", err)
    return NextResponse.json({ error: "Error al marcar comisiones como pagadas" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const body = await request.json()
    const { ordenIds } = body as { ordenIds: string[] }

    if (!Array.isArray(ordenIds) || ordenIds.length === 0) {
      return NextResponse.json({ error: "Debe indicar al menos una orden" }, { status: 400 })
    }

    const { data, error: updErr } = await supabaseAdmin
      .from("ordenes_servicio")
      .update({
        comision_pagada: false,
        fecha_pago_comision: null,
        comision_pago_notas: null,
      })
      .in("id", ordenIds)
      .eq("organization_id", organizationId!)
      .select("id")

    if (updErr) throw updErr

    return NextResponse.json({ updated: data?.length || 0 })
  } catch (err) {
    console.error("Error revirtiendo comisiones:", err)
    return NextResponse.json({ error: "Error al revertir" }, { status: 500 })
  }
}
