import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { aplicarAprobacionCotizacionAOrden } from "@/lib/cotizacion-aprobar-orden"
import { isFunctionMissingError } from "@/lib/rpc-errors"
import { z } from "zod"

// El cliente aprueba desde el portal como "system-public": no hay usuario
// autenticado detrás, pero el movimiento de stock necesita un autor.
const PUBLIC_ACTOR = "system-public"

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
      .select("id, estado, orden_id, total, tipo, organization_id, revision_de")
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

    // Aprobar por el RPC atómico (migración 246), el mismo que usa la firma
    // presencial. Acá se hacía a mano —UPDATE a ACEPTADA y después un
    // `reservar_items_cotizacion` suelto, con el error tragado— y eso rompe dos
    // invariantes que ese RPC existe para sostener:
    //
    //  · Aceptada sin reservar. Si la reserva fallaba, la cotización quedaba
    //    igual en ACEPTADA. La migración 246 mete la reserva DENTRO de la
    //    transacción de aprobación justamente para que eso no pueda pasar.
    //  · Reserva duplicada en una revisión. La reconciliación que agrega la
    //    migración 312 —liberar las reservas de la cotización reemplazada antes
    //    de tomar las nuevas— vive dentro del RPC. Por afuera nunca corría, y
    //    cada pieza presente en las dos versiones quedaba contada dos veces.
    //    Este es el camino por el que el cliente firma la revisión, así que era
    //    el camino donde más importaba.
    const { error: rpcError } = await supabaseAdmin.rpc("aprobar_cotizacion_atomica", {
      p_org_id: cotizacion.organization_id,
      p_cotizacion_id: cotizacion.id,
      p_user_id: PUBLIC_ACTOR,
      p_firma: data.firmaAprobacion || null,
      p_firma_mime: data.firmaMime || null,
    })

    if (rpcError) {
      const rpcMsg = (rpcError.message ?? "").toLowerCase()

      if (!isFunctionMissingError(rpcError)) {
        // Errores de negocio del plpgsql: la fila cambió bajo los pies del
        // cliente, o no hay stock. Ninguno es un 500.
        if (rpcMsg.includes("no encontrada")) {
          return NextResponse.json({ error: "Cotizacion no encontrada" }, { status: 404 })
        }
        if (rpcMsg.includes("enviadas")) {
          return NextResponse.json(
            { error: "Solo se pueden aprobar cotizaciones enviadas" },
            { status: 400 }
          )
        }
        if (rpcMsg.includes("stock insuficiente")) {
          console.error("[public aprobar] Stock insuficiente:", rpcError)
          return NextResponse.json(
            {
              error:
                "No hay stock disponible para todos los items de esta cotización. Comunicate con el local.",
            },
            { status: 409 }
          )
        }
        console.error("[public aprobar] Unexpected RPC error:", rpcError)
        return NextResponse.json({ error: "Error al aprobar cotizacion" }, { status: 500 })
      }

      // --- Fallback pre-migración 246: el RPC todavía no existe ---
      console.warn("[public aprobar] aprobar_cotizacion_atomica not found; falling back to JS path")

      // Sin el RPC no hay reconciliación de reservas (migración 312), así que
      // una revisión aprobada por acá duplicaría el stock reservado de cada
      // pieza que comparte con la versión que reemplaza. Negarse es ruidoso y
      // reversible; reservar de más corrompe `stock_reservado` en silencio.
      if (cotizacion.revision_de && !esPresupuesto) {
        console.error(
          "[public aprobar] Revisión no aprobable sin aprobar_cotizacion_atomica: falta la migración 312"
        )
        return NextResponse.json(
          {
            error:
              "No se puede aprobar esta versión en este momento. Comunicate con el local.",
          },
          { status: 503 }
        )
      }

      const { error: updateError } = await supabaseAdmin
        .from("cotizaciones")
        .update({
          estado: "ACEPTADA",
          firma_aprobacion: data.firmaAprobacion || null,
          firma_mime: data.firmaMime || null,
          fecha_aprobacion: new Date().toISOString(),
        })
        .eq("id", cotizacion.id)
        .eq("estado", "ENVIADA")

      if (updateError) throw updateError

      // Reservar stock sólo para tipo ORDEN
      if (!esPresupuesto) {
        try {
          await supabaseAdmin.rpc("reservar_items_cotizacion", {
            p_cotizacion_id: cotizacion.id,
            p_user_id: PUBLIC_ACTOR,
          })
        } catch (reserveErr) {
          console.error("Error reserving stock for cotizacion:", reserveErr)
        }
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
