import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { aplicarAprobacionCotizacionAOrden } from "@/lib/cotizacion-aprobar-orden"
import { z } from "zod"

const aprobarSchema = z.object({
  firmaAprobacion: z.string().optional().nullable(),
  firmaMime: z.string().optional().nullable(),
  nombreAprobador: z.string().optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

    if (!token || token.length !== 32) {
      return NextResponse.json(
        { error: "Token invalido" },
        { status: 400 }
      )
    }

    const body = await request.json()
    const data = aprobarSchema.parse(body)

    // Find cotizacion by public token (include orden_id and total).
    // Defensa: filtrar `public_token IS NOT NULL` evita que un registro
    // legacy con token null pueda matchear accidentalmente si por algún
    // motivo el query recibiera un valor falsy que pasara el length check.
    const { data: cotizacion, error: fetchError } = await supabaseAdmin
      .from("cotizaciones")
      .select("id, estado, orden_id, total, tipo")
      .eq("public_token", token)
      .not("public_token", "is", null)
      .is("deleted_at", null)
      .single()

    if (fetchError || !cotizacion) {
      return NextResponse.json(
        { error: "Cotizacion no encontrada" },
        { status: 404 }
      )
    }

    if (cotizacion.estado !== "ENVIADA") {
      return NextResponse.json(
        { error: "Solo se pueden aprobar cotizaciones enviadas" },
        { status: 400 }
      )
    }

    // PRESUPUESTO plano no requiere firma; ORDEN sí.
    const esPresupuesto = cotizacion.tipo === "PRESUPUESTO"
    if (!esPresupuesto && (!data.firmaAprobacion || !data.firmaMime)) {
      return NextResponse.json(
        { error: "La firma es requerida" },
        { status: 400 }
      )
    }

    // Update cotizacion to ACEPTADA
    const { error: updateError } = await supabaseAdmin
      .from("cotizaciones")
      .update({
        estado: "ACEPTADA",
        firma_aprobacion: data.firmaAprobacion || null,
        firma_mime: data.firmaMime || null,
        fecha_aprobacion: new Date().toISOString(),
      })
      .eq("id", cotizacion.id)

    if (updateError) throw updateError

    // Reservar stock sólo para tipo ORDEN
    if (!esPresupuesto) {
      try {
        await supabaseAdmin.rpc("reservar_items_cotizacion", {
          p_cotizacion_id: cotizacion.id,
          p_user_id: "system-public",
        })
      } catch (reserveErr) {
        console.error("Error reserving stock for cotizacion:", reserveErr)
      }
    }

    // If cotizacion is linked to an order in PRESUPUESTADO, transition it to APROBADO
    if (cotizacion.orden_id) {
      const { data: orden } = await supabaseAdmin
        .from("ordenes_servicio")
        .select("id, estado, organization_id, sucursal_id, cliente_id, numero_orden, dispositivo, public_token, clientes (id, nombre, email, telefono), organizations (nombre, nombre_mostrar, slug, moneda, zona_horaria)")
        .eq("id", cotizacion.orden_id)
        .single()

      if (orden) {
        await aplicarAprobacionCotizacionAOrden({
          orden: orden as any,
          cotizacionId: cotizacion.id,
          cotizacionTotal: cotizacion.total,
          descripcionEvento: "Cotizacion aprobada por el cliente desde el enlace de cotizacion",
          metadataEvento: { aprobadoDesdePortal: true, cotizacionId: cotizacion.id },
        })
      }
    }

    return NextResponse.json({
      message: "Cotizacion aprobada exitosamente",
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error approving public cotizacion:", error)
    return NextResponse.json(
      { error: "Error al aprobar cotizacion" },
      { status: 500 }
    )
  }
}
