import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const movimientoSchema = z.object({
  tipo: z.enum(["INGRESO", "EGRESO"]),
  monto: z.number().positive("El monto debe ser mayor a 0"),
  metodoPago: z.string().min(1, "El método de pago es requerido"),
  concepto: z.string().min(1, "El concepto es requerido"),
  observaciones: z.string().optional(),
})

// GET - Lista movimientos manuales del día
export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const fecha = searchParams.get("fecha") || new Date().toISOString().split("T")[0]
    const fechaDesde = `${fecha}T00:00:00`
    const fechaHasta = `${fecha}T23:59:59`

    const { data: movimientos } = await supabaseAdmin
      .from("movimientos_caja")
      .select("*, users(id, nombre)")
      .eq("organization_id", organizationId!)
      .gte("fecha", fechaDesde)
      .lte("fecha", fechaHasta)
      .order("fecha", { ascending: false })

    return NextResponse.json({
      movimientos: (movimientos || []).map((m) => ({
        id: m.id,
        tipo: m.tipo,
        monto: parseFloat(m.monto),
        metodoPago: m.metodo_pago,
        concepto: m.concepto,
        observaciones: m.observaciones,
        usuarioId: m.usuario_id,
        usuarioNombre: m.users?.nombre || null,
        fecha: m.fecha,
      })),
    })
  } catch (err) {
    console.error("Error fetching movimientos:", err)
    return NextResponse.json({ error: "Error al obtener movimientos" }, { status: 500 })
  }
}

// POST - Crear movimiento manual
export async function POST(request: Request) {
  try {
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const body = await request.json()
    const parsed = movimientoSchema.parse(body)

    // Buscar sesión abierta (opcional)
    const { data: sesionAbierta } = await supabaseAdmin
      .from("sesiones_caja")
      .select("id")
      .eq("organization_id", organizationId!)
      .eq("estado", "ABIERTA")
      .maybeSingle()

    const { data: movimiento, error: insertError } = await supabaseAdmin
      .from("movimientos_caja")
      .insert({
        organization_id: organizationId!,
        sesion_caja_id: sesionAbierta?.id || null,
        tipo: parsed.tipo,
        monto: parsed.monto,
        metodo_pago: parsed.metodoPago,
        concepto: parsed.concepto,
        observaciones: parsed.observaciones || null,
        usuario_id: userId!,
      })
      .select("*")
      .single()

    if (insertError) {
      console.error("Error creating movimiento:", insertError)
      return NextResponse.json({ error: "Error al crear movimiento" }, { status: 500 })
    }

    return NextResponse.json({ movimiento }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error creating movimiento:", err)
    return NextResponse.json({ error: "Error al crear movimiento" }, { status: 500 })
  }
}
