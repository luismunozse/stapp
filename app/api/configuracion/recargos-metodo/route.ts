import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const METODOS = [
  "EFECTIVO",
  "TRANSFERENCIA",
  "TARJETA_DEBITO",
  "TARJETA_CREDITO",
  "MERCADOPAGO",
  "CUENTA_CORRIENTE",
  "OTRO",
] as const

export async function GET(_request: Request) {
  const { error, organizationId } = await requireAuth()
  if (error) return error

  const { data } = await supabaseAdmin
    .from("recargos_metodo_pago")
    .select("metodo_pago, porcentaje")
    .eq("organization_id", organizationId!)

  const porMetodo: Record<string, number> = {}
  for (const row of data || []) {
    porMetodo[row.metodo_pago] = parseFloat(String(row.porcentaje)) || 0
  }

  return NextResponse.json({
    recargos: METODOS.map((metodo) => ({
      metodo,
      porcentaje: porMetodo[metodo] ?? 0,
    })),
  })
}

const putSchema = z.object({
  recargos: z.array(
    z.object({
      metodo: z.enum(METODOS),
      porcentaje: z.number().min(0, "El porcentaje no puede ser negativo"),
    })
  ),
})

export async function PUT(request: Request) {
  const { error, organizationId, role } = await requireAuth()
  if (error) return error

  if (role !== "ADMIN") {
    return NextResponse.json(
      { error: "Solo administradores pueden configurar recargos" },
      { status: 403 }
    )
  }

  let data: z.infer<typeof putSchema>
  try {
    data = putSchema.parse(await request.json())
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.errors[0].message }, { status: 400 })
    }
    return NextResponse.json({ error: "Body inválido" }, { status: 400 })
  }

  const rows = data.recargos.map((r) => ({
    organization_id: organizationId!,
    metodo_pago: r.metodo,
    porcentaje: r.porcentaje,
    activo: true,
    updated_at: new Date().toISOString(),
  }))

  const { error: upsertError } = await supabaseAdmin
    .from("recargos_metodo_pago")
    .upsert(rows, { onConflict: "organization_id,metodo_pago" })

  if (upsertError) {
    return NextResponse.json(
      { error: upsertError.message || "Error al guardar" },
      { status: 400 }
    )
  }

  return NextResponse.json({ ok: true })
}
