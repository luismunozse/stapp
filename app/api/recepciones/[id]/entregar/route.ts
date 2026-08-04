import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth } from "@/lib/auth-utils"
import { hasPlanFeature } from "@/lib/subscriptions"
import { supabaseAdmin } from "@/lib/supabase"
import { calcularTotalLote, prorratearLote, round2, type DescuentoTipo } from "@/lib/lote-utils"
import { esEstadoEntregado, esEstadoExcluidoDeLote } from "@/lib/lote-estados"

const FEATURE_KEY = "recepcion_multiple"

const MENSAJE_NO_REPARADOS = "Todos los equipos del lote deben estar reparados para entregar"

const WARNING_STOCK = (numero: string) =>
  `Se entrego la orden ${numero}, pero no se pudo descontar el stock de sus repuestos. Revisa el inventario.`

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

    // Se leen TODOS los miembros del lote, no solo los del payload: el total
    // negociado se calcula siempre sobre el lote completo, incluidos los
    // equipos que el cliente ya retiro individualmente (el flujo individual es
    // batch-unaware y les cobra su precio individual entero).
    const { data: miembros, error: miembrosError } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("id, numero_orden, estado, costo_final, descuento_cobro")
      .eq("recepcion_id", id)
      .eq("organization_id", organizationId!)

    if (miembrosError) {
      throw miembrosError
    }

    const lista = miembros ?? []
    const entregados = lista.filter((m) => esEstadoEntregado(m.estado))
    const elegiblesPendientes = lista.filter((m) => !esEstadoExcluidoDeLote(m.estado))
    const idsEnPayload = new Set(ordenes.map((o) => o.id))

    // Cobertura del payload: todo miembro elegible pendiente tiene que venir, y
    // ningun miembro excluido puede venir. Un id que NO es miembro del lote no
    // se juzga aca — lo rechaza la RPC con ORDEN_FUERA_DE_LOTE (404), que es un
    // error distinto y merece su propio mensaje.
    const faltantes = elegiblesPendientes.filter((m) => !idsEnPayload.has(m.id))
    const excluidosEnPayload = lista.filter((m) => esEstadoExcluidoDeLote(m.estado) && idsEnPayload.has(m.id))
    if (faltantes.length > 0 || excluidosEnPayload.length > 0) {
      return NextResponse.json({ error: MENSAJE_NO_REPARADOS }, { status: 409 })
    }

    const costos = ordenes.map((o) => o.costoFinal)
    // Subtotal del lote = costos confirmados ahora + costos ya persistidos de
    // los equipos entregados antes.
    const subtotalPendientes = costos.reduce((a, b) => a + b, 0)
    const subtotalEntregados = entregados.reduce((a, m) => a + Number(m.costo_final ?? 0), 0)
    const subtotalLote = round2(subtotalPendientes + subtotalEntregados)

    const totalLote = calcularTotalLote(
      subtotalLote,
      (recepcion.descuento_tipo as DescuentoTipo | null) ?? null,
      recepcion.descuento_valor != null ? Number(recepcion.descuento_valor) : null,
    )

    // Neto ya facturado en los entregados individualmente: su costo final menos
    // el descuento de cobro que se les haya aplicado.
    const yaCobrado = round2(
      entregados.reduce((a, m) => a + round2(Number(m.costo_final ?? 0) - Number(m.descuento_cobro ?? 0)), 0),
    )
    // Lo que falta para llegar al total negociado del lote. Piso en 0: si el
    // flujo individual ya cobro de mas, el lote no devuelve plata (eso se
    // resuelve con una nota de credito, fuera de alcance).
    const totalCobrado = Math.max(0, round2(totalLote - yaCobrado))
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
        return NextResponse.json({ error: MENSAJE_NO_REPARADOS }, { status: 409 })
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

    // Consumo de stock reservado, best effort y por orden — mismo criterio que
    // POST /api/ordenes/[id]/entregar (route.ts:229-265): supabaseAdmin.rpc NO
    // lanza ante un error de Postgres, hay que leer `error`. Un fallo NO
    // cancela la entrega (los equipos ya se los llevo el cliente): se reporta
    // como warning para que quede visible.
    const numeroPorId = new Map(lista.map((m) => [m.id, String(m.numero_orden ?? m.id)]))
    const warnings: string[] = []
    for (const orden of ordenes) {
      const numero = numeroPorId.get(orden.id) ?? orden.id
      try {
        const { data: consumoResult, error: consumoError } = await supabaseAdmin.rpc("consumir_reservas_orden", {
          p_orden_id: orden.id,
          p_user_id: userId,
        })

        if (consumoError) {
          warnings.push(WARNING_STOCK(numero))
          console.error(`[entregar-lote] consumir_reservas_orden fallo para la orden ${orden.id}:`, consumoError)
        } else if (consumoResult && (consumoResult as { success?: boolean }).success !== true) {
          warnings.push(WARNING_STOCK(numero))
          console.error(
            `[entregar-lote] consumir_reservas_orden devolvio un resultado inesperado para la orden ${orden.id}:`,
            consumoResult,
          )
        }
      } catch (consumeErr) {
        warnings.push(WARNING_STOCK(numero))
        console.error(`[entregar-lote] error consumiendo reservas de la orden ${orden.id}:`, consumeErr)
      }
    }

    return NextResponse.json({
      recepcionId: id,
      totalLote,
      yaCobrado,
      totalCobrado,
      ordenes: (data as { ordenes: unknown[] }).ordenes,
      warnings,
    })
  } catch (error) {
    console.error("Error delivering lote:", error)
    return NextResponse.json({ error: "No se pudo entregar el lote" }, { status: 500 })
  }
}
