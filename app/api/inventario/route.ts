import { NextResponse } from "next/server"
import { requireAuth, requireAdminOrVendedor } from "@/lib/auth-utils"
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
  stockMinimo: z.number().int().min(0).nullable().optional(),
  stockMaximo: z.number().int().min(0).nullable().optional(),
  puntoReorden: z.number().int().min(0).nullable().optional(),
})

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const search = searchParams.get("search") || ""
    const categoria = searchParams.get("categoria") || ""
    const tipoDispositivo = searchParams.get("tipoDispositivo") || ""
    const bajoStock = searchParams.get("bajoStock") === "true"

    // Paginación
    const page = parseInt(searchParams.get("page") || "1")
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100)
    const offset = (page - 1) * limit

    // Sorting
    const sortByParam = searchParams.get("sortBy") || "nombre"
    const sortMap: Record<string, string> = {
      nombre: "nombre",
      codigo: "codigo",
      stock: "stock",
      precioVenta: "precio_venta",
      precioCompra: "precio_compra",
      categoria: "categoria",
      createdAt: "created_at",
    }
    const sortBy = sortMap[sortByParam] || "nombre"
    const sortOrder = searchParams.get("sortOrder") === "desc" ? false : true

    const includeArchived = searchParams.get("includeArchived") === "true"

    let query = supabaseAdmin
      .from("inventario")
      .select("id, codigo, nombre, descripcion, categoria, tipo_dispositivo, stock, precio_compra, precio_venta, proveedor, stock_minimo, stock_maximo, punto_reorden, deleted_at, deleted_by, created_at", { count: "exact" })
      .eq("organization_id", organizationId!)
      .order(sortBy, { ascending: sortOrder })

    if (!includeArchived) {
      query = query.is("deleted_at", null)
    }

    if (search) {
      query = query.or(
        `nombre.ilike.%${search}%,codigo.ilike.%${search}%,descripcion.ilike.%${search}%,proveedor.ilike.%${search}%`
      )
    }

    if (categoria) {
      query = query.eq("categoria", categoria)
    }

    if (tipoDispositivo) {
      query = query.eq("tipo_dispositivo", tipoDispositivo)
    }

    if (bajoStock) {
      const { data: org } = await supabaseAdmin
        .from("organizations")
        .select("umbral_stock_bajo")
        .eq("id", organizationId!)
        .single()
      const globalThreshold = org?.umbral_stock_bajo ?? 5
      // Use global threshold as server filter. Items with custom stock_minimo
      // are also highlighted on the frontend via per-item comparison.
      query = query.lte("stock", globalThreshold)
    }

    // Aplicar paginación
    query = query.range(offset, offset + limit - 1)

    const { data: inventario, error: dbError, count } = await query

    if (dbError) {
      throw dbError
    }

    return NextResponse.json({
      data: inventario?.map(formatInventario),
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    }, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
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
    const { error, organizationId } = await requireAdminOrVendedor()
    if (error) return error

    const body = await request.json()
    const data = inventarioSchema.parse(body)

    let codigo = data.codigo
    let inventario = null
    let retries = 3

    while (retries > 0) {
      const { data: result, error: dbError } = await supabaseAdmin
        .from("inventario")
        .insert({
          codigo,
          nombre: data.nombre,
          descripcion: data.descripcion || null,
          categoria: data.categoria,
          tipo_dispositivo: data.tipoDispositivo,
          stock: data.stock,
          precio_compra: data.precioCompra,
          precio_venta: data.precioVenta,
          proveedor: data.proveedor || null,
          stock_minimo: data.stockMinimo ?? null,
          stock_maximo: data.stockMaximo ?? null,
          punto_reorden: data.puntoReorden ?? null,
          organization_id: organizationId!,
        })
        .select()
        .single()

      if (!dbError) {
        inventario = result
        break
      }

      if (dbError.code === "23505") {
        // Código duplicado: generar siguiente código automáticamente
        retries--
        if (retries === 0) {
          return NextResponse.json(
            { error: "No se pudo generar un código único. Intentá de nuevo." },
            { status: 400 }
          )
        }
        const match = codigo.match(/^(.+-?)(\d+)$/)
        if (match) {
          const prefix = match[1]
          const num = parseInt(match[2], 10) + 1
          codigo = `${prefix}${num.toString().padStart(match[2].length, "0")}`
        } else {
          return NextResponse.json(
            { error: "Ya existe un item con ese código" },
            { status: 400 }
          )
        }
        continue
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
