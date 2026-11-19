import { NextResponse } from "next/server"
import { revalidateTag } from "next/cache"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"
import { rejectIfPractica } from "@/lib/onboarding/practica"
import { generarCuotasCobros } from "@/lib/ordenes/cuotas-cobro"

// Pago registrado desde el remito de una orden.
//
// La plata de una orden vive en UN libro: cobros_orden. Antes este endpoint
// escribía pagos_parciales (registrar_pago_factura_atomica) y el remito no se
// enteraba de lo cobrado en la orden: una orden cobrada dejaba el remito
// PENDIENTE y registrar el pago cargaba la misma plata dos veces en caja.
// Ahora el pago es un cobro de la orden (registrar_cobros_orden_atomica) y la
// migración 417 lleva lo cobrado al remito (monto_abonado / estado_pago).
//
// Los pagos_parciales viejos siguen contando: total_cobrado_orden (345) los
// incluye.

const pagoLineSchema = z.object({
  monto: z.number().positive("El monto debe ser mayor a 0"),
  metodo: z.enum(["EFECTIVO", "TRANSFERENCIA", "TARJETA_DEBITO", "TARJETA_CREDITO", "MERCADOPAGO", "CUENTA_CORRIENTE", "OTRO"]),
  referencia: z.string().nullable().optional(),
  cuotas: z.number().int().min(1).nullable().optional(),
  recargo: z.number().min(0).nullable().optional(),
  montoOriginal: z.number().positive().nullable().optional(),
  // Porcentaje de costo financiero; el RPC calcula el monto.
  costoFinanciero: z.number().min(0).max(100).nullable().optional(),
})

// Supports both legacy single payment and new multi-payment
const pagoSchema = z.object({
  facturaId: z.string().min(1, "Remito requerido"),
  // Multi-payment (new)
  pagos: z.array(pagoLineSchema).optional(),
  // Legacy single payment (backwards compat)
  monto: z.number().positive().optional(),
  metodoPago: z.enum(["EFECTIVO", "TRANSFERENCIA", "TARJETA_DEBITO", "TARJETA_CREDITO", "MERCADOPAGO", "CUENTA_CORRIENTE", "OTRO"]).optional(),
  numeroReferencia: z.string().optional(),
  cuotas: z.number().int().min(1).nullable().optional(),
  recargoPorcentaje: z.number().min(0).nullable().optional(),
  montoOriginal: z.number().positive().nullable().optional(),
  observaciones: z.string().optional(),
  // Aceptado por compatibilidad; el cliente sale de la orden.
  clienteId: z.string().optional(),
  // Request-level idempotency key: one stable UUID per submit attempt.
  // Offline retries reuse the same key so the barrier dedupes instead of
  // running the payment mutations twice.
  idempotencyKey: z.string().max(100).nullable().optional(),
})

export async function POST(request: Request) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo administradores pueden registrar pagos" },
        { status: 403 }
      )
    }

    const body = await request.json()
    const data = pagoSchema.parse(body)

    // Normalize: convert legacy single payment to array
    let pagosToProcess: z.infer<typeof pagoLineSchema>[]
    if (data.pagos && data.pagos.length > 0) {
      pagosToProcess = data.pagos
    } else if (data.monto && data.metodoPago) {
      pagosToProcess = [{
        monto: data.monto,
        metodo: data.metodoPago,
        referencia: data.numeroReferencia || null,
        cuotas: data.cuotas || null,
        recargo: data.recargoPorcentaje || null,
        montoOriginal: data.montoOriginal || null,
      }]
    } else {
      return NextResponse.json({ error: "Debe enviar al menos un pago" }, { status: 400 })
    }

    // Remito y orden, con chequeo de organización
    const { data: factura, error: fetchError } = await supabaseAdmin
      .from("facturas")
      .select(`id, orden_id, total, estado_pago, ordenes_servicio!inner(organization_id)`)
      .eq("id", data.facturaId)
      .single()

    if (fetchError || !factura || !factura.orden_id) {
      return NextResponse.json({ error: "Remito no encontrado" }, { status: 404 })
    }

    const ordenOrgId = (factura.ordenes_servicio as any)?.organization_id
    if (ordenOrgId !== organizationId) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 })
    }

    if (factura.estado_pago === "ANULADA") {
      return NextResponse.json(
        { error: "No se pueden registrar pagos en un remito anulado" },
        { status: 400 }
      )
    }

    const ordenId = factura.orden_id as string
    const practica = await rejectIfPractica(ordenId, organizationId!)
    if (practica) return practica

    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
      "registrar_cobros_orden_atomica",
      {
        p_org_id: organizationId!,
        p_orden_id: ordenId,
        p_usuario_id: userId!,
        p_pagos: pagosToProcess.map((p) => ({
          monto: p.monto,
          metodo: p.metodo,
          referencia: p.referencia ?? null,
          cuotas: p.cuotas ?? null,
          recargo: p.recargo ?? null,
          montoOriginal: p.montoOriginal ?? null,
          costoFinanciero: p.costoFinanciero ?? null,
        })),
        p_observaciones: data.observaciones ?? null,
        p_descuento: 0,
        p_idempotency_key: data.idempotencyKey ?? null,
      }
    )

    if (rpcError) {
      const msg = rpcError.message ?? ""
      if (msg.includes("no encontrada")) {
        return NextResponse.json({ error: "Remito no encontrado" }, { status: 404 })
      }
      if (msg.includes("No autorizado")) {
        return NextResponse.json({ error: "No autorizado" }, { status: 403 })
      }
      if (msg.includes("excede el pendiente") || msg.toLowerCase().includes("saldo insuficiente")) {
        return NextResponse.json({ error: msg }, { status: 400 })
      }
      console.error("[pagos] Unexpected RPC error:", rpcError)
      return NextResponse.json({ error: "Error al registrar pago" }, { status: 500 })
    }

    const result = rpcResult as { replayed: boolean; response: any } | null
    if (!result) {
      console.error("[pagos] registrar_cobros_orden_atomica returned no result")
      return NextResponse.json({ error: "Error al registrar pago" }, { status: 500 })
    }
    if (!result.replayed) {
      await generarCuotasCobros(organizationId!, ordenId, result.response?.cobros ?? [])
    }
    revalidateTag("dashboard", "max")

    // Estado del remito después del cobro (lo escribe el trigger de la 417).
    const { data: remito } = await supabaseAdmin
      .from("facturas")
      .select("monto_abonado, estado_pago, total")
      .eq("id", factura.id)
      .single()
    const total = Number(remito?.total ?? factura.total ?? 0)
    const montoAbonado = Number(remito?.monto_abonado ?? 0)

    return NextResponse.json(
      {
        cobros: result.response?.cobros ?? [],
        factura: {
          montoAbonado,
          estadoPago: remito?.estado_pago ?? factura.estado_pago,
          pendiente: Math.max(0, total - montoAbonado),
        },
      },
      { status: result.replayed ? 200 : 201 }
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0].message }, { status: 400 })
    }
    console.error("Error creating pago:", error)
    return NextResponse.json({ error: "Error al registrar pago" }, { status: 500 })
  }
}
