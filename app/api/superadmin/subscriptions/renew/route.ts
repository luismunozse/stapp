import { NextResponse } from "next/server"
import { z } from "zod"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { createSuperadminAuditLogger } from "@/lib/superadmin-audit"
import { safeParseBody } from "@/lib/api-utils"
import { DEFAULT_TIMEZONE, formatDateValue } from "@/lib/timezone"
import { cancelMercadoPagoPreapproval } from "@/lib/account-deletion/cancel-subscriptions"

const renewSchema = z.object({
  organizationId: z.string().min(1, "ID de organización requerido"),
  billingPeriod: z.enum(["MONTHLY", "YEARLY"]).optional().default("MONTHLY"),
  months: z.number().int().min(1).max(36).optional(),
  days: z.number().int().min(1).max(3650).optional(),
  customEndDate: z.string().optional(), // ISO date string para fecha custom
  planSlug: z.string().optional(), // Default: 'profesional'
  // La genera el cliente una vez por apertura del diálogo y la reusa en los
  // reintentos: el doble clic o el reintento tras un timeout no renuevan dos veces.
  idempotencyKey: z
    .string({ error: "Clave de idempotencia requerida" })
    .regex(/^[A-Za-z0-9_-]{8,100}$/, "Clave de idempotencia inválida"),
})

/** Id del pago que reclama la renovación. Nunca choca con los `manual-<timestamp>` viejos. */
const idDePagoDeRenovacion = (clave: string) => `manual-renew-${clave}`

/**
 * Si la clave ya renovó, devuelve la respuesta de esa renovación (200) sin tocar
 * nada. Una clave usada para otra organización es un error del cliente (409).
 */
async function respuestaDeRenovacionPrevia(
  providerPaymentId: string,
  organizationId: string
): Promise<NextResponse | null> {
  const { data: previa, error } = await supabaseAdmin
    .from("subscription_payments")
    .select("organization_id, period_end")
    .eq("payment_provider", "MANUAL")
    .eq("provider_payment_id", providerPaymentId)
    .maybeSingle()

  if (error) throw error
  if (!previa) return null

  if (previa.organization_id !== organizationId) {
    return NextResponse.json(
      { error: "La clave de idempotencia ya se usó para otra organización" },
      { status: 409 }
    )
  }

  const periodEnd = new Date(previa.period_end)
  return NextResponse.json({
    success: true,
    message: `Suscripción Premium activada hasta ${formatDateValue(periodEnd, DEFAULT_TIMEZONE)}`,
    periodEnd: periodEnd.toISOString(),
    replayed: true,
  })
}

const esViolacionDeUnicidad = (error: { code?: string } | null) => error?.code === "23505"

