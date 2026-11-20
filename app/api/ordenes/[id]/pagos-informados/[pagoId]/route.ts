import { NextResponse } from "next/server"
import { revalidateTag } from "next/cache"
import { z } from "zod"
import { requireCajaAccess } from "@/lib/auth-utils"
import { actorDeSesion, cargarOrdenEnAlcance } from "@/lib/ordenes/alcance"
import { supabaseAdmin } from "@/lib/supabase"
import { rejectIfPractica } from "@/lib/onboarding/practica"
import { logAudit } from "@/lib/audit"
import { claveCobroPagoInformado, METODO_PAGO_INFORMADO_LABEL, type MetodoPagoInformado } from "@/lib/ordenes/pagos-informados"

const bodySchema = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("confirmar") }),
  z.object({
    accion: z.literal("rechazar"),
    motivo: z.string().trim().max(300, "El motivo no puede superar los 300 caracteres").optional(),
  }),
])

/**
 * POST — el taller resuelve un aviso de pago del cliente.
 *
 * - confirmar: registra el cobro por el mismo camino que el botón "Cobrar"
 *   (registrar_cobros_orden_atomica, con la caja y el saldo al día) y marca el
 *   aviso CONFIRMADO. La clave de idempotencia es la del aviso: confirmar dos
 *   veces, o reintentar tras un corte, no cobra dos veces.
 * - rechazar: marca el aviso RECHAZADO (el cliente lo ve en el seguimiento y
 *   puede volver a informar).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; pagoId: string }> }) {
  try {
    const caja = await requireCajaAccess()
    if (caja.error) return caja.error
    const { organizationId, userId } = caja

    const { id: ordenId, pagoId } = await params
    const parsed = bodySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 })
    }

    const cargada = await cargarOrdenEnAlcance(ordenId, actorDeSesion(caja), "comercial", { select: "id, codigo_orden, numero_orden" })
    if ("error" in cargada) return cargada.error
    const practica = await rejectIfPractica(ordenId, organizationId!)
    if (practica) return practica

    const { data: aviso, error: avisoError } = await supabaseAdmin
      .from("pagos_informados")
      .select("id, metodo, monto, estado")
      .eq("id", pagoId)
      .eq("orden_id", ordenId)
      .eq("organization_id", organizationId!)
      .maybeSingle()
    if (avisoError) {
      console.error("[pagos-informados] Error leyendo aviso:", avisoError)
      return NextResponse.json({ error: "Error al resolver el pago informado" }, { status: 500 })
    }
    if (!aviso) return NextResponse.json({ error: "Pago informado no encontrado" }, { status: 404 })
    if (aviso.estado !== "PENDIENTE") {
      return NextResponse.json({ error: "Este pago informado ya fue resuelto" }, { status: 409 })
    }

    const metodo = aviso.metodo as MetodoPagoInformado
    const monto = Number(aviso.monto)
    const ahora = new Date().toISOString()

    if (parsed.data.accion === "rechazar") {
      const motivo = parsed.data.motivo || null
      const { data: filas, error: updError } = await supabaseAdmin
        .from("pagos_informados")
        .update({ estado: "RECHAZADO", motivo_rechazo: motivo, resuelto_por: userId, resuelto_at: ahora })
        .eq("id", pagoId)
        .eq("estado", "PENDIENTE")
        .select("id")
      if (updError) {
        console.error("[pagos-informados] Error rechazando:", updError)
        return NextResponse.json({ error: "Error al rechazar el pago informado" }, { status: 500 })
      }
      if (!filas || filas.length === 0) {
        return NextResponse.json({ error: "Este pago informado ya fue resuelto" }, { status: 409 })
      }
      await supabaseAdmin.from("orden_eventos").insert({
        orden_id: ordenId,
        organization_id: organizationId,
        created_by: userId,
        tipo: "PAGO_INFORMADO_RECHAZADO",
        descripcion: `Rechazó el pago informado de ${monto} (${METODO_PAGO_INFORMADO_LABEL[metodo]})${motivo ? `: ${motivo}` : ""}`,
        metadata: { pagoInformadoId: pagoId },
      })
      return NextResponse.json({ ok: true, estado: "RECHAZADO" })
    }

    // --- confirmar ---
    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc("registrar_cobros_orden_atomica", {
      p_org_id: organizationId!,
      p_orden_id: ordenId,
      p_usuario_id: userId!,
      p_pagos: [{ monto, metodo, referencia: "Informado por el cliente desde el seguimiento" }],
      p_observaciones: `Pago informado por el cliente (${METODO_PAGO_INFORMADO_LABEL[metodo]})`,
      p_descuento: 0,
      p_idempotency_key: claveCobroPagoInformado(pagoId),
    })

    if (rpcError) {
      const msg = (rpcError as any).message ?? ""
      if (msg.includes("excede el pendiente") || msg.toLowerCase().includes("saldo insuficiente")) {
        return NextResponse.json(
          { error: "El monto informado supera lo que falta cobrar (¿ya lo cobraste a mano?). Rechazá el aviso o cobrá la diferencia desde Cobrar." },
          { status: 400 },
        )
      }
      if (msg.includes("no encontrada")) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 })
      console.error("[pagos-informados] Error registrando cobro:", rpcError)
      return NextResponse.json({ error: "Error al registrar el cobro" }, { status: 500 })
    }

    // El cobro ya está. Si esto falla, reintentar es seguro: la RPC devuelve
    // el mismo cobro por la clave de idempotencia y este UPDATE se completa.
    const { error: updError } = await supabaseAdmin
      .from("pagos_informados")
      .update({ estado: "CONFIRMADO", resuelto_por: userId, resuelto_at: ahora })
      .eq("id", pagoId)
      .eq("estado", "PENDIENTE")
    if (updError) {
      console.error("[pagos-informados] Cobro registrado pero el aviso no se marcó confirmado:", updError)
      return NextResponse.json({ error: "El cobro se registró pero el aviso quedó pendiente. Volvé a confirmar." }, { status: 500 })
    }

    const result = rpcResult as { replayed?: boolean; response?: any } | null
    if (!result?.replayed) {
      await logAudit({
        organizationId: organizationId!,
        userId: userId!,
        action: "UPDATE",
        entity: "ordenes_servicio",
        entityId: ordenId,
        changes: { before: { pago_informado: "PENDIENTE" }, after: { pago_informado: "CONFIRMADO", pagoId, metodo, monto } },
        description: `Confirmó el pago informado por el cliente (${METODO_PAGO_INFORMADO_LABEL[metodo]})`,
      })
    }
    revalidateTag("dashboard", "max")

    return NextResponse.json({
      ok: true,
      estado: "CONFIRMADO",
      totalCobrado: result?.response?.orden?.totalCobrado ?? null,
      estadoCobro: result?.response?.orden?.estadoCobro ?? null,
    })
  } catch (err) {
    console.error("[pagos-informados] Error:", err)
    return NextResponse.json({ error: "Error al resolver el pago informado" }, { status: 500 })
  }
}
