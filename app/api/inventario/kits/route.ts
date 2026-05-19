import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

// GET /api/inventario/kits
// Lista items con es_kit=true, con conteo de componentes y costo calculado.
export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const search = searchParams.get("search")?.trim() ?? ""
    const tipoKit = searchParams.get("tipoKit") // "ENSAMBLADO" | "VIRTUAL" | null

    let query = supabaseAdmin
      .from("inventario")
      .select(
        "id, codigo, nombre, stock, stock_reservado, precio_compra, precio_venta, tipo_kit, imagen_url, categoria, tipo_dispositivo",
        { count: "exact" }
      )
      .eq("organization_id", organizationId!)
      .eq("es_kit", true)
      .is("deleted_at", null)
      .order("nombre", { ascending: true })

    if (tipoKit === "ENSAMBLADO" || tipoKit === "VIRTUAL") {
      query = query.eq("tipo_kit", tipoKit)
    }

    if (search.length > 0) {
      const safe = search.replace(/[,()\\]/g, "\\$&")
      query = query.or(`nombre.ilike.%${safe}%,codigo.ilike.%${safe}%`)
    }

    const { data: kits, error: dbErr, count } = await query
    if (dbErr) throw dbErr

    const kitIds = (kits || []).map((k) => k.id)

    // Conteo de componentes por kit
    let conteoMap = new Map<string, number>()
    if (kitIds.length > 0) {
      const { data: items } = await supabaseAdmin
        .from("inventario_kit_items")
        .select("kit_id")
        .in("kit_id", kitIds)
        .eq("organization_id", organizationId!)

      for (const r of items || []) {
        conteoMap.set(r.kit_id, (conteoMap.get(r.kit_id) ?? 0) + 1)
      }
    }

    // Costo agregado por kit (consulta directa en lugar de N RPCs)
    let costoMap = new Map<string, number>()
    if (kitIds.length > 0) {
      const { data: costRows } = await supabaseAdmin
        .from("inventario_kit_items")
        .select("kit_id, cantidad, componente:componente_id(precio_compra)")
        .in("kit_id", kitIds)
        .eq("organization_id", organizationId!)

      for (const raw of costRows || []) {
        const r = raw as unknown as {
          kit_id: string
          cantidad: number
          componente:
            | { precio_compra: number | null }
            | Array<{ precio_compra: number | null }>
            | null
        }
        const comp = Array.isArray(r.componente)
          ? r.componente[0] ?? null
          : r.componente
        const precio = Number(comp?.precio_compra ?? 0)
        const sub = r.cantidad * precio
        costoMap.set(r.kit_id, (costoMap.get(r.kit_id) ?? 0) + sub)
      }
    }

    const data = (kits || []).map((k) => ({
      id: k.id,
      codigo: k.codigo,
      nombre: k.nombre,
      stock: k.stock ?? 0,
      stockReservado: k.stock_reservado ?? 0,
      precioCompra: Number(k.precio_compra ?? 0),
      precioVenta: Number(k.precio_venta ?? 0),
      tipoKit: k.tipo_kit ?? null,
      imagenUrl: k.imagen_url ?? null,
      categoria: k.categoria,
      tipoDispositivo: k.tipo_dispositivo,
      cantidadComponentes: conteoMap.get(k.id) ?? 0,
      costoCalculado: costoMap.get(k.id) ?? 0,
    }))

    return NextResponse.json({
      data,
      total: count ?? data.length,
    })
  } catch (err) {
    console.error("Error fetching kits:", err)
    return NextResponse.json(
      { error: "Error al obtener kits" },
      { status: 500 }
    )
  }
}
