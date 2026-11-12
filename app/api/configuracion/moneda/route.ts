import { NextResponse } from "next/server"
import { requireAuth, requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { fuentesPara } from "@/lib/currency/config-moneda"
import { validarTipoCambio } from "@/lib/currency/convert"
import { configMonedaSchema } from "@/lib/currency/config-moneda-schema"
import { cargarConfigMoneda } from "@/lib/currency/tipo-cambio.server"

/** Postgres: undefined_table / undefined_column (migration not applied yet). */
const MIGRACION_PENDIENTE = new Set(["42P01", "42703"])

async function contarEnDivisa(tabla: "inventario" | "servicios", organizationId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from(tabla)
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .not("moneda", "is", null)
  if (error) {
    if (error.code && MIGRACION_PENDIENTE.has(error.code)) return 0
    throw new Error(`${tabla}: ${error.message}`)
  }
  return count ?? 0
}

async function respuesta(organizationId: string, role: string | null) {
  const { config } = await cargarConfigMoneda(organizationId)
  let itemsEnDivisa: { inventario: number; servicios: number } | null = null
  if (role === "ADMIN") {
    const [inventario, servicios] = await Promise.all([
      contarEnDivisa("inventario", organizationId),
      contarEnDivisa("servicios", organizationId),
    ])
    itemsEnDivisa = { inventario, servicios }
  }
  return NextResponse.json({ config, itemsEnDivisa })
}

/** GET /api/configuracion/moneda: any role gets the config; only ADMIN gets the item counts. */
export async function GET() {
  try {
    const { error, organizationId, role } = await requireAuth()
    if (error) return error
    return await respuesta(organizationId!, role)
  } catch (e) {
    console.error("[configuracion/moneda] GET:", e)
    return NextResponse.json({ error: "Error al obtener la configuración de moneda" }, { status: 500 })
  }
}

/** PUT /api/configuracion/moneda: ADMIN only. Does not touch acepta_usd_efectivo / vuelto_moneda_default. */
export async function PUT(request: Request) {
  try {
    const { error, organizationId, role } = await requireAdmin()
    if (error) return error

    let json: unknown
    try {
      json = await request.json()
    } catch {
      return NextResponse.json({ error: "Cuerpo de la solicitud inválido" }, { status: 400 })
    }
    const parsed = configMonedaSchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos", detalles: parsed.error.issues }, { status: 400 })
    }
    const input = parsed.data

    const { config, fila } = await cargarConfigMoneda(organizationId!)
    if (input.monedaExtranjera === config.monedaLocal) {
      return NextResponse.json(
        { error: "La moneda extranjera no puede ser la misma que la moneda local." },
        { status: 400 }
      )
    }

    const { data: org, error: orgError } = await supabaseAdmin
      .from("organizations")
      .select("pais")
      .eq("id", organizationId!)
      .single()
    if (orgError && orgError.code !== "PGRST116") throw new Error(`organizations: ${orgError.message}`)

    if (!fuentesPara(org?.pais, input.monedaExtranjera).includes(input.fuente)) {
      return NextResponse.json(
        { error: "La fuente de tipo de cambio no está disponible para tu país y moneda." },
        { status: 400 }
      )
    }

    let tipoCambioManual: number | null = null
    if ((input.habilitada && input.fuente === "MANUAL") || (input.tipoCambioManual !== undefined && input.tipoCambioManual !== null)) {
      const tc = validarTipoCambio(input.tipoCambioManual)
      if (!tc.ok) return NextResponse.json({ error: tc.error }, { status: 400 })
      tipoCambioManual = tc.valor
    }

    const payload: Record<string, unknown> = {
      organization_id: organizationId,
      multimoneda_habilitada: input.habilitada,
      moneda_extranjera: input.monedaExtranjera,
      tipo_cambio_fuente: input.fuente,
      tipo_cambio_manual: tipoCambioManual,
      redondeo_conversion: input.redondeoConversion,
    }
    // The stored reference belongs to the previous currency/source: drop it when either changes.
    if (fila && (fila.moneda_extranjera !== input.monedaExtranjera || fila.tipo_cambio_fuente !== input.fuente)) {
      payload.tipo_cambio_referencia = null
      payload.referencia_en = null
    }

    const { error: upsertError } = await supabaseAdmin
      .from("organizacion_moneda")
      .upsert(payload, { onConflict: "organization_id" })
    if (upsertError) {
      if (upsertError.code && MIGRACION_PENDIENTE.has(upsertError.code)) {
        return NextResponse.json({ error: "Falta aplicar la migración de multimoneda" }, { status: 503 })
      }
      throw new Error(`organizacion_moneda: ${upsertError.message}`)
    }

    return await respuesta(organizationId!, role)
  } catch (e) {
    console.error("[configuracion/moneda] PUT:", e)
    return NextResponse.json({ error: "Error al guardar la configuración de moneda" }, { status: 500 })
  }
}
