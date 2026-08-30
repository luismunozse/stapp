import { NextResponse } from "next/server"
import { requireAdmin, requireInventarioAccess } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const createSchema = z.object({
  nombre: z.string().trim().min(1, "Nombre requerido").max(120),
  depositoId: z.string().min(1).nullable().optional(),
  tipo: z.enum(["COMPLETO", "PARCIAL", "CICLICO"]).optional(),
  toleranciaPct: z.number().min(0).max(100).nullable().optional(),
  aplicarAjustes: z.boolean().optional(),
  notas: z.string().trim().max(1000).nullable().optional(),
  filtros: z
    .object({
      categoria: z.string().nullable().optional(),
      tipoDispositivo: z.string().nullable().optional(),
      proveedorId: z.string().nullable().optional(),
      soloConStock: z.boolean().optional(),
    })
    .optional(),
})

function formatConteo(row: any) {
  return {
    id: row.id,
    nombre: row.nombre,
    estado: row.estado,
    depositoId: row.deposito_id ?? null,
    depositoNombre: row.depositos?.nombre ?? null,
    tipo: row.tipo,
    toleranciaPct: row.tolerancia_pct,
    aplicarAjustes: row.aplicar_ajustes,
    filtrosSnapshot: row.filtros_snapshot ?? null,
    totalItems: row.total_items,
    itemsContados: row.items_contados,
    itemsDiferencia: row.items_diferencia,
    itemsAjustados: row.items_ajustados,
    notas: row.notas,
    iniciadoPor: row.iniciado_por,
    iniciadoAt: row.iniciado_at,
    finalizadoPor: row.finalizado_por,
    finalizadoAt: row.finalizado_at,
    canceladoPor: row.cancelado_por,
    canceladoAt: row.cancelado_at,
    createdAt: row.created_at,
  }
}

export async function GET(request: Request) {
  try {
        // Los conteos son inventario: la pantalla vive en
    // app/(dashboard)/inventario/conteos y el namespace ya esta detras del
    // permiso 275. Con requireAuth entraba tambien un TECNICO y un VENDEDOR
    // SIN el permiso, ninguno de los dos con nada que hacer en inventario.
const { error, organizationId } = await requireInventarioAccess()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const estado = searchParams.get("estado")

    let query = supabaseAdmin
      .from("conteos_inventario")
      .select("*, depositos:deposito_id(id, nombre)")
      .eq("organization_id", organizationId!)
      .order("created_at", { ascending: false })
      .limit(100)

    if (estado) {
      query = query.eq("estado", estado)
    }

    const { data, error: dbErr } = await query
    if (dbErr) throw dbErr

    return NextResponse.json({ data: (data || []).map(formatConteo) })
  } catch (err) {
    console.error("Error fetching conteos:", err)
    return NextResponse.json({ error: "Error al obtener conteos" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const body = await request.json()
    const data = createSchema.parse(body)

    const { data: result, error: rpcErr } = await supabaseAdmin.rpc("iniciar_conteo", {
      p_organization_id: organizationId!,
      p_user_id: userId!,
      p_nombre: data.nombre,
      p_deposito_id: data.depositoId ?? null,
      p_tipo: data.tipo ?? "PARCIAL",
      p_filtros: data.filtros ?? {},
      p_tolerancia_pct: data.toleranciaPct ?? null,
      p_aplicar_ajustes: data.aplicarAjustes ?? true,
      p_notas: data.notas ?? null,
    })

    if (rpcErr) {
      const code = (rpcErr as any).code
      if (code === "22023") {
        return NextResponse.json({ error: rpcErr.message }, { status: 400 })
      }
      if (code === "P0002") {
        return NextResponse.json({ error: rpcErr.message }, { status: 404 })
      }
      throw rpcErr
    }

    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error creating conteo:", err)
    return NextResponse.json({ error: "Error al iniciar conteo" }, { status: 500 })
  }
}
