import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { emitWebhookEvent } from "@/lib/webhooks/dispatcher"
import { aplicarAprobacionCotizacionAOrden } from "@/lib/cotizacion-aprobar-orden"
// Compartido con la ruta pública de aprobación, que usa el mismo RPC atómico.
import { isFunctionMissingError } from "@/lib/rpc-errors"
import { z } from "zod"

const aprobarSchema = z.object({
  firmaAprobacion: z.string().optional().nullable(),
  firmaMime: z.string().optional().nullable(),
})

// Joined SELECT used both in the fallback and for re-fetching after the RPC.
const COTIZACION_SELECT = `
  *,
  ordenes_servicio!cotizaciones_orden_id_fkey (id, numero_orden, dispositivo, clientes(*)),
  clientes (*),
  items_cotizacion (*)
`

function buildResponse(cotizacion: any): NextResponse {
  const orden = cotizacion.ordenes_servicio as any
  return NextResponse.json({
    id: cotizacion.id,
    ordenId: cotizacion.orden_id,
    numeroCotizacion: cotizacion.numero_cotizacion,
    estado: cotizacion.estado,
    subtotal: cotizacion.subtotal,
    iva: cotizacion.iva,
    total: cotizacion.total,
    firmaAprobacion: cotizacion.firma_aprobacion,
    fechaAprobacion: cotizacion.fecha_aprobacion,
    orden: orden
      ? {
          id: orden.id,
          numeroOrden: orden.numero_orden,
          dispositivo: orden.dispositivo,
          cliente: orden.clientes,
        }
      : null,
    cliente: cotizacion.clientes || orden?.clientes || null,
    items: cotizacion.items_cotizacion?.map((i: any) => ({
      id: i.id,
      descripcion: i.descripcion,
      cantidad: i.cantidad,
      precioUnitario: i.precio_unitario,
      subtotal: i.subtotal,
    })),
  })
}

