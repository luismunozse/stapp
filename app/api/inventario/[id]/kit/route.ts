import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

// GET /api/inventario/[id]/kit
// Devuelve receta del kit + costo calculado.
// Query opcional: ?explosionar=true -> incluye lista plana explosionada.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id } = await params
    const { searchParams } = new URL(request.url)
    const explosionar = searchParams.get("explosionar") === "true"

    // Validar pertenencia + traer flags kit
    const { data: kit, error: kitErr } = await supabaseAdmin
      .from("inventario")
      .select(
        "id, codigo, nombre, stock, stock_reservado, precio_compra, precio_venta, es_kit, tipo_kit, imagen_url"
      )
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .single()

    if (kitErr || !kit) {
      return NextResponse.json({ error: "Item no encontrado" }, { status: 404 })
    }

    // Componentes
    const { data: rawComponentes } = await supabaseAdmin
      .from("inventario_kit_items")
      .select(
        "id, kit_id, componente_id, cantidad, es_obligatorio, notas, orden, created_at, updated_at, componente:componente_id(id, codigo, nombre, stock, stock_reservado, precio_compra, imagen_url, es_kit, tipo_kit)"
      )
      .eq("kit_id", id)
      .eq("organization_id", organizationId!)
      .order("orden", { ascending: true })

    const componentes = (rawComponentes || []).map((c: any) => ({
      id: c.id,
      kitId: c.kit_id,
      componenteId: c.componente_id,
      cantidad: c.cantidad,
      esObligatorio: c.es_obligatorio,
      notas: c.notas,
      orden: c.orden,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      componente: c.componente
        ? {
            id: c.componente.id,
            codigo: c.componente.codigo,
            nombre: c.componente.nombre,
            stock: c.componente.stock ?? 0,
            stockReservado: c.componente.stock_reservado ?? 0,
            disponible: Math.max(
              0,
              (c.componente.stock ?? 0) - (c.componente.stock_reservado ?? 0)
            ),
            precioCompra: c.componente.precio_compra ?? 0,
            imagenUrl: c.componente.imagen_url ?? null,
            esKit: c.componente.es_kit ?? false,
            tipoKit: c.componente.tipo_kit ?? null,
          }
        : null,
      subtotalCosto:
        c.cantidad * Number(c.componente?.precio_compra ?? 0),
    }))

    // Costo calculado via RPC (autoritario)
    const { data: costoData } = await supabaseAdmin.rpc("calcular_costo_kit", {
      p_kit_id: id,
      p_org_id: organizationId!,
    })

    let explosionado: any[] | null = null
    if (explosionar) {
      const { data: expData, error: expErr } = await supabaseAdmin.rpc(
        "componentes_explosionados_kit",
        { p_kit_id: id, p_org_id: organizationId! }
      )
      if (!expErr) {
        explosionado = (expData || []).map((r: any) => ({
          componenteId: r.componente_id,
          codigo: r.codigo,
          nombre: r.nombre,
          cantidadTotal: Number(r.cantidad_total),
          precioCompra: Number(r.precio_compra ?? 0),
          costoSubtotal: Number(r.costo_subtotal ?? 0),
          esKit: r.es_kit,
          profundidad: r.profundidad,
        }))
      }
    }

    return NextResponse.json({
      kit: {
        id: kit.id,
        codigo: kit.codigo,
        nombre: kit.nombre,
        stock: kit.stock ?? 0,
        stockReservado: kit.stock_reservado ?? 0,
        precioCompra: kit.precio_compra ?? 0,
        precioVenta: kit.precio_venta ?? 0,
        esKit: kit.es_kit ?? false,
        tipoKit: kit.tipo_kit ?? null,
        imagenUrl: kit.imagen_url ?? null,
      },
      componentes,
      costoCalculado: Number(costoData ?? 0),
      explosionado,
    })
  } catch (err) {
    console.error("Error fetching kit:", err)
    return NextResponse.json(
      { error: "Error al obtener kit" },
      { status: 500 }
    )
  }
}

// PATCH /api/inventario/[id]/kit
// Actualiza flags es_kit / tipo_kit del item (toggle desde UI).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { requireInventarioAccess } = await import("@/lib/auth-utils")
    const { error, organizationId } = await requireInventarioAccess()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const { z } = await import("zod")
    const schema = z.object({
      esKit: z.boolean().optional(),
      tipoKit: z.enum(["ENSAMBLADO", "VIRTUAL"]).nullable().optional(),
    })
    const data = schema.parse(body)

    const update: Record<string, unknown> = {}
    if (data.esKit !== undefined) update.es_kit = data.esKit
    if (data.tipoKit !== undefined) update.tipo_kit = data.tipoKit
    if (data.esKit === true && data.tipoKit === undefined) {
      // Si está activando es_kit y no se mandó tipo, default ENSAMBLADO
      update.tipo_kit = "ENSAMBLADO"
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 })
    }

    const { data: row, error: dbErr } = await supabaseAdmin
      .from("inventario")
      .update(update)
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .select("id, es_kit, tipo_kit")
      .single()

    if (dbErr) throw dbErr
    if (!row) {
      return NextResponse.json({ error: "Item no encontrado" }, { status: 404 })
    }

    return NextResponse.json({
      id: row.id,
      esKit: row.es_kit,
      tipoKit: row.tipo_kit,
    })
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "errors" in err &&
      Array.isArray((err as { errors?: unknown[] }).errors)
    ) {
      const first = (err as { errors: Array<{ message?: string }> }).errors[0]
      return NextResponse.json(
        { error: first?.message ?? "Datos inválidos" },
        { status: 400 }
      )
    }
    console.error("Error patching kit flags:", err)
    return NextResponse.json(
      { error: "Error al actualizar kit" },
      { status: 500 }
    )
  }
}
