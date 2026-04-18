import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const liquidarSchema = z.object({
  ventaIds: z.array(z.string().min(1)).min(1, "Se requiere al menos una venta"),
  notas: z.string().trim().max(500).optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id: vendedorId } = await params
    const body = await request.json()
    const { ventaIds, notas } = liquidarSchema.parse(body)

    // Verificar que el vendedor existe en la organización
    const { data: vendedor, error: vendedorError } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("id", vendedorId)
      .eq("rol", "VENDEDOR")
      .eq("organization_id", organizationId!)
      .single()

    if (vendedorError || !vendedor) {
      return NextResponse.json({ error: "Vendedor no encontrado" }, { status: 404 })
    }

    // Update solo ventas de este vendedor + org, estado COMPLETADA, no pagadas
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("ventas")
      .update({
        comision_pagada: true,
        fecha_pago_comision: new Date().toISOString(),
        comision_pago_notas: notas?.trim() || null,
      })
      .in("id", ventaIds)
      .eq("vendedor_id", vendedorId)
      .eq("organization_id", organizationId!)
      .eq("estado", "COMPLETADA")
      .eq("comision_pagada", false)
      .select("id")

    if (updateError) throw updateError

    return NextResponse.json({
      liquidadas: updated?.length || 0,
      solicitadas: ventaIds.length,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error liquidando comisiones:", error)
    return NextResponse.json(
      { error: "Error al liquidar comisiones" },
      { status: 500 }
    )
  }
}
