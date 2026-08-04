import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth } from "@/lib/auth-utils"
import { hasPlanFeature } from "@/lib/subscriptions"
import { supabaseAdmin } from "@/lib/supabase"
import { calcularTotalLote, prorratearLote, type DescuentoTipo } from "@/lib/lote-utils"

const FEATURE_KEY = "recepcion_multiple"

const entregarLoteSchema = z.object({
  ordenes: z
    .array(z.object({ id: z.string().min(1), costoFinal: z.number().min(0) }))
    .min(1),
  metodoPago: z.enum([
    "EFECTIVO",
    "TRANSFERENCIA",
    "TARJETA_DEBITO",
    "TARJETA_CREDITO",
    "MERCADOPAGO",
    "OTRO",
  ]),
  referencia: z.string().nullable().optional(),
  observaciones: z.string().nullable().optional(),
  idempotencyKey: z.string().max(100).nullable().optional(),
})

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    // Gate de plan. hasPlanFeature aplica los overrides por organizacion.
    const hasFeature = await hasPlanFeature(organizationId!, FEATURE_KEY)
    if (!hasFeature) {
      return NextResponse.json(
        {
          error: "La recepcion de varios equipos esta disponible en el plan Profesional",
          code: "FEATURE_REQUIRED",
          feature: FEATURE_KEY,
        },
        { status: 403 },
      )
    }

    // Entregar y cobrar un lote es modificar precios y estado de varias
    // ordenes a la vez: solo un administrador puede hacerlo (mismo criterio
    // que PATCH /api/recepciones/[id] al editar el descuento).
    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo un administrador puede entregar y cobrar un lote" },
        { status: 403 },
      )
    }

    const parsed = entregarLoteSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Datos invalidos" },
        { status: 400 },
      )
    }
    const { ordenes, metodoPago, referencia, observaciones, idempotencyKey } = parsed.data

    const { data: recepcion, error: recepcionError } = await supabaseAdmin
      .from("recepciones")
      .select("id, descuento_tipo, descuento_valor")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (recepcionError) {
      if (recepcionError.code === "PGRST116") {
        return NextResponse.json({ error: "Recepcion no encontrada" }, { status: 404 })
      }
      throw recepcionError
    }
    if (!recepcion) {
      return NextResponse.json({ error: "Recepcion no encontrada" }, { status: 404 })
    }

    const costos = ordenes.map((o) => o.costoFinal)
    const subtotal = costos.reduce((a, b) => a + b, 0)
    const totalCobrado = calcularTotalLote(
      subtotal,
      (recepcion.descuento_tipo as DescuentoTipo | null) ?? null,
      recepcion.descuento_valor != null ? Number(recepcion.descuento_valor) : null,
    )
    const shares = prorratearLote(costos, totalCobrado)

    const { data, error: rpcError } = await supabaseAdmin.rpc("entregar_lote_recepcion", {
      p_organization_id: organizationId!,
      p_recepcion_id: id,
      p_usuario_id: userId!,
      p_ordenes: ordenes.map((o, i) => ({ id: o.id, costoFinal: o.costoFinal, montoCobro: shares[i] })),
      p_metodo_pago: metodoPago,
      p_referencia: referencia ?? null,
      p_observaciones: observaciones ?? null,
      p_idempotency_key: idempotencyKey ?? null,
    })

    if (rpcError) {
      const msg = rpcError.message ?? ""
      if (msg.includes("LOTE_ERROR:ORDEN_NO_REPARADA") || msg.includes("LOTE_ERROR:LOTE_INCOMPLETO")) {
        return NextResponse.json(
          { error: "Todos los equipos del lote deben estar reparados para entregar" },
          { status: 409 },
        )
      }
      if (msg.includes("LOTE_ERROR:COBRO_EXCEDE_PENDIENTE")) {
        return NextResponse.json(
          {
            error:
              "Un equipo del lote tiene pagos o descuentos previos que superan su parte del total. Entregalo individualmente.",
          },
          { status: 409 },
        )
      }
      if (msg.includes("LOTE_ERROR:COSTO_FINAL_INVALIDO") || msg.includes("LOTE_ERROR:MONTO_COBRO_INVALIDO")) {
        return NextResponse.json({ error: "Datos de cobro invalidos para el lote" }, { status: 400 })
      }
      if (msg.includes("LOTE_ERROR:RECEPCION_NOT_FOUND")) {
        return NextResponse.json({ error: "Recepcion no encontrada" }, { status: 404 })
      }
      if (msg.includes("LOTE_ERROR:ORDEN_FUERA_DE_LOTE")) {
        return NextResponse.json({ error: "Una de las ordenes no pertenece a este lote" }, { status: 404 })
      }
      throw rpcError
    }

    return NextResponse.json({
      recepcionId: id,
      totalCobrado,
      ordenes: (data as { ordenes: unknown[] }).ordenes,
    })
  } catch (error) {
    console.error("Error delivering lote:", error)
    return NextResponse.json({ error: "No se pudo entregar el lote" }, { status: 500 })
  }
}
