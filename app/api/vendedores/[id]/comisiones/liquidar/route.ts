import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { liquidarBodySchema, payCommissions } from "@/lib/commissions/payouts"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, organizationId, userId } = await requireAdmin()
  if (error) return error

  const { id: vendedorId } = await params

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ error: "El cuerpo del pedido no es válido" }, { status: 400 })
  }
  const parsed = liquidarBodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const body = parsed.data

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

  const res = await payCommissions({
    organizationId: organizationId!,
    userId: userId!,
    beneficiarioId: vendedorId,
    filas: body.filas,
    notas: body.notas,
  })
  if (!res.ok) return res

  const paid = (await res.json()) as { pagoId: string; total: number; filas: number }
  return NextResponse.json({
    pagoId: paid.pagoId,
    total: paid.total,
    liquidadas: paid.filas,
    solicitadas: body.filas.length,
  })
}
