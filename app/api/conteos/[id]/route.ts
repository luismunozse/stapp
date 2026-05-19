import { NextResponse } from "next/server"
import { requireAuth, requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id } = await params

    const { data, error: dbErr } = await supabaseAdmin
      .from("conteos_inventario")
      .select("*, depositos:deposito_id(id, nombre)")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (dbErr || !data) {
      return NextResponse.json({ error: "Conteo no encontrado" }, { status: 404 })
    }

    return NextResponse.json(formatConteo(data))
  } catch (err) {
    console.error("Error fetching conteo:", err)
    return NextResponse.json({ error: "Error al obtener conteo" }, { status: 500 })
  }
}

// DELETE /api/conteos/[id]?motivo=...  → cancelar (no borra)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const { searchParams } = new URL(request.url)
    const motivo = searchParams.get("motivo")

    // Verificar pertenencia
    const { data: existing } = await supabaseAdmin
      .from("conteos_inventario")
      .select("id, organization_id, estado")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (!existing) {
      return NextResponse.json({ error: "Conteo no encontrado" }, { status: 404 })
    }

    const { data: result, error: rpcErr } = await supabaseAdmin.rpc("cancelar_conteo", {
      p_conteo_id: id,
      p_user_id: userId!,
      p_motivo: motivo,
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

    return NextResponse.json(result)
  } catch (err) {
    console.error("Error cancelling conteo:", err)
    return NextResponse.json({ error: "Error al cancelar conteo" }, { status: 500 })
  }
}