// Si la cotización aprobada con firma presencial está vinculada a una orden
// en PRESUPUESTADO, la transiciona a APROBADO igual que los portales
// públicos. Se aísla en try/catch propio: la cotización ya quedó ACEPTADA
// en este punto, así que un fallo acá no debe convertir la aprobación en
// un 500 — sólo se loguea (mismo criterio "no bloquear" que el resto del
// endpoint usa para stock/notificaciones).
async function transicionarOrdenTrasFirma(
  cotizacion: { id: string; orden_id: string | null },
  cotizacionTotal: number,
  userId: string | undefined
) {
  if (!cotizacion.orden_id) return
  try {
    const { data: orden } = await supabaseAdmin
      .from("ordenes_servicio")
      .select(
        "id, estado, organization_id, sucursal_id, cliente_id, numero_orden, dispositivo, public_token, clientes (id, nombre, email, telefono), organizations (nombre, nombre_mostrar, slug, moneda, zona_horaria)"
      )
      .eq("id", cotizacion.orden_id)
      .single()

    if (!orden) return

    await aplicarAprobacionCotizacionAOrden({
      orden: orden as any,
      cotizacionId: cotizacion.id,
      cotizacionTotal,
      descripcionEvento: "Cotización aprobada con firma del cliente en el local",
      metadataEvento: { aprobadoDesdePortal: false, cotizacionId: cotizacion.id },
      aprobadoDesdePortal: false,
      actorUserId: userId,
    })
  } catch (err) {
    console.error("[aprobar] Error transitioning orden after signature approval:", err)
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const data = aprobarSchema.parse(body)

    // --- JS pre-validations (remain in every path) ---

    // 404: cotizacion must exist and belong to the org
    const { data: cotizacion, error: fetchError } = await supabaseAdmin
      .from("cotizaciones")
      .select("*")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .single()

    if (fetchError || !cotizacion) {
      return NextResponse.json({ error: "Cotización no encontrada" }, { status: 404 })
    }

    // TECNICO ownership check
    if (role === "TECNICO" && cotizacion.created_by !== userId) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 })
    }

    // Estado guard (fast-path JS check before hitting DB)
    if (cotizacion.estado !== "ENVIADA") {
      return NextResponse.json(
        { error: "Solo se pueden aprobar cotizaciones enviadas" },
        { status: 400 }
      )
    }

    // Firma required for non-PRESUPUESTO
    const esPresupuesto = cotizacion.tipo === "PRESUPUESTO"
    if (!esPresupuesto && (!data.firmaAprobacion || !data.firmaMime)) {
      return NextResponse.json({ error: "La firma es requerida para aprobar" }, { status: 400 })
    }

    // --- Atomic RPC path (migration 246) ---
    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
      "aprobar_cotizacion_atomica",
      {
        p_org_id: organizationId!,
        p_cotizacion_id: id,
        p_user_id: userId!,
        p_firma: data.firmaAprobacion ?? null,
        p_firma_mime: data.firmaMime ?? null,
      }
    )

    if (!rpcError) {
      // RPC succeeded — re-fetch with joins to build the same response shape
      const { data: updatedCotizacion, error: refetchError } = await supabaseAdmin
        .from("cotizaciones")
        .select(COTIZACION_SELECT)
        .eq("id", id)
        .single()

      if (refetchError || !updatedCotizacion) throw refetchError ?? new Error("Re-fetch failed")

      emitWebhookEvent(organizationId!, "cotizacion.aceptada", {
        id: updatedCotizacion.id,
        numeroCotizacion: updatedCotizacion.numero_cotizacion ?? null,
        tipo: updatedCotizacion.tipo,
        total: updatedCotizacion.total,
        clienteId: (updatedCotizacion.clientes as any)?.id ?? null,
        ordenId: updatedCotizacion.orden_id ?? null,
      }).catch(() => {})

      await transicionarOrdenTrasFirma(updatedCotizacion, updatedCotizacion.total, userId)

      return buildResponse(updatedCotizacion)
    }

    // Map RPC-level business errors before checking function-missing
    const rpcMsg = rpcError.message ?? ""
    if (!isFunctionMissingError(rpcError)) {
      if (rpcMsg.toLowerCase().includes("no encontrada")) {
        return NextResponse.json({ error: "Cotización no encontrada" }, { status: 404 })
      }
      if (rpcMsg.toLowerCase().includes("enviadas")) {
        return NextResponse.json(
          { error: "Solo se pueden aprobar cotizaciones enviadas" },
          { status: 400 }
        )
      }
      console.error("[aprobar] Unexpected RPC error:", rpcError)
      return NextResponse.json({ error: "Error al aprobar cotizacion" }, { status: 500 })
    }

    // --- Hardened JS fallback (pre-migration 246) ---
    console.warn("[aprobar] aprobar_cotizacion_atomica not found; falling back to JS path")

    // Una revisión no puede aprobarse por acá. La reconciliación de reservas
    // —liberar las de la cotización reemplazada antes de tomar las nuevas— vive
    // dentro de `aprobar_cotizacion_atomica` (migración 312), y este camino
    // existe justamente para cuando esa función no está. Reservar los items de
    // la revisión sin liberar los de la original deja contada dos veces cada
    // pieza que aparece en ambas versiones: el bug de stock fantasma que la
    // migración 246 existe para prevenir. Negarse es ruidoso y reversible;
    // reservar de más corrompe `stock_reservado` en silencio y para siempre.
    if (cotizacion.revision_de && !esPresupuesto) {
      console.error(
        "[aprobar] Revisión no aprobable sin aprobar_cotizacion_atomica: falta la migración 312"
      )
      return NextResponse.json(
        {
          error:
            "No se puede aprobar una revisión en esta base de datos: falta aplicar la migración de reservas. Avisá al administrador del sistema.",
        },
        { status: 503 }
      )
    }

    // Optimistic lock: update only if still ENVIADA (prevents double-approve)
    const { data: updatedCotizacion, error: updateError } = await supabaseAdmin
      .from("cotizaciones")
      .update({
        estado: "ACEPTADA",
        firma_aprobacion: data.firmaAprobacion || null,
        firma_mime: data.firmaMime || null,
        fecha_aprobacion: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("estado", "ENVIADA")
      .select(COTIZACION_SELECT)
      .single()

    if (updateError || !updatedCotizacion) {
      // No row matched the .eq("estado","ENVIADA") filter → already approved concurrently
      return NextResponse.json(
        { error: "Solo se pueden aprobar cotizaciones enviadas" },
        { status: 400 }
      )
    }

    // Attempt stock reservation; on failure revert estado (compensating update)
    if (!esPresupuesto) {
      const { error: reserveErr } = await supabaseAdmin.rpc("reservar_items_cotizacion", {
        p_cotizacion_id: id,
        p_user_id: userId || "system",
      })

      if (reserveErr) {
        // Compensating revert: put the cotizacion back to ENVIADA
        await supabaseAdmin
          .from("cotizaciones")
          .update({ estado: "ENVIADA", firma_aprobacion: null, firma_mime: null, fecha_aprobacion: null })
          .eq("id", id)

        return NextResponse.json(
          { error: reserveErr.message || "Error al reservar stock" },
          { status: 400 }
        )
      }
    }

    emitWebhookEvent(organizationId!, "cotizacion.aceptada", {
      id: updatedCotizacion.id,
      numeroCotizacion: updatedCotizacion.numero_cotizacion ?? null,
      tipo: updatedCotizacion.tipo,
      total: updatedCotizacion.total,
      clienteId: (updatedCotizacion.clientes as any)?.id ?? null,
      ordenId: updatedCotizacion.orden_id ?? null,
    }).catch(() => {})

    await transicionarOrdenTrasFirma(updatedCotizacion, updatedCotizacion.total, userId)

    return buildResponse(updatedCotizacion)

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    console.error("Error approving cotizacion:", error)
    return NextResponse.json({ error: "Error al aprobar cotizacion" }, { status: 500 })
  }
}
