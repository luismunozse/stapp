import { NextResponse } from "next/server"
import { requireInventarioAccess } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { selectConFallback } from "@/lib/variantes"
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
    const { error, organizationId, userId } = await requireInventarioAccess()
    if (error) return error

    const body = await request.json()
    const { sourceId, targetId } = consolidateSchema.parse(body)

    if (sourceId === targetId) {
      return NextResponse.json(
        { error: "El item origen y destino no pueden ser el mismo" },
        { status: 400 }
      )
    }

    // Pre-check de pertenencia a la organización: filtramos por org en el
    // mismo query para no exponer la existencia de ids de otras organizaciones
    // (timing/respuesta diferenciada permitiría enumerar ids cross-tenant).
    // Si faltan rows, respondemos 404 sin distinguir "no existe" de "ajeno".
    // También se lee `grupo_id` (migración de variantes): sin esa columna se vuelve a leer sin ella.
    const leer = selectConFallback(
      (columnas: string) =>
        supabaseAdmin.from("inventario").select(columnas).eq("organization_id", organizationId!).in("id", [sourceId, targetId]),
      ["id, grupo_id", "id"]
    )
    const { data: checkRows, error: checkErr } = (await leer()) as { data: { id: string; grupo_id?: string | null }[] | null; error: unknown }

    if (checkErr) throw checkErr
    if (!checkRows || checkRows.length !== 2) {
      return NextResponse.json({ error: "Items no encontrados" }, { status: 404 })
    }

    // Consolidar pasa el stock de un item a otro y archiva el origen: con las variantes de un grupo
    // mezclaría el stock de una variante en otra o archivaría a un miembro a espaldas de su grupo.
    if (checkRows.some((fila) => fila.grupo_id)) {
      return NextResponse.json(
        {
          error: "Un producto con variantes no se puede consolidar. Desagrupalo primero si querés unirlo con otro",
          code: "PRODUCTO_CON_VARIANTES",
        },
        { status: 400 }
      )
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
