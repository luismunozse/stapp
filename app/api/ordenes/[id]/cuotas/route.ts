import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

// GET - Obtener calendario de cuotas de una orden
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id: ordenId } = await params

    const { data: cuotas, error: dbError } = await supabaseAdmin
      .from("cuotas_cobro")
      .select("*")
      .eq("orden_id", ordenId)
      .eq("organization_id", organizationId!)
      .order("numero_cuota", { ascending: true })

    if (dbError) throw dbError

    return NextResponse.json(
      (cuotas || []).map((c: any) => ({
        id: c.id,
        cobroId: c.cobro_id,
        numeroCuota: c.numero_cuota,
        totalCuotas: c.total_cuotas,
        monto: parseFloat(c.monto),
        fechaVencimiento: c.fecha_vencimiento,
        pagada: c.pagada,
        fechaPago: c.fecha_pago,
      }))
    )
  } catch (err) {
    console.error("Error fetching cuotas:", err)
    return NextResponse.json({ error: "Error al obtener cuotas" }, { status: 500 })
  }
}

const marcarPagadaSchema = z.object({
  cuotaId: z.string().min(1, "Se requiere cuotaId"),
})

// PUT - Marcar cuota como pagada
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, role } = await requireAuth()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json({ error: "Solo administradores pueden marcar cuotas" }, { status: 403 })
    }

    const { id: ordenId } = await params
    const body = await request.json()
    const { cuotaId } = marcarPagadaSchema.parse(body)

    const { data: cuota, error: cuotaError } = await supabaseAdmin
      .from("cuotas_cobro")
      .select("id, pagada")
      .eq("id", cuotaId)
      .eq("orden_id", ordenId)
      .eq("organization_id", organizationId!)
      .single()

    if (cuotaError || !cuota) {
      return NextResponse.json({ error: "Cuota no encontrada" }, { status: 404 })
    }

    if (cuota.pagada) {
      return NextResponse.json({ error: "La cuota ya fue marcada como pagada" }, { status: 400 })
    }

    await supabaseAdmin
      .from("cuotas_cobro")
      .update({
        pagada: true,
        fecha_pago: new Date().toISOString(),
      })
      .eq("id", cuotaId)

    return NextResponse.json({ message: "Cuota marcada como pagada" })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error marking cuota:", err)
    return NextResponse.json({ error: "Error al marcar cuota" }, { status: 500 })
  }
}
