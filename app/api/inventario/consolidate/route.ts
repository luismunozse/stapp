import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

// POST /api/inventario/consolidate
// Mueve el stock del item `sourceId` al `targetId` y archiva el origen.
// Requiere rol admin. Ejecuta la RPC consolidate_inventario_items en una
// transacción del lado de la base para garantizar atomicidad.
const consolidateSchema = z.object({
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
})

export async function POST(request: Request) {
  try {
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const body = await request.json()
    const { sourceId, targetId } = consolidateSchema.parse(body)

    if (sourceId === targetId) {
      return NextResponse.json(
        { error: "El item origen y destino no pueden ser el mismo" },
        { status: 400 }
      )
    }

    // Pre-check de pertenencia a la organización: evita exponer mensajes de
    // error de la RPC cuando el cliente manda ids ajenos.
    const { data: checkRows, error: checkErr } = await supabaseAdmin
      .from("inventario")
      .select("id, organization_id")
      .in("id", [sourceId, targetId])

    if (checkErr) throw checkErr
    if (!checkRows || checkRows.length !== 2) {
      return NextResponse.json({ error: "Items no encontrados" }, { status: 404 })
    }
    if (checkRows.some((r) => r.organization_id !== organizationId)) {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 })
    }

    const { data, error: rpcErr } = await supabaseAdmin.rpc(
      "consolidate_inventario_items",
      {
        p_source_id: sourceId,
        p_target_id: targetId,
        p_user_id: userId!,
      }
    )

    if (rpcErr) {
      return NextResponse.json(
        { error: rpcErr.message || "Error al consolidar items" },
        { status: 400 }
      )
    }

    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error consolidating inventario:", err)
    return NextResponse.json(
      { error: "Error al consolidar items de inventario" },
      { status: 500 }
    )
  }
}
