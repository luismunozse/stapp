import { NextResponse } from "next/server"
import { requireAdmin, requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

// GET /api/inventario/[id]/lotes
// Lista lotes del item (filtrable por estado).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id } = await params
    const url = new URL(request.url)
    const estado = url.searchParams.get("estado")

    let query = supabaseAdmin
      .from("inventario_lotes")
      .select(
        "id, numero_lote, cantidad_inicial, cantidad_actual, costo_unitario, fecha_vencimiento, fecha_recepcion, estado, deposito_id, proveedor_id, orden_compra_id, notas, created_at, updated_at"
      )
      .eq("inventario_id", id)
      .eq("organization_id", organizationId!)
      .order("created_at", { ascending: false })

    if (estado && estado.trim()) {
      query = query.eq("estado", estado.trim().toUpperCase())
    }

    const { data, error: dbErr } = await query
    if (dbErr) throw dbErr

    return NextResponse.json({ data: data ?? [] })
  } catch (err) {
    console.error("Error listing lotes:", err)
    return NextResponse.json({ error: "Error al obtener lotes" }, { status: 500 })
  }
}

const createSchema = z.object({
  numeroLote: z.string().trim().min(1).max(120),
  cantidad: z.number().int().positive().max(1_000_000),
  costoUnitario: z.number().nonnegative().max(99_999_999).nullable().optional(),
  fechaVencimiento: z.string().trim().nullable().optional(), // ISO date
  proveedorId: z.string().trim().nullable().optional(),
  ordenCompraId: z.string().trim().nullable().optional(),
  depositoId: z.string().trim().nullable().optional(),
  notas: z.string().trim().max(500).nullable().optional(),
})

// POST /api/inventario/[id]/lotes — wrapper de registrar_entrada_lote
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const data = createSchema.parse(body)

    const { data: result, error: rpcErr } = await supabaseAdmin.rpc(
      "registrar_entrada_lote",
      {
        p_organization_id: organizationId!,
        p_user_id: userId!,
        p_inventario_id: id,
        p_numero_lote: data.numeroLote,
        p_cantidad: data.cantidad,
        p_costo_unitario: data.costoUnitario ?? null,
        p_fecha_vencimiento: data.fechaVencimiento || null,
        p_proveedor_id: data.proveedorId || null,
        p_orden_compra_id: data.ordenCompraId || null,
        p_deposito_id: data.depositoId || null,
        p_notas: data.notas ?? null,
      }
    )

    if (rpcErr) {
      const code = (rpcErr as any).code
      const msg = rpcErr.message || "Error al registrar lote"
      if (code === "P0002") return NextResponse.json({ error: msg }, { status: 404 })
      if (code === "22023") return NextResponse.json({ error: msg }, { status: 400 })
      throw rpcErr
    }

    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error creating lote:", err)
    return NextResponse.json({ error: "Error al registrar lote" }, { status: 500 })
  }
}
