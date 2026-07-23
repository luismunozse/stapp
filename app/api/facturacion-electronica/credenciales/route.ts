import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { encryptSecret } from "@/lib/facturacion/crypto"

export async function GET() {
  const { error, organizationId } = await requireAdmin()
  if (error) return error

  const { data } = await supabaseAdmin
    .from("facturacion_credenciales")
    .select("organization_id, punto_venta, condicion_fiscal, updated_at")
    .eq("organization_id", organizationId!)
    .maybeSingle()

  return NextResponse.json({
    conectado: !!data,
    puntoVenta: data?.punto_venta ?? null,
    condicionFiscal: data?.condicion_fiscal ?? null,
    updatedAt: data?.updated_at ?? null,
  })
}

export async function PUT(request: Request) {
  const { error, organizationId } = await requireAdmin()
  if (error) return error

  const body = await request.json().catch(() => null)
  const { apitoken, apikey, usertoken, puntoVenta, condicionFiscal } = body || {}

  if (!apitoken || !apikey || !usertoken) {
    return NextResponse.json({ error: "Faltan credenciales" }, { status: 400 })
  }

  const cond = condicionFiscal === "RESPONSABLE_INSCRIPTO" ? "RESPONSABLE_INSCRIPTO" : "MONOTRIBUTO"

  const { error: dbError } = await supabaseAdmin.from("facturacion_credenciales").upsert({
    organization_id: organizationId!,
    apitoken_enc: encryptSecret(String(apitoken)),
    apikey_enc: encryptSecret(String(apikey)),
    usertoken_enc: encryptSecret(String(usertoken)),
    punto_venta: Number(puntoVenta) || 1,
    condicion_fiscal: cond,
    estado: "conectado",
    updated_at: new Date().toISOString(),
  })

  if (dbError) {
    return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 })
  }

  return NextResponse.json({
    conectado: true,
    puntoVenta: Number(puntoVenta) || 1,
    condicionFiscal: cond,
  })
}
