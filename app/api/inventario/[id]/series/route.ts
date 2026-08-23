import { NextResponse } from "next/server"
import {
  requireInventarioAccess,
  requireAuth,
  hasInventarioAccess,
  resolveVendedoresHabilitados,
} from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

// GET /api/inventario/[id]/series — filtros estado, search numero_serie
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, role } = await requireAuth()
    if (error) return error

    const { id } = await params
    const url = new URL(request.url)
    const estado = url.searchParams.get("estado")?.trim().toUpperCase()
    const q = url.searchParams.get("q")?.trim()
    const limit = Math.min(Number(url.searchParams.get("limit")) || 200, 500)
    const order = url.searchParams.get("order")

    let query = supabaseAdmin
      .from("inventario_series")
      .select(
        "id, numero_serie, lote_id, estado, fecha_recepcion, fecha_venta, fecha_garantia_vence, venta_id, cliente_id, deposito_id, costo_unitario, notas, created_at, updated_at"
      )
      .eq("inventario_id", id)
      .eq("organization_id", organizationId!)
      .order("created_at", { ascending: order === "asc" })
      .limit(limit)

    if (estado) query = query.eq("estado", estado)
    if (q) query = query.ilike("numero_serie", `%${q}%`)

    const { data, error: dbErr } = await query
    if (dbErr) throw dbErr

    // costo_unitario is the purchase cost of the unit — for a serialized item
    // that is the exact precio_compra — so it follows the same rule as
    // inventario.precio_compra everywhere else. Serial tracking (numbers,
    // state, dates, warranty) stays available to every role.
    const vendedoresHabilitados = role === "VENDEDOR"
      ? await resolveVendedoresHabilitados(organizationId!)
      : false
    const canViewCost = hasInventarioAccess(role, vendedoresHabilitados)

    const series = (data ?? []).map((s: any) =>
      canViewCost ? s : { ...s, costo_unitario: null }
    )

    return NextResponse.json({ data: series }, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (err) {
    console.error("Error listing series:", err)
    return NextResponse.json({ error: "Error al obtener series" }, { status: 500 })
  }
}

const createSchema = z.object({
  numerosSerie: z.array(z.string().trim().min(1).max(120)).min(1).max(500),
  loteId: z.string().trim().nullable().optional(),
  costoUnitario: z.number().nonnegative().max(99_999_999).nullable().optional(),
  depositoId: z.string().trim().nullable().optional(),
  garantiaDias: z.number().int().min(0).max(3650).nullable().optional(),
})

// POST /api/inventario/[id]/series — wrapper de registrar_entrada_series
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId } = await requireInventarioAccess()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const data = createSchema.parse(body)

    const { data: result, error: rpcErr } = await supabaseAdmin.rpc(
      "registrar_entrada_series",
      {
        p_organization_id: organizationId!,
        p_user_id: userId!,
        p_inventario_id: id,
        p_numeros_serie: data.numerosSerie,
        p_lote_id: data.loteId || null,
        p_costo_unitario: data.costoUnitario ?? null,
        p_deposito_id: data.depositoId || null,
        p_garantia_dias: data.garantiaDias ?? null,
      }
    )

    if (rpcErr) {
      const code = (rpcErr as any).code
      const msg = rpcErr.message || "Error al registrar series"
      if (code === "P0002") return NextResponse.json({ error: msg }, { status: 404 })
      if (code === "22023") return NextResponse.json({ error: msg }, { status: 400 })
      throw rpcErr
    }

    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error creating series:", err)
    return NextResponse.json({ error: "Error al registrar series" }, { status: 500 })
  }
}
