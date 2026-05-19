import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const itemSchema = z.object({
  componenteId: z.string().min(1),
  cantidad: z.number().int().positive(),
  notas: z.string().trim().max(500).nullable().optional(),
})

const bodySchema = z.union([
  itemSchema,
  z.object({ items: z.array(itemSchema).min(1) }),
])

// POST /api/inventario/[id]/kit/componentes
// Body: { componenteId, cantidad, notas? }  OR  { items: [{...}, {...}] }
// Llama RPC agregar_componente_kit por cada item (upsert: si existe, suma).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const parsed = bodySchema.parse(body)

    const items =
      "items" in parsed
        ? parsed.items
        : [parsed]

    const resultados: Array<{
      componenteId: string
      ok: boolean
      error?: string
      data?: unknown
    }> = []

    for (const it of items) {
      const { data, error: rpcErr } = await supabaseAdmin.rpc(
        "agregar_componente_kit",
        {
          p_kit_id: id,
          p_componente_id: it.componenteId,
          p_cantidad: it.cantidad,
          p_org_id: organizationId!,
          p_user_id: userId ?? null,
          p_notas: it.notas ?? null,
        }
      )

      if (rpcErr) {
        const code = (rpcErr as { code?: string }).code
        const status = code === "P0002" ? 404 : code === "22023" ? 400 : 500
        resultados.push({
          componenteId: it.componenteId,
          ok: false,
          error: rpcErr.message,
        })
        // Si solo había uno, abortar con código apropiado
        if (items.length === 1) {
          return NextResponse.json({ error: rpcErr.message }, { status })
        }
      } else {
        resultados.push({ componenteId: it.componenteId, ok: true, data })
      }
    }

    const okCount = resultados.filter((r) => r.ok).length
    const status =
      okCount === resultados.length ? 201 : okCount === 0 ? 400 : 207
    return NextResponse.json({ resultados, okCount }, { status })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error agregando componentes a kit:", err)
    return NextResponse.json(
      { error: "Error al agregar componentes" },
      { status: 500 }
    )
  }
}
