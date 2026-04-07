import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const updateSchema = z.object({
  categoriaGastoId: z.string().nullable().optional(),
  concepto: z.string().min(1).max(120).optional(),
  monto: z.number().positive().optional(),
  metodoPago: z.string().min(1).optional(),
  frecuencia: z.enum(["SEMANAL", "MENSUAL", "ANUAL"]).optional(),
  diaDelMes: z.number().int().min(1).max(31).nullable().optional(),
  proximoVencimiento: z.string().optional(),
  observaciones: z.string().nullable().optional(),
  activo: z.boolean().optional(),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const parsed = updateSchema.parse(body)

    const updateData: Record<string, any> = {}
    if (parsed.categoriaGastoId !== undefined) updateData.categoria_gasto_id = parsed.categoriaGastoId
    if (parsed.concepto !== undefined) updateData.concepto = parsed.concepto
    if (parsed.monto !== undefined) updateData.monto = parsed.monto
    if (parsed.metodoPago !== undefined) updateData.metodo_pago = parsed.metodoPago
    if (parsed.frecuencia !== undefined) updateData.frecuencia = parsed.frecuencia
    if (parsed.diaDelMes !== undefined) updateData.dia_del_mes = parsed.diaDelMes
    if (parsed.proximoVencimiento !== undefined) updateData.proximo_vencimiento = parsed.proximoVencimiento
    if (parsed.observaciones !== undefined) updateData.observaciones = parsed.observaciones
    if (parsed.activo !== undefined) updateData.activo = parsed.activo

    const { data, error: updateError } = await supabaseAdmin
      .from("gastos_recurrentes")
      .update(updateData)
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .select("*")
      .single()

    if (updateError || !data) {
      return NextResponse.json({ error: "Error al actualizar" }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error(err)
    return NextResponse.json({ error: "Error al actualizar" }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error
    const { id } = await params

    const { error: deleteError } = await supabaseAdmin
      .from("gastos_recurrentes")
      .delete()
      .eq("id", id)
      .eq("organization_id", organizationId!)

    if (deleteError) {
      return NextResponse.json({ error: "Error al eliminar" }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Error al eliminar" }, { status: 500 })
  }
}
