import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { createAuditLogger } from "@/lib/audit"
import { z } from "zod"

const revertirSchema = z.object({
  movimientoIds: z.array(z.string().min(1)).min(1, "Debe indicar al menos un movimiento"),
  motivo: z.string().trim().min(3, "El motivo es requerido"),
})

// POST - Revertir uno o varios cargos de fiado (CARGO con referencia a una orden).
// Reverting debt is forgiving money, so it is ADMIN-only — same rule the deposit
// endpoint already applies (../route.ts:87).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo administradores pueden revertir cargos" },
        { status: 403 }
      )
    }

    const { id: clienteId } = await params
    const body = await request.json()
    const data = revertirSchema.parse(body)

    // Pre-validation exists to return a message naming the offending movement.
    // The binding check is the one the RPC does under FOR UPDATE.
    const { data: movimientos, error: movError } = await supabaseAdmin
      .from("cuenta_corriente")
      .select("id, tipo, referencia_tipo, revertido_at")
      .eq("organization_id", organizationId!)
      .eq("cliente_id", clienteId)
      .in("id", data.movimientoIds)

    if (movError) throw movError

    const encontrados = movimientos || []
    if (encontrados.length !== data.movimientoIds.length) {
      return NextResponse.json(
        { error: "Alguno de los movimientos no existe o no pertenece a este cliente" },
        { status: 400 }
      )
    }

    const invalido = encontrados.find(
      (m: any) => m.tipo !== "CARGO" || m.referencia_tipo !== "ORDEN"
    )
    if (invalido) {
      return NextResponse.json(
        { error: "Solo se pueden revertir cargos de fiado de una orden" },
        { status: 400 }
      )
    }

    const yaRevertido = encontrados.find((m: any) => m.revertido_at != null)
    if (yaRevertido) {
      return NextResponse.json(
        { error: "Alguno de los movimientos ya fue revertido" },
        { status: 400 }
      )
    }

    const { data: result, error: rpcError } = await supabaseAdmin.rpc("revertir_cargos_orden", {
      p_org_id: organizationId!,
      p_cliente_id: clienteId,
      p_movimiento_ids: data.movimientoIds,
      p_motivo: data.motivo,
      p_usuario_id: userId!,
    })

    if (rpcError) {
      console.error("Error en revertir_cargos_orden:", rpcError)
      return NextResponse.json(
        { error: rpcError.message || "Error al revertir los cargos" },
        { status: 400 }
      )
    }

    // Un log de auditoría por movimiento revertido (audit.update firma:
    // entity, entityId, before, after — ver lib/audit.ts:209-214).
    const audit = createAuditLogger(organizationId!, userId!, request)
    const revertidos: Array<{ movimientoId: string }> = result?.revertidos ?? []
    const revertidoAt = new Date().toISOString()
    await Promise.all(
      revertidos.map((r) =>
        audit.update(
          "cuenta_corriente",
          r.movimientoId,
          { revertido_at: null },
          { revertido_at: revertidoAt, motivo: data.motivo }
        )
      )
    )

    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error reverting cargos:", err)
    return NextResponse.json({ error: "Error al revertir los cargos" }, { status: 500 })
  }
}
