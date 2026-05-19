import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

// GET /api/conteos/[id]/items?soloPendientes=true|false&soloDiferencia=true|false&search=...
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id } = await params
    const { searchParams } = new URL(request.url)
    const soloPendientes = searchParams.get("soloPendientes") === "true"
    const soloDiferencia = searchParams.get("soloDiferencia") === "true"
    const search = (searchParams.get("search") || "").trim()

    // Verificar pertenencia
    const { data: conteo } = await supabaseAdmin
      .from("conteos_inventario")
      .select("id")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (!conteo) {
      return NextResponse.json({ error: "Conteo no encontrado" }, { status: 404 })
    }

    let query = supabaseAdmin
      .from("conteos_items")
      .select(`
        id, stock_sistema, stock_contado, diferencia, observaciones,
        contado_por, contado_at,
        inventario:inventario_id(id, codigo, nombre, categoria, barcode, imagen_url, ubicacion)
      `)
      .eq("conteo_id", id)
      .order("created_at", { ascending: true })

    if (soloPendientes) query = query.is("stock_contado", null)
    if (soloDiferencia) query = query.neq("diferencia", 0)

    const { data, error: dbErr } = await query
    if (dbErr) throw dbErr

    let rows = data || []
    if (search) {
      const s = search.toLowerCase()
      rows = rows.filter((r: any) => {
        const inv = r.inventario
        return (
          inv?.codigo?.toLowerCase().includes(s) ||
          inv?.nombre?.toLowerCase().includes(s) ||
          inv?.barcode?.toLowerCase().includes(s)
        )
      })
    }

    return NextResponse.json({
      data: rows.map((r: any) => ({
        id: r.id,
        stockSistema: r.stock_sistema,
        stockContado: r.stock_contado,
        diferencia: r.diferencia,
        observaciones: r.observaciones,
        contadoPor: r.contado_por,
        contadoAt: r.contado_at,
        inventario: r.inventario
          ? {
              id: r.inventario.id,
              codigo: r.inventario.codigo,
              nombre: r.inventario.nombre,
              categoria: r.inventario.categoria,
              barcode: r.inventario.barcode,
              imagenUrl: r.inventario.imagen_url,
              ubicacion: r.inventario.ubicacion,
            }
          : null,
      })),
    })
  } catch (err) {
    console.error("Error fetching conteo items:", err)
    return NextResponse.json({ error: "Error al obtener items" }, { status: 500 })
  }
}
