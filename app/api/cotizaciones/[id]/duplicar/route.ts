import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { getNextQuoteNumber } from "@/lib/counters"
import { hasPlanFeature } from "@/lib/subscriptions"
import { randomBytes } from "crypto"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    const hasCotizaciones = await hasPlanFeature(organizationId!, "cotizaciones_online")
    if (!hasCotizaciones) {
      return NextResponse.json(
        { error: "Las cotizaciones requieren el plan Profesional", code: "FEATURE_REQUIRED", feature: "cotizaciones_online" },
        { status: 403 }
      )
    }

    const { id } = await params

    // Fetch source cotizacion with items
    const { data: source, error: fetchError } = await supabaseAdmin
      .from("cotizaciones")
      .select(`
        *,
        items_cotizacion (*)
      `)
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (fetchError || !source) {
      return NextResponse.json(
        { error: "Cotizacion no encontrada" },
        { status: 404 }
      )
    }

    // TECNICO sólo puede duplicar cotizaciones creadas por él mismo
    if (role === "TECNICO" && source.created_by !== userId) {
      return NextResponse.json(
        { error: "No autorizado para duplicar esta cotización" },
        { status: 403 }
      )
    }

    // Get org config for default validity days
    const { data: orgConfig } = await supabaseAdmin
      .from("organizations")
      .select("cotizacion_validez_dias")
      .eq("id", organizationId!)
      .single()

    const validezDias = orgConfig?.cotizacion_validez_dias || 30
    const fechaVencimiento = new Date()
    fechaVencimiento.setDate(fechaVencimiento.getDate() + validezDias)

    // Generate new number and token
    const numeroCotizacion = await getNextQuoteNumber(organizationId!)
    const publicToken = randomBytes(16).toString("hex")

    // Create the duplicate cotizacion
    const { data: newCotizacion, error: createError } = await supabaseAdmin
      .from("cotizaciones")
      .insert({
        organization_id: organizationId,
        cliente_id: source.cliente_id,
        sector_id: source.sector_id,
        orden_id: null, // duplicates are standalone
        numero_cotizacion: numeroCotizacion,
        public_token: publicToken,
        estado: "BORRADOR",
        notas: source.notas,
        terminos: source.terminos,
        fecha_vencimiento: fechaVencimiento.toISOString(),
        descuento_global_tipo: source.descuento_global_tipo,
        descuento_global_valor: source.descuento_global_valor,
        iva_porcentaje: source.iva_porcentaje,
        subtotal: source.subtotal,
        iva: source.iva,
        total: source.total,
        created_by: userId,
      })
      .select()
      .single()

    if (createError) throw createError

    // Duplicate items
    const items = source.items_cotizacion || []
    if (items.length > 0) {
      const { error: itemsError } = await supabaseAdmin
        .from("items_cotizacion")
        .insert(
          items.map((item: any) => ({
            cotizacion_id: newCotizacion.id,
            descripcion: item.descripcion,
            cantidad: item.cantidad,
            precio_unitario: item.precio_unitario,
            subtotal: item.subtotal,
            unidad: item.unidad || "Unidad",
            descuento_tipo: item.descuento_tipo || "porcentaje",
            descuento_valor: item.descuento_valor || 0,
            // Copiar fielmente links y snapshots del item origen para no perder
            // inventario (reserva/descuento de stock al ACEPTAR/convertir),
            // costo histórico (margen) ni la disclosure de repuesto.
            inventario_id: item.inventario_id ?? null,
            costo_unitario: item.costo_unitario ?? null,
            tipo_repuesto: item.tipo_repuesto || "NO_APLICA",
            catalogo_item_id: item.catalogo_item_id ?? null,
          }))
        )

      if (itemsError) {
        // Cleanup on failure
        await supabaseAdmin.from("cotizaciones").delete().eq("id", newCotizacion.id)
        throw itemsError
      }
    }

    return NextResponse.json(
      { id: newCotizacion.id, numeroCotizacion },
      { status: 201 }
    )
  } catch (error) {
    console.error("Error duplicating cotizacion:", error)
    return NextResponse.json(
      { error: "Error al duplicar cotizacion" },
      { status: 500 }
    )
  }
}
