import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { createAuditLogger } from "@/lib/audit"
import {
  COMMISSION_CONFIG_DEFAULTS,
  commissionConfigSchema,
  type CommissionConfig,
} from "@/lib/commissions/config"

const NO_STORE = { "Cache-Control": "no-store" }

const SAVE_FAILED = () =>
  NextResponse.json({ error: "No se pudieron guardar las reglas de comisiones" }, { status: 500 })

type ConfigRow = {
  orden_devengo: CommissionConfig["ordenDevengo"]
  tecnico_base: CommissionConfig["tecnicoBase"]
  recepcion_base: CommissionConfig["recepcionBase"]
  recepcion_porcentaje_default: number | string
  reingreso_comisiona: boolean
}

function fromRows(row: ConfigRow | null, sinReparacionComisiona: boolean): CommissionConfig {
  if (!row) return { ...COMMISSION_CONFIG_DEFAULTS, sinReparacionComisiona }
  return {
    ordenDevengo: row.orden_devengo,
    tecnicoBase: row.tecnico_base,
    recepcionBase: row.recepcion_base,
    recepcionPorcentajeDefault: Number(row.recepcion_porcentaje_default),
    reingresoComisiona: row.reingreso_comisiona,
    sinReparacionComisiona,
  }
}

async function readConfig(organizationId: string) {
  const [cfg, org] = await Promise.all([
    supabaseAdmin
      .from("comisiones_config")
      .select("orden_devengo, tecnico_base, recepcion_base, recepcion_porcentaje_default, reingreso_comisiona")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    supabaseAdmin
      .from("organizations")
      .select("comision_aplica_sin_reparacion")
      .eq("id", organizationId)
      .maybeSingle(),
  ])
  if (cfg.error || org.error) return null
  return fromRows(
    (cfg.data as ConfigRow | null) ?? null,
    Boolean((org.data as { comision_aplica_sin_reparacion?: boolean } | null)?.comision_aplica_sin_reparacion),
  )
}

export async function GET() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const config = await readConfig(organizationId!)
    if (!config) {
      return NextResponse.json({ error: "No se pudieron cargar las reglas de comisiones" }, { status: 500 })
    }
    return NextResponse.json(config, { headers: NO_STORE })
  } catch (err) {
    console.error("[comisiones] config GET failed", err)
    return NextResponse.json({ error: "No se pudieron cargar las reglas de comisiones" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    let json: unknown
    try {
      json = await request.json()
    } catch {
      return NextResponse.json({ error: "El cuerpo del pedido no es válido" }, { status: 400 })
    }
    const parsed = commissionConfigSchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }
    const next = parsed.data

    const before = await readConfig(organizationId!)
    if (!before) return SAVE_FAILED()

    const { error: upsertError } = await supabaseAdmin.from("comisiones_config").upsert(
      {
        organization_id: organizationId!,
        orden_devengo: next.ordenDevengo,
        tecnico_base: next.tecnicoBase,
        recepcion_base: next.recepcionBase,
        recepcion_porcentaje_default: next.recepcionPorcentajeDefault,
        reingreso_comisiona: next.reingresoComisiona,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id" },
    )
    if (upsertError) {
      console.error("[comisiones] config upsert failed", upsertError)
      return SAVE_FAILED()
    }

    if (next.sinReparacionComisiona !== before.sinReparacionComisiona) {
      const { error: flagError } = await supabaseAdmin
        .from("organizations")
        .update({ comision_aplica_sin_reparacion: next.sinReparacionComisiona })
        .eq("id", organizationId!)
      if (flagError) {
        console.error("[comisiones] config flag update failed", flagError)
        return SAVE_FAILED()
      }
    }

    if (JSON.stringify(before) !== JSON.stringify(next)) {
      await createAuditLogger(organizationId!, userId!, request).update(
        "comisiones_config",
        organizationId!,
        { ...before },
        { ...next },
      )
    }

    return NextResponse.json(next, { headers: NO_STORE })
  } catch (err) {
    console.error("[comisiones] config PUT failed", err)
    return SAVE_FAILED()
  }
}
