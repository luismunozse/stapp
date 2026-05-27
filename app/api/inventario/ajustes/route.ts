import { NextResponse } from "next/server"
import { revalidateTag } from "next/cache"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const ajusteSchema = z.object({
  inventarioId: z.string().min(1),
  tipo: z.enum(["MERMA", "ROTURA", "ROBO", "OBSOLESCENCIA", "DONACION", "AJUSTE_FISICO", "OTRO"]),
  direccion: z.enum(["SALIDA", "ENTRADA"]).default("SALIDA"),
  cantidad: z.number().int().positive(),
  motivo: z.string().optional().nullable(),
  comprobanteUrl: z.string().url().optional().nullable(),
  afectaRentabilidad: z.boolean().default(true),
})

// GET - listado de ajustes (opcionalmente filtrado por item, tipo, fechas)
export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const inventarioId = searchParams.get("inventarioId")
    const tipo = searchParams.get("tipo")
    const desde = searchParams.get("desde")
    const hasta = searchParams.get("hasta")

    let q = supabaseAdmin
      .from("ajustes_inventario")
      .select(`
        id, tipo, direccion, cantidad, costo_unitario_snapshot,
        motivo, comprobante_url, fecha, afecta_rentabilidad,
        inventario:inventario_id(id, nombre, codigo),
        users:user_id(id, nombre)
      `)
      .eq("organization_id", organizationId!)
      .order("fecha", { ascending: false })

    if (inventarioId) q = q.eq("inventario_id", inventarioId)
    if (tipo) q = q.eq("tipo", tipo)
    if (desde) q = q.gte("fecha", desde)
    if (hasta) q = q.lte("fecha", hasta)

    const { data, error: dbError } = await q
    if (dbError) throw dbError

    return NextResponse.json(
      (data || []).map((a: any) => ({
        id: a.id,
        tipo: a.tipo,
        direccion: a.direccion,
        cantidad: a.cantidad,
        costoUnitarioSnapshot: a.costo_unitario_snapshot ? parseFloat(a.costo_unitario_snapshot) : 0,
        costoTotal: (a.cantidad || 0) * (parseFloat(a.costo_unitario_snapshot || "0")),
        motivo: a.motivo,
        comprobanteUrl: a.comprobante_url,
        fecha: a.fecha,
        afectaRentabilidad: a.afecta_rentabilidad,
        inventario: a.inventario ? { id: a.inventario.id, nombre: a.inventario.nombre, codigo: a.inventario.codigo } : null,
        user: a.users ? { id: a.users.id, nombre: a.users.nombre } : null,
      }))
    )
  } catch (err) {
    console.error("Error fetching ajustes:", err)
    return NextResponse.json({ error: "Error al obtener ajustes" }, { status: 500 })
  }
}

// POST - crear ajuste atómico
export async function POST(request: Request) {
  try {
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const body = await request.json()
    const data = ajusteSchema.parse(body)

    // Verificar que el item pertenece a la org
    const { data: item } = await supabaseAdmin
      .from("inventario")
      .select("id")
      .eq("id", data.inventarioId)
      .eq("organization_id", organizationId!)
      .single()

    if (!item) return NextResponse.json({ error: "Item no encontrado" }, { status: 404 })

    const { data: result, error: rpcError } = await supabaseAdmin.rpc("aplicar_ajuste_inventario", {
      p_inventario_id: data.inventarioId,
      p_tipo: data.tipo,
      p_direccion: data.direccion,
      p_cantidad: data.cantidad,
      p_motivo: data.motivo || null,
      p_comprobante_url: data.comprobanteUrl || null,
      p_afecta_rentabilidad: data.afectaRentabilidad,
      p_user_id: userId!,
    })

    if (rpcError) throw rpcError
    if (result?.error) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    revalidateTag("catalogo", "max")

    return NextResponse.json({ success: true, id: result.id, nuevoStock: result.nuevoStock }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error creando ajuste:", err)
    return NextResponse.json({ error: "Error al crear ajuste" }, { status: 500 })
  }
}
