import { NextResponse } from "next/server"
import { z } from "zod"
import {
  requireAuth,
  requireAdminOrVendedor,
  hasInventarioAccess,
  resolveVendedoresHabilitados,
} from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { formatProveedorCatalogoItem } from "@/lib/db-utils"

const itemSchema = z.object({
  nombre: z.string().min(1, "Nombre requerido"),
  codigoProveedor: z.string().optional(),
  descripcion: z.string().optional(),
  precioReferencia: z.number().min(0).optional().nullable(),
  moneda: z.string().max(8).optional(),
  unidad: z.string().max(40).optional(),
  notas: z.string().optional(),
  inventarioId: z.string().optional().nullable(),
})

async function ensureProveedor(id: string, organizationId: string) {
  const { data } = await supabaseAdmin
    .from("proveedores")
    .select("id")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .single()
  return !!data
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, role } = await requireAuth()
    if (error) return error
    const { id } = await params
    const search = new URL(request.url).searchParams.get("q")?.trim().toLowerCase() || ""

    // precioReferencia es el precio de compra al proveedor y el item linkea un
    // inventario_id, así que es costo por item. Mismo permiso que las otras dos
    // tabs de esta misma página (stats.valorCostoStock y comparativa.precioCompra).
    const vendedoresHabilitados = role === "VENDEDOR"
      ? await resolveVendedoresHabilitados(organizationId!)
      : false
    const canViewCost = hasInventarioAccess(role, vendedoresHabilitados)

    let query = supabaseAdmin
      .from("proveedor_catalogo_items")
      .select("*, inventario:inventario_id(id, codigo, nombre)")
      .eq("proveedor_id", id)
      .eq("organization_id", organizationId!)
      .order("nombre", { ascending: true })

    if (search) {
      query = query.or(`nombre.ilike.%${search}%,codigo_proveedor.ilike.%${search}%`)
    }

    const { data, error: dbErr } = await query
    if (dbErr) throw dbErr

    // canViewCost viaja explícito: precioReferencia es nullable de por sí, así
    // que una celda en null no distingue "sin precio cargado" de "precio
    // oculto". Sin el flag, la tab tendría que adivinar y le escondería el
    // input de precio a un ADMIN cuyo catálogo todavía no tiene precios.
    return NextResponse.json({
      items: (data || []).map((item: any) => formatProveedorCatalogoItem(item, canViewCost)),
      canViewCost,
    })
  } catch (err) {
    console.error("Error fetching catalogo:", err)
    return NextResponse.json({ error: "Error al obtener catálogo" }, { status: 500 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, role } = await requireAdminOrVendedor()
    if (error) return error
    const { id } = await params

    if (!(await ensureProveedor(id, organizationId!))) {
      return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 })
    }

    const body = await request.json()
    const data = itemSchema.parse(body)

    const { data: created, error: dbErr } = await supabaseAdmin
      .from("proveedor_catalogo_items")
      .insert({
        proveedor_id: id,
        organization_id: organizationId!,
        inventario_id: data.inventarioId || null,
        codigo_proveedor: data.codigoProveedor || null,
        nombre: data.nombre,
        descripcion: data.descripcion || null,
        precio_referencia: data.precioReferencia ?? null,
        moneda: data.moneda || "ARS",
        unidad: data.unidad || null,
        notas: data.notas || null,
      })
      .select("*, inventario:inventario_id(id, codigo, nombre)")
      .single()

    if (dbErr) throw dbErr

    // requireAdminOrVendedor deja pasar a un VENDEDOR sin acceso a inventario:
    // el eco del row recién escrito respeta el mismo gate que el GET.
    const vendedoresHabilitados = role === "VENDEDOR"
      ? await resolveVendedoresHabilitados(organizationId!)
      : false
    const canViewCost = hasInventarioAccess(role, vendedoresHabilitados)

    return NextResponse.json(formatProveedorCatalogoItem(created, canViewCost), { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error creating catalogo item:", err)
    return NextResponse.json({ error: "Error al crear item" }, { status: 500 })
  }
}
