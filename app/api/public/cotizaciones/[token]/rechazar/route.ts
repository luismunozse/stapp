import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { transicionarOrden } from "@/lib/orden-transicion"

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

    let motivo: string | null = null
    try {
      const body = await request.json()
      motivo = body.motivo || null
    } catch {
      // Body is optional
    }

    // Find cotizacion. `not("public_token", "is", null)` es defensa adicional
    // contra registros legacy con token null (el length check arriba ya rechaza
    // tokens vacíos, pero esto blinda contra cualquier sorpresa de Supabase).
    const { data: cotizacion, error: fetchError } = await supabaseAdmin
      .from("cotizaciones")
      .select("id, estado, orden_id, organization_id")
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
        { error: "Solo cotizaciones enviadas pueden ser rechazadas" },
        { status: 400 }
      )
    }

    // Update cotizacion
    const { error: updateError } = await supabaseAdmin
      .from("cotizaciones")
      .update({
        estado: "RECHAZADA",
        motivo_rechazo: motivo,
      })
      .eq("id", cotizacion.id)

    if (updateError) throw updateError

    // El UPDATE de arriba dispara cotizaciones_liberar_reserva_catalogo, que
    // devuelve la reserva que tomó esta solicitud. Ver migración 314, parte 7.

    // If linked to an order in PRESUPUESTADO, revert
    if (cotizacion.orden_id) {
      const { data: orden } = await supabaseAdmin
        .from("ordenes_servicio")
        .select("id, estado")
        .eq("id", cotizacion.orden_id)
        .single()

      if (orden && orden.estado === "PRESUPUESTADO") {
        const resultado = await transicionarOrden(supabaseAdmin, {
          ordenId: cotizacion.orden_id,
          organizationId: cotizacion.organization_id,
          esperado: "PRESUPUESTADO",
          nuevo: "EN_DIAGNOSTICO",
        })

        // Registrar evento solo si la reversión se aplicó (no en race).
        if (resultado.ok) await supabaseAdmin.from("orden_eventos").insert({
          orden_id: cotizacion.orden_id,
          organization_id: cotizacion.organization_id,
          tipo: "PRESUPUESTO_RECHAZADO",
          estado_anterior: "PRESUPUESTADO",
          estado_nuevo: "EN_DIAGNOSTICO",
          descripcion: motivo
            ? `Presupuesto rechazado por el cliente: ${motivo}`
            : "Presupuesto rechazado por el cliente desde el portal público",
          metadata: { rechazadoDesdePortal: true, cotizacionId: cotizacion.id, motivo: motivo || null },
        })
      }
    }

    return NextResponse.json({ message: "Cotizacion rechazada" })
  } catch (error) {
    console.error("Error rejecting cotizacion:", error)
    return NextResponse.json(
      { error: "Error al rechazar cotizacion" },
      { status: 500 }
    )
  }
}
