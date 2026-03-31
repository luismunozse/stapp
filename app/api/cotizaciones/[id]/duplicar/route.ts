import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { getNextQuoteNumber } from "@/lib/counters"
import { randomBytes } from "crypto"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, role } = await requireAdmin()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo administradores pueden duplicar cotizaciones" },
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