export async function POST(request: Request) {
  try {
    const { error: authError, email } = await requireSuperadmin()
    if (authError) return authError

    const parsed = await safeParseBody(request, renewSchema)
    if ("error" in parsed) return parsed.error

    const { organizationId, billingPeriod, months, days, customEndDate, planSlug, idempotencyKey } = parsed.data
    const providerPaymentId = idDePagoDeRenovacion(idempotencyKey)

    // Reintento de una renovación que ya se hizo: se devuelve lo mismo sin
    // volver a cancelar en MercadoPago, extender el período ni cobrar.
    const repetida = await respuestaDeRenovacionPrevia(providerPaymentId, organizationId)
    if (repetida) return repetida

    const period: "MONTHLY" | "YEARLY" = billingPeriod
    const targetSlug = planSlug || "profesional"

    // Obtener plan por slug (default: profesional)
    let { data: premiumPlan } = await supabaseAdmin
      .from("plans")
      .select("id, precio_mensual, precio_anual, moneda")
      .eq("slug", targetSlug)
      .eq("activo", true)
      .maybeSingle()

    // Fallback: si no se encuentra por slug, tomar el PREMIUM activo con mayor tier_order
    if (!premiumPlan) {
      const { data: fallbackPlan } = await supabaseAdmin
        .from("plans")
        .select("id, precio_mensual, precio_anual, moneda")
        .eq("tipo", "PREMIUM")
        .eq("activo", true)
        .order("tier_order", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle()
      premiumPlan = fallbackPlan
    }

    if (!premiumPlan) {
      return NextResponse.json(
        { error: "No se encontró un plan Premium activo" },
        { status: 404 }
      )
    }

    // Calcular fechas del período
    const now = new Date()
    let periodEnd: Date

    if (customEndDate) {
      // Fecha custom
      periodEnd = new Date(customEndDate)
      if (isNaN(periodEnd.getTime()) || periodEnd <= now) {
        return NextResponse.json(
          { error: "La fecha custom debe ser posterior a hoy" },
          { status: 400 }
        )
      }
    } else if (days) {
      periodEnd = new Date(now)
      periodEnd.setDate(periodEnd.getDate() + days)
    } else {
      periodEnd = new Date(now)
      if (months) {
        periodEnd.setMonth(periodEnd.getMonth() + months)
      } else if (period === "YEARLY") {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1)
      } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1)
      }
    }

    // Verificar si ya existe una suscripción para esta org
    const { data: existingSub } = await supabaseAdmin
      .from("subscriptions")
      .select("id, status, current_period_end")
      .eq("organization_id", organizationId)
      .single()

    let subscriptionId: string
    const previousStatus = existingSub?.status || null

    // Auditoría fail-closed ANTES de activar/renovar.
    const intento = await createSuperadminAuditLogger(email, request).exigir({
      action: "SUBSCRIPTION_RENEW",
      entity: "subscriptions",
      entityId: existingSub?.id ?? null,
      organizationId,
      description: `Renovación manual de suscripción (${targetSlug}, ${period})`,
      metadata: {
        action: "manual_renewal",
        planSlug: targetSlug,
        billing_period: period,
        months: months || (period === "YEARLY" ? 12 : 1),
        days: days || null,
        custom_date: !!customEndDate,
        previous_status: previousStatus,
        provider_payment_id: providerPaymentId,
      },
    })
    if (!intento.ok) return intento.respuesta

    // Monto del pago manual en base al período / cantidad de meses
    const meses = months || (period === "YEARLY" ? 12 : 1)
    const precioMensual = Number(premiumPlan.precio_mensual) || 0
    const precioAnual = Number(premiumPlan.precio_anual) || 0
    const amount = period === "YEARLY" && !months ? precioAnual : precioMensual * meses

    // Renovar a mano pasa la suscripción a payment_provider MANUAL. Si la
    // preapproval de MercadoPago quedaba viva, MP seguía cobrando y su
    // webhook extendía el período otra vez y volvía a MERCADOPAGO: cobro doble
    // y período inflado. Se cancela antes de tocar la fila; si falla, nada
    // cambia y el operador reintenta.
    let mercadopagoCanceled = false
    if (existingSub) {
      const mpCancel = await cancelMercadoPagoPreapproval(organizationId)
      if (!mpCancel.ok) {
        await intento.completar({ error: "mercadopago" }, "fallido")
        return NextResponse.json(
          { error: "No se pudo cancelar el débito automático en MercadoPago. La suscripción no se renovó; reintentá." },
          { status: 502 }
        )
      }
      mercadopagoCanceled = mpCancel.canceled
    }

    /**
     * El pago es el reclamo de la renovación: se inserta ANTES de extender el
     * período, y el UNIQUE (payment_provider, provider_payment_id) de la
     * migración 305 deja pasar uno solo por clave. Dos pedidos concurrentes con
     * la misma clave pasan los dos el chequeo de arriba, pero solo el que gana
     * el INSERT extiende; el otro recibe 23505 y devuelve lo que hizo el primero.
     */
    const reclamarRenovacion = (subId: string, inicio: Date) =>
      supabaseAdmin
        .from("subscription_payments")
        .insert({
          subscription_id: subId,
          organization_id: organizationId,
          amount,
          currency: premiumPlan.moneda || "ARS",
          payment_provider: "MANUAL",
          provider_payment_id: providerPaymentId,
          status: "SUCCEEDED",
          paid_at: now.toISOString(),
          period_start: inicio.toISOString(),
          period_end: periodEnd.toISOString(),
        })
        .select("id")
        .single()

    const perdioLaCarrera = async () => {
      const repetidaTrasCarrera = await respuestaDeRenovacionPrevia(providerPaymentId, organizationId)
      if (repetidaTrasCarrera) return repetidaTrasCarrera
      // El UNIQUE chocó pero la fila ya no está: el ganador falló y la borró.
      return NextResponse.json(
        { error: "Otra renovación con la misma clave falló a mitad de camino. Reintentá." },
        { status: 409 }
      )
    }

    if (existingSub) {
      // Si la suscripción actual está activa y no ha vencido, extender desde la fecha de vencimiento
      let startDate = now
      if (
        !customEndDate &&
        existingSub.status === "ACTIVE" &&
        existingSub.current_period_end &&
        new Date(existingSub.current_period_end) > now
      ) {
        startDate = new Date(existingSub.current_period_end)
        const extendedEnd = new Date(startDate)
        if (days) {
          extendedEnd.setDate(extendedEnd.getDate() + days)
        } else if (months) {
          extendedEnd.setMonth(extendedEnd.getMonth() + months)
        } else if (period === "YEARLY") {
          extendedEnd.setFullYear(extendedEnd.getFullYear() + 1)
        } else {
          extendedEnd.setMonth(extendedEnd.getMonth() + 1)
        }
        periodEnd = extendedEnd
      }

      const { data: pago, error: claimError } = await reclamarRenovacion(existingSub.id, startDate)
      if (esViolacionDeUnicidad(claimError)) return perdioLaCarrera()
      if (claimError) throw claimError

      // Actualizar suscripción existente
      const { error: updateError } = await supabaseAdmin
        .from("subscriptions")
        .update({
          plan_id: premiumPlan.id,
          status: "ACTIVE",
          billing_period: period,
          payment_provider: "MANUAL",
          current_period_start: startDate.toISOString(),
          current_period_end: periodEnd.toISOString(),
          cancel_at_period_end: false,
          canceled_at: null,
          trial_end: null,
        })
        .eq("id", existingSub.id)

      if (updateError) {
        // Sin extender no hay renovación: se libera la clave para que el
        // reintento la vuelva a hacer en vez de devolver un éxito falso.
        await supabaseAdmin.from("subscription_payments").delete().eq("id", pago.id)
        throw updateError
      }
      subscriptionId = existingSub.id
    } else {
      // Crear nueva suscripción
      const { data: newSub, error: createError } = await supabaseAdmin
        .from("subscriptions")
        .insert({
          organization_id: organizationId,
          plan_id: premiumPlan.id,
          status: "ACTIVE",
          billing_period: period,
          payment_provider: "MANUAL",
          current_period_start: now.toISOString(),
          current_period_end: periodEnd.toISOString(),
          cancel_at_period_end: false,
        })
        .select("id")
        .single()

      // UNIQUE(organization_id): otro pedido creó la suscripción en el medio.
      // No se reintenta como "extender": podría apilar un segundo período.
      if (esViolacionDeUnicidad(createError)) {
        return (
          (await respuestaDeRenovacionPrevia(providerPaymentId, organizationId)) ??
          NextResponse.json(
            { error: "La organización ya tiene una suscripción (otra renovación en curso). Recargá y reintentá." },
            { status: 409 }
          )
        )
      }
      if (createError) throw createError

      // subscription_payments.subscription_id es NOT NULL: el reclamo va
      // después de crear la fila. La creación ya es única por organización.
      const { error: claimError } = await reclamarRenovacion(newSub.id, now)
      if (claimError) {
        // Deshacer la suscripción recién creada: si quedara, el reintento
        // la extendería desde su vencimiento y daría dos períodos.
        await supabaseAdmin.from("subscriptions").delete().eq("id", newSub.id)
        if (esViolacionDeUnicidad(claimError)) return perdioLaCarrera()
        throw claimError
      }
      subscriptionId = newSub.id
    }

    // Registrar en historial de suscripción
    await supabaseAdmin.from("subscription_history").insert({
      subscription_id: subscriptionId,
      organization_id: organizationId,
      action: previousStatus === "ACTIVE" ? "RENEWED" : "ACTIVATED",
      previous_status: previousStatus,
      new_status: "ACTIVE",
      details: {
        billing_period: period,
        months: days ? undefined : (months || (period === "YEARLY" ? 12 : 1)),
        days: days || undefined,
        period_end: periodEnd.toISOString(),
        custom_date: !!customEndDate,
      },
      performed_by: email,
    })

    await intento.completar({
      subscriptionId,
      period_end: periodEnd.toISOString(),
      mercadopago_preapproval_canceled: mercadopagoCanceled,
    })

    // Notificar al admin de la org (mejora 11)
    const { data: orgAdmins } = await supabaseAdmin
      .from("users")
      .select("id, organization_id")
      .eq("organization_id", organizationId)
      .eq("rol", "ADMIN")

    if (orgAdmins && orgAdmins.length > 0) {
      const notifications = orgAdmins.map((admin) => ({
        organization_id: admin.organization_id,
        user_id: admin.id,
        title: "Suscripción Premium activada",
        body: `Tu plan Premium está activo hasta ${formatDateValue(periodEnd, DEFAULT_TIMEZONE)}`,
        type: "SUBSCRIPTION",
        icon: "credit-card",
        action_url: "/configuracion",
      }))

      await supabaseAdmin.from("user_notifications").insert(notifications)
    }

    return NextResponse.json({
      success: true,
      message: `Suscripción Premium activada hasta ${formatDateValue(periodEnd, DEFAULT_TIMEZONE)}`,
      periodEnd: periodEnd.toISOString(),
    })
  } catch (error) {
    console.error("Error renewing subscription:", error)
    return NextResponse.json(
      { error: "Error al renovar suscripción" },
      { status: 500 }
    )
  }
}
