import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const gastoSchema = z.object({
  categoriaGastoId: z.string().nullable().optional(),
  concepto: z.string().min(1).max(120),
  monto: z.number().positive(),
  metodoPago: z.string().min(1).default("EFECTIVO"),
  frecuencia: z.enum(["SEMANAL", "MENSUAL", "ANUAL"]),
  diaDelMes: z.number().int().min(1).max(31).nullable().optional(),
  proximoVencimiento: z.string().min(1), // YYYY-MM-DD
  observaciones: z.string().nullable().optional(),
})

function mapGasto(g: any) {
  return {
    id: g.id,
    categoriaGastoId: g.categoria_gasto_id,
    categoria: g.categorias_gasto
      ? {
          id: g.categorias_gasto.id,
          nombre: g.categorias_gasto.nombre,
          color: g.categorias_gasto.color,
          tipo: g.categorias_gasto.tipo,
        }
      : null,
    concepto: g.concepto,
    monto: parseFloat(g.monto),
    metodoPago: g.metodo_pago,
    frecuencia: g.frecuencia,
    diaDelMes: g.dia_del_mes,
    proximoVencimiento: g.proximo_vencimiento,
    ultimoGenerado: g.ultimo_generado,
    activo: g.activo,
    observaciones: g.observaciones,
  }
}

export async function GET() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { data, error: dbError } = await supabaseAdmin
      .from("gastos_recurrentes")
      .select("*, categorias_gasto(id, nombre, color, tipo)")
      .eq("organization_id", organizationId!)
      .order("activo", { ascending: false })
      .order("proximo_vencimiento", { ascending: true })

    if (dbError) {
      console.error(dbError)
      return NextResponse.json({ error: "Error al obtener gastos recurrentes" }, { status: 500 })
    }

    return NextResponse.json({ gastos: (data || []).map(mapGasto) })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Error al obtener gastos recurrentes" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const body = await request.json()
    const parsed = gastoSchema.parse(body)

    const { data, error: insertError } = await supabaseAdmin
      .from("gastos_recurrentes")
      .insert({
        organization_id: organizationId!,
        categoria_gasto_id: parsed.categoriaGastoId || null,
        concepto: parsed.concepto,
        monto: parsed.monto,
        metodo_pago: parsed.metodoPago,
        frecuencia: parsed.frecuencia,
        dia_del_mes: parsed.diaDelMes ?? null,
        proximo_vencimiento: parsed.proximoVencimiento,
        observaciones: parsed.observaciones || null,
      })
      .select("*, categorias_gasto(id, nombre, color, tipo)")
      .single()

    if (insertError) {
      console.error(insertError)
      return NextResponse.json({ error: "Error al crear gasto recurrente" }, { status: 500 })
    }

    return NextResponse.json({ gasto: mapGasto(data) }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error(err)
    return NextResponse.json({ error: "Error al crear gasto recurrente" }, { status: 500 })
  }
}
