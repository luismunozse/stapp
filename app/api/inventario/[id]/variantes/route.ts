import { NextResponse } from "next/server"
import { requireAuth, requireInventarioAccess, hasInventarioAccess, resolveVendedoresHabilitados } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

// ============================================================
// /api/inventario/[id]/variantes
//
// GET  - lista variantes de un item (filtro ?activo=true|false)
// POST - crea una o varias variantes. Acepta objeto único o array.
//        Si array, se enruta vía RPC crear_variantes_bulk (atómico).
// ============================================================

// includeCost defaults true: POST calls this only after requireInventarioAccess
// already granted cost access, so it doesn't need to pass the flag explicitly.
function formatVariante(row: any, includeCost = true) {
  return {
    id: row.id,
    inventarioId: row.inventario_id,
    nombre: row.nombre,
    atributos: row.atributos ?? {},
    codigoVariante: row.codigo_variante,
    barcode: row.barcode,
    stock: row.stock,
    stockReservado: row.stock_reservado,
    stockDisponible: Math.max(0, (row.stock ?? 0) - (row.stock_reservado ?? 0)),
    precioCompra: includeCost && row.precio_compra !== null && row.precio_compra !== undefined
      ? Number(row.precio_compra)
      : null,
    precioVenta: row.precio_venta !== null && row.precio_venta !== undefined
      ? Number(row.precio_venta)
      : null,
    imagenUrl: row.imagen_url,
    imagenPath: row.imagen_path,
    activo: row.activo,
    orden: row.orden,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const varianteInputSchema = z.object({
  nombre: z.string().min(1).max(200),
  codigoVariante: z.string().min(1).max(80),
  atributos: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  barcode: z.string().max(80).nullable().optional(),
  stock: z.number().int().min(0).max(1_000_000).optional(),
  precioCompra: z.number().min(0).nullable().optional(),
  precioVenta: z.number().min(0).nullable().optional(),
  activo: z.boolean().optional(),
  orden: z.number().int().min(0).optional(),
})

const postSchema = z.union([
  varianteInputSchema,
  z.array(varianteInputSchema).min(1).max(200),
])

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, role } = await requireAuth()
    if (error) return error

    const { id } = await params
    const url = new URL(request.url)
    const activoParam = url.searchParams.get("activo")

    let query = supabaseAdmin
      .from("inventario_variantes")
      .select("*")
      .eq("inventario_id", id)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .order("orden", { ascending: true })
      .order("created_at", { ascending: true })

    if (activoParam === "true") query = query.eq("activo", true)
    if (activoParam === "false") query = query.eq("activo", false)

    const { data, error: dbErr } = await query
    if (dbErr) throw dbErr

    // Obtener parent para validar pertenencia y stock totales
    const { data: parent } = await supabaseAdmin
      .from("inventario")
      .select("id, nombre, stock, stock_reservado, tiene_variantes, precio_compra, precio_venta")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .maybeSingle()

    if (!parent) {
      return NextResponse.json({ error: "Item no encontrado" }, { status: 404 })
    }

    const vendedoresHabilitados = role === "VENDEDOR"
      ? await resolveVendedoresHabilitados(organizationId!)
      : false
    const canViewCost = hasInventarioAccess(role, vendedoresHabilitados)

    const variantes = (data || []).map((v) => formatVariante(v, canViewCost))
    const sumStock = variantes.reduce((s, v) => s + v.stock, 0)
    const sumReservado = variantes.reduce((s, v) => s + v.stockReservado, 0)

    return NextResponse.json({
      data: variantes,
      parent: {
        id: parent.id,
        nombre: parent.nombre,
        stock: parent.stock,
        stockReservado: parent.stock_reservado,
        tieneVariantes: parent.tiene_variantes,
        precioCompra: canViewCost && parent.precio_compra !== null && parent.precio_compra !== undefined
          ? Number(parent.precio_compra)
          : null,
        precioVenta: parent.precio_venta !== null && parent.precio_venta !== undefined
          ? Number(parent.precio_venta)
          : null,
      },
      totals: {
        stock: sumStock,
        stockReservado: sumReservado,
      },
    })
  } catch (err) {
    console.error("Error fetching variantes:", err)
    return NextResponse.json({ error: "Error al obtener variantes" }, { status: 500 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId } = await requireInventarioAccess()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const parsed = postSchema.parse(body)

    const arr = Array.isArray(parsed) ? parsed : [parsed]

    // Transformar a snake_case para la RPC
    const payload = arr.map((v) => ({
      nombre: v.nombre.trim(),
      codigo_variante: v.codigoVariante.trim(),
      atributos: v.atributos ?? {},
      barcode: v.barcode?.trim() || null,
      stock: v.stock ?? 0,
      precio_compra: v.precioCompra ?? null,
      precio_venta: v.precioVenta ?? null,
      activo: v.activo ?? true,
      orden: v.orden ?? 0,
    }))

    const { data, error: rpcErr } = await supabaseAdmin.rpc("crear_variantes_bulk", {
      p_inv_id: id,
      p_org: organizationId!,
      p_user: userId!,
      p_variantes: payload,
    })

    if (rpcErr) {
      if (rpcErr.code === "P0002") {
        return NextResponse.json({ error: "Item no encontrado" }, { status: 404 })
      }
      if (rpcErr.code === "23505") {
        return NextResponse.json({ error: rpcErr.message }, { status: 409 })
      }
      if (rpcErr.code === "22023") {
        return NextResponse.json({ error: rpcErr.message }, { status: 400 })
      }
      throw rpcErr
    }

    const result = data as { success: boolean; ids: string[]; count: number }

    // Releer las variantes recién creadas para devolverlas
    const { data: rows } = await supabaseAdmin
      .from("inventario_variantes")
      .select("*")
      .in("id", result.ids)

    return NextResponse.json({
      success: true,
      count: result.count,
      // Wrapped on purpose: passing `formatVariante` bare to `.map` feeds the
      // array index into `includeCost`, which strips the cost off index 0.
      data: (rows || []).map((r) => formatVariante(r)),
    }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    // FK unique violation fallback
    if ((err as any)?.code === "23505") {
      return NextResponse.json(
        { error: "Código de variante o barcode duplicado" },
        { status: 409 }
      )
    }
    console.error("Error creating variantes:", err)
    return NextResponse.json({ error: "Error al crear variantes" }, { status: 500 })
  }
}
