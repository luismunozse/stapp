import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { formatInventario } from "@/lib/db-utils"
import { z } from "zod"

const inventarioSchema = z.object({
  codigo: z.string().min(1, "El código es requerido"),
  nombre: z.string().min(1, "El nombre es requerido"),
  descripcion: z.string().optional(),
  categoria: z.string().min(1, "La categoría es requerida"),
  tipoDispositivo: z.string().min(1, "El tipo de dispositivo es requerido"),
  stock: z.number().int().min(0),
  precioCompra: z.number().min(0),
  precioVenta: z.number().min(0),
  proveedor: z.string().optional(),
})

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const search = searchParams.get("search") || ""
    const categoria = searchParams.get("categoria") || ""
    const tipoDispositivo = searchParams.get("tipoDispositivo") || ""

    let query = supabaseAdmin
      .from("inventario")
      .select("id, codigo, nombre, descripcion, categoria, tipo_dispositivo, stock, precio_compra, precio_venta, proveedor, created_at")
      .eq("organization_id", organizationId!)
      .order("nombre", { ascending: true })

    if (search) {
      query = query.or(`nombre.ilike.%${search}%,codigo.ilike.%${search}%`)
    }

    if (categoria) {
      query = query.eq("categoria", categoria)
    }

    if (tipoDispositivo) {
      query = query.eq("tipo_dispositivo", tipoDispositivo)
    }

    const { data: inventario, error: dbError } = await query

    if (dbError) {
      throw dbError
    }

    return NextResponse.json(inventario?.map(formatInventario), {
      headers: {
        "Cache-Control": "private, max-age=30, stale-while-revalidate=60",
      },
    })
  } catch (error) {
    console.error("Error fetching inventario:", error)
    return NextResponse.json(
      { error: "Error al obtener inventario" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const body = await request.json()
    const data = inventarioSchema.parse(body)

    // Resolver tipo_dispositivo_id desde la tabla tipos_dispositivo
    const { data: tipoDisp } = await supabaseAdmin
      .from("tipos_dispositivo")
      .select("id")
      .eq("organization_id", organizationId!)
      .eq("codigo", data.tipoDispositivo)
      .single()

    const { data: inventario, error: dbError } = await supabaseAdmin
      .from("inventario")
      .insert({
        codigo: data.codigo,
        nombre: data.nombre,
        descripcion: data.descripcion || null,
        categoria: data.categoria,
        tipo_dispositivo: data.tipoDispositivo,
        tipo_dispositivo_id: tipoDisp?.id || null,
        stock: data.stock,
        precio_compra: data.precioCompra,
        precio_venta: data.precioVenta,
        proveedor: data.proveedor || null,
        organization_id: organizationId!,
      })
      .select()
      .single()

    if (dbError) {
      if (dbError.code === "23505") {
        return NextResponse.json(
          { error: "Ya existe un item con ese código" },
          { status: 400 }
        )
      }
      throw dbError
    }

    return NextResponse.json(formatInventario(inventario), { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error creating inventario:", error)
    return NextResponse.json(
      { error: "Error al crear item de inventario" },
      { status: 500 }
    )
  }
}
