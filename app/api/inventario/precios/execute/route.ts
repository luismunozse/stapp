import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

const updateSchema = z.object({
  id: z.string().min(1),
  precioCompraNuevo: z.number().min(0).nullable().optional(),
  precioVentaNuevo: z.number().min(0).nullable().optional(),
})

const schema = z.object({
  updates: z.array(updateSchema).min(1, "No hay cambios para aplicar"),
  motivo: z.string().min(1).max(200).optional(),
})

// Chunk grande para mantener cada llamada RPC en una sola transacción razonable.
// Si el batch supera este tamaño, partimos en RPCs separadas (cada una atómica
// dentro de sí misma, no entre sí).
const RPC_BATCH_SIZE = 500

export async function POST(request: Request) {
  try {
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const body = await request.json()
    const { updates, motivo } = schema.parse(body)

    let totalUpdated = 0
    let totalSkipped = 0
    const notFound: string[] = []

    for (let i = 0; i < updates.length; i += RPC_BATCH_SIZE) {
      const slice = updates.slice(i, i + RPC_BATCH_SIZE).map((u) => ({
        id: u.id,
        precio_compra_nuevo: u.precioCompraNuevo ?? null,
        precio_venta_nuevo: u.precioVentaNuevo ?? null,
      }))

      const { data, error: rpcErr } = await supabaseAdmin.rpc("apply_precios_batch", {
        p_organization_id: organizationId!,
        p_user_id: userId ?? null,
        p_motivo: motivo ?? null,
        p_updates: slice,
      })

      if (rpcErr) throw rpcErr

      const result = data as { updated: number; skipped: number; notFound: string[] }
      totalUpdated += result.updated ?? 0
      totalSkipped += result.skipped ?? 0
      if (Array.isArray(result.notFound) && result.notFound.length > 0) {
        notFound.push(...result.notFound)
      }
    }

    if (totalUpdated === 0 && notFound.length === updates.length) {
      return NextResponse.json(
        { error: "Ningún ítem pertenece a tu organización" },
        { status: 403 }
      )
    }

    return NextResponse.json({
      updated: totalUpdated,
      skipped: totalSkipped,
      notFound,
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error executing precios import:", err)
    return NextResponse.json({ error: "Error al aplicar los cambios" }, { status: 500 })
  }
}
