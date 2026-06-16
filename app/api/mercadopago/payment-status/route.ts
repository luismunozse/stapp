import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"

/**
 * Devuelve el estado y el motivo (status_detail) de un pago de MercadoPago.
 *
 * Lo usa la página de facturación cuando MP redirige a la failureUrl: el
 * back_url trae `payment_id` pero NO el status_detail, así que lo buscamos en
 * la API de MP para mostrarle al usuario por qué se rechazó y qué hacer.
 *
 * Scope: solo devolvemos el detalle si el pago pertenece a la organización del
 * usuario autenticado (lo validamos contra el external_reference del pago).
 */
export async function GET(request: NextRequest) {
  const { error, organizationId } = await requireAuth()
  if (error) return error

  const paymentId = request.nextUrl.searchParams.get("payment_id")
  // Los payment ids de MP son numéricos. Validamos para no inyectar en la URL.
  if (!paymentId || !/^\d+$/.test(paymentId)) {
    return NextResponse.json({ error: "payment_id inválido" }, { status: 400 })
  }

  const res = await fetch(
    `https://api.mercadopago.com/v1/payments/${paymentId}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
      },
    }
  )

  if (!res.ok) {
    return NextResponse.json(
      { error: "No se pudo obtener el pago" },
      { status: 502 }
    )
  }

  const payment = await res.json()

  // Verificar que el pago pertenezca a la org del usuario antes de exponer nada.
  let paymentOrg: string | null = null
  try {
    paymentOrg = JSON.parse(payment.external_reference || "{}").organization_id ?? null
  } catch {
    paymentOrg = null
  }
  if (paymentOrg && paymentOrg !== organizationId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 })
  }

  return NextResponse.json({
    status: payment.status,
    statusDetail: payment.status_detail,
  })
}
