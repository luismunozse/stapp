import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { z } from "zod"
import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { hasPlanFeature } from "@/lib/subscriptions"
import { enforcePlanLimit, isPlanLimitError, planLimitErrorResponse } from "@/lib/plan-limits"
import { createAuditLogger } from "@/lib/audit"
import { sucursalParaEscritura } from "@/lib/sucursal"
import { resolveOperador } from "@/lib/operadores"
import { tipoValidaImei } from "@/lib/tipos-dispositivo-config"
import { isValidImei } from "@/lib/imei"
import { addDaysInTimeZone, DEFAULT_TIMEZONE } from "@/lib/timezone"

const FEATURE_KEY = "reparaciones_express"

const reparacionSchema = z.object({
  dispositivo: z.string().min(1, "El dispositivo es requerido"),
  tipoDispositivo: z.string().min(1, "El tipo de dispositivo es requerido"),
  marca: z.string().optional(),
  imei: z.string().optional(),
  trabajoRealizado: z.string().min(1, "El trabajo realizado es requerido"),
  precio: z.number().positive("El precio debe ser mayor a 0"),
  diasGarantia: z.number().int().min(0).default(0),
})

const loteSchema = z.object({
  clienteId: z.string().min(1, "El cliente es requerido"),
  reparaciones: z.array(reparacionSchema).min(1, "Debe cargar al menos una reparación"),
  operadorId: z.string().nullable().optional(),
  idempotencyKey: z.string().max(100).nullable().optional(),
})

function generatePublicToken(): string {
  return randomBytes(16).toString("hex")
}

export async function POST(request: Request) {
  try {
    const { error, session, organizationId, userId, role } = await requireAdminOrVendedor()
    if (error) return error

    const hasFeature = await hasPlanFeature(organizationId!, FEATURE_KEY)
    if (!hasFeature) {
      return NextResponse.json(
        {
          error: "Las reparaciones express están disponibles en el plan Profesional",
          code: "FEATURE_REQUIRED",
          feature: FEATURE_KEY,
        },
        { status: 403 },
      )
    }

    const body = await request.json()
    const data = loteSchema.parse(body)

    // Pre-check for the whole batch. The update_ordenes_count trigger validates
    // it again inside the transaction.
    const limitError = await enforcePlanLimit(organizationId!, "ordenes")
    if (limitError) return limitError

    for (const rep of data.reparaciones) {
      if (rep.imei && rep.imei.trim()) {
        const validaImei = await tipoValidaImei(organizationId!, rep.tipoDispositivo)
        if (validaImei && !isValidImei(rep.imei)) {
          return NextResponse.json(
            { error: `El IMEI de ${rep.dispositivo} debe tener exactamente 15 dígitos` },
            { status: 400 },
          )
        }
      }
    }

    const sucursalId = await sucursalParaEscritura({
      role,
      organizationId: organizationId!,
      userSucursalId: session!.user.sucursalId ?? null,
    })
    const operador = await resolveOperador(organizationId!, data.operadorId, userId!)

    // The warranty expiry is a CALENDAR day in the workshop timezone, so it is
    // computed here and not with NOW() + interval inside the RPC.
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("zona_horaria")
      .eq("id", organizationId!)
      .single()
    const zonaHoraria = org?.zona_horaria || DEFAULT_TIMEZONE

    const reparacionesRpc = data.reparaciones.map((rep) => ({
      dispositivo: rep.dispositivo,
      tipoDispositivo: rep.tipoDispositivo,
      marca: rep.marca ?? null,
      imei: rep.imei ?? null,
      trabajoRealizado: rep.trabajoRealizado,
      precio: rep.precio,
      diasGarantia: rep.diasGarantia,
      fechaVencimientoGarantia:
        rep.diasGarantia > 0 ? addDaysInTimeZone(rep.diasGarantia, zonaHoraria) : null,
      publicToken: generatePublicToken(),
    }))

    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
      "crear_reparaciones_express",
      {
        p_organization_id: organizationId!,
        p_sucursal_id: sucursalId,
        p_cliente_id: data.clienteId,
        p_reparaciones: reparacionesRpc,
        p_operador_id: operador,
        p_created_by: userId!,
        p_idempotency_key: data.idempotencyKey ?? null,
      },
    )

    if (rpcError) {
      if (isPlanLimitError(rpcError)) return planLimitErrorResponse(rpcError)
      console.error("Error en crear_reparaciones_express:", rpcError)
      return NextResponse.json({ error: "Error al cargar las reparaciones" }, { status: 500 })
    }

    // Replayed: the batch was already created (and audited) on the original
    // request. Return the stored response as-is and skip the side effects
    // below — same pattern as app/api/ordenes/[id]/cobros/route.ts and
    // app/api/pagos/route.ts for their own idempotent RPCs.
    if (rpcResult?.replayed) {
      return NextResponse.json(rpcResult.response, { status: 201 })
    }

    const result = rpcResult as {
      ordenes: Array<{ id: string; numeroOrden: number; codigoOrden: string; dispositivo: string; precio: number; publicToken: string; movimientoId: string }>
      totalCargado: number
      saldoNuevo: number
    }

    const audit = createAuditLogger(organizationId!, userId!, request)
    for (const orden of result.ordenes || []) {
      await audit.create("ordenes_servicio", orden.id, {
        numero_orden: orden.numeroOrden,
        dispositivo: orden.dispositivo,
        cliente_id: data.clienteId,
        precio: orden.precio,
        origen: "reparacion_express",
      })
    }

    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error creating reparaciones express:", err)
    return NextResponse.json({ error: "Error al cargar las reparaciones" }, { status: 500 })
  }
}
