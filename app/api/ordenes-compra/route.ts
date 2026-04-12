import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { parsePagination } from "@/lib/api-utils"
import { z } from "zod"

const itemSchema = z.object({
  inventarioId: z.string().min(1),
  cantidadPedida: z.number().int().positive(),
  precioUnitario: z.number().min(0),
})

const createSchema = z.object({
  proveedorId: z.string().min(1).nullable().optional(),
  fechaRecepcionEsperada: z.string().nullable().optional(),
  notas: z.string().nullable().optional(),
  items: z.array(itemSchema).min(1, "Debe tener al menos un item"),
})

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const { page, limit, offset } = parsePagination(searchParams)
    const estado = searchParams.get("estado")
    const proveedorId = searchParams.get("proveedorId")

    let query = supabaseAdmin
      .from("ordenes_compra")
      .select(
        "*, proveedores:proveedor_id(id, nombre), users:created_by(id, nombre), items_orden_compra(id, inventario_id, cantidad_pedida, cantidad_recibida, precio_unitario, subtotal, inventario:inventario_id(id, codigo, nombre))",
        { count: "exact" }
      )
      .eq("organization_id", organizationId!)
      .order("created_at", { ascending: false })

    if (estado) query = query.eq("estado", estado)
    if (proveedorId) query = query.eq("proveedor_id", proveedorId)

    query = query.range(offset, offset + limit - 1)

    const { data, error: dbError, count } = await query

    if (dbError) throw dbError

    return NextResponse.json({
      data: (data || []).map(formatOC),
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    })
  } catch (error) {
    console.error("Error fetching ordenes de compra:", error)
    return NextResponse.json({ error: "Error al obtener órdenes de compra" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const body = await request.json()
    const data = createSchema.parse(body)

    // Get next OC number
    const { data: numeroOC, error: numError } = await supabaseAdmin
      .rpc("get_next_oc_number", { p_org_id: organizationId! })

    if (numError) throw numError

    const items = data.items.map((item) => ({
      ...item,
      subtotal: item.cantidadPedida * item.precioUnitario,
    }))

    const subtotal = items.reduce((sum, i) => sum + i.subtotal, 0)

    const { data: oc, error: createError } = await supabaseAdmin
      .from("ordenes_compra")
      .insert({
        organization_id: organizationId!,
        proveedor_id: data.proveedorId || null,
        numero_oc: numeroOC,
        estado: "BORRADOR",
        fecha_recepcion_esperada: data.fechaRecepcionEsperada || null,
        notas: data.notas || null,
        subtotal,
        total: subtotal,
        created_by: userId,
      })
      .select("*")
      .single()

    if (createError) throw createError

    // Insert items
    const { error: itemsError } = await supabaseAdmin
      .from("items_orden_compra")
      .insert(
        items.map((item) => ({
          orden_compra_id: oc.id,
          inventario_id: item.inventarioId,
          cantidad_pedida: item.cantidadPedida,
          precio_unitario: item.precioUnitario,
          subtotal: item.subtotal,
        }))
      )

    if (itemsError) {
      await supabaseAdmin.from("ordenes_compra").delete().eq("id", oc.id)
      throw itemsError
    }

    return NextResponse.json(formatOC(oc), { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    console.error("Error creating orden de compra:", error)
    return NextResponse.json({ error: "Error al crear orden de compra" }, { status: 500 })
  }
}

function formatOC(oc: any) {
  return {
    id: oc.id,
    numeroOC: oc.numero_oc,
    estado: oc.estado,
    proveedorId: oc.proveedor_id,
    proveedor: oc.proveedores ? { id: oc.proveedores.id, nombre: oc.proveedores.nombre } : null,
    fechaEmision: oc.fecha_emision,
    fechaRecepcionEsperada: oc.fecha_recepcion_esperada,
    fechaRecepcionReal: oc.fecha_recepcion_real,
    subtotal: oc.subtotal,
    total: oc.total,
    notas: oc.notas,
    createdBy: oc.users ? { id: oc.users.id, nombre: oc.users.nombre } : null,
    createdAt: oc.created_at,
    updatedAt: oc.updated_at,
    items: oc.items_orden_compra?.map((i: any) => ({
      id: i.id,
      inventarioId: i.inventario_id,
      inventario: i.inventario ? { id: i.inventario.id, codigo: i.inventario.codigo, nombre: i.inventario.nombre } : null,
      cantidadPedida: i.cantidad_pedida,
      cantidadRecibida: i.cantidad_recibida,
      precioUnitario: i.precio_unitario,
      subtotal: i.subtotal,
    })),
  }
}
