import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth, requireAdminOrVendedor } from "@/lib/auth-utils"
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
    const { error, organizationId } = await requireAuth()
    if (error) return error
    const { id } = await params
    const search = new URL(request.url).searchParams.get("q")?.trim().toLowerCase() || ""

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
    return NextResponse.json((data || []).map(formatProveedorCatalogoItem))
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
    const { error, organizationId } = await requireAdminOrVendedor()
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
    return NextResponse.json(formatProveedorCatalogoItem(created), { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error creating catalogo item:", err)
    return NextResponse.json({ error: "Error al crear item" }, { status: 500 })
  }
}
