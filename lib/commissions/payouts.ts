import { NextResponse } from "next/server"
import { z } from "zod"
import { supabaseAdmin } from "@/lib/supabase"
import type { PayRowInput } from "./types"

const filaSchema = z.object({
  clave: z.string().min(1),
  monto: z.number().finite(),
})

const notasSchema = z.string().trim().max(500).optional()

export const payBodySchema = z.object({
  beneficiarioId: z.string().min(1),
  filas: z.array(filaSchema).min(1).max(500, "Elegí hasta 500 comisiones por pago."),
  notas: notasSchema,
})

export const liquidarBodySchema = payBodySchema.omit({ beneficiarioId: true })

export const annulBodySchema = z.object({
  pagoId: z.string().min(1),
  motivo: z
    .string()
    .trim()
    .min(1, "Indicá el motivo de la anulación.")
    .max(500),
})

const CHANGED =
  "Las comisiones cambiaron desde que abriste la pantalla. Actualizá y revisá los montos antes de pagar."

const CODE_MAP: Record<string, { status: number; error: string }> = {
  NO_AUTORIZADO: { status: 403, error: "Solo un administrador puede pagar o anular comisiones." },
  BENEFICIARIO_NO_ENCONTRADO: { status: 404, error: "La persona no existe en este taller." },
  PAGO_NO_ENCONTRADO: { status: 404, error: "Pago no encontrado." },
  SIN_FILAS: { status: 400, error: "Elegí al menos una comisión." },
  FILA_DUPLICADA: { status: 400, error: "Hay comisiones repetidas en el pedido." },
  MOTIVO_REQUERIDO: { status: 400, error: "Indicá el motivo de la anulación." },
  FILA_NO_DISPONIBLE: { status: 409, error: CHANGED },
  FILA_YA_PAGADA: { status: 409, error: CHANGED },
  OTRO_BENEFICIARIO: { status: 409, error: CHANGED },
  MONTO_DISTINTO: { status: 409, error: CHANGED },
  PAGO_YA_ANULADO: { status: 409, error: "Ese pago ya estaba anulado." },
  AJUSTES_PAGADOS: {
    status: 409,
    error:
      "Un pago posterior ya liquidó ajustes de estas comisiones (devoluciones o anulaciones). Anulá ese pago primero.",
  },
}

const MARKER = "COMISION_ERROR:"

export function commissionRpcError(
  error: { code?: string; message?: string } | null,
): { status: number; error: string } | null {
  if (!error) return null
  // A concurrent duplicate hits the partial unique index.
  if (error.code === "23505") return { status: 409, error: CHANGED }
  const message = error.message ?? ""
  const at = message.indexOf(MARKER)
  if (at === -1) return null
  const rest = message.slice(at + MARKER.length)
  const end = rest.indexOf(":")
  const code = end === -1 ? rest : rest.slice(0, end)
  return CODE_MAP[code.trim()] ?? null
}

export async function payCommissions(a: {
  organizationId: string
  userId: string
  beneficiarioId: string
  filas: PayRowInput[]
  notas?: string
}): Promise<NextResponse> {
  const notas = a.notas?.trim()
  const { data, error } = await supabaseAdmin.rpc("pagar_comisiones", {
    p_organization_id: a.organizationId,
    p_usuario_id: a.userId,
    p_beneficiario_id: a.beneficiarioId,
    p_filas: a.filas,
    p_notas: notas ? notas : null,
  })
  if (error) {
    const mapped = commissionRpcError(error)
    if (mapped) return NextResponse.json({ error: mapped.error }, { status: mapped.status })
    console.error("[comisiones] pagar_comisiones failed", {
      organizationId: a.organizationId,
      beneficiarioId: a.beneficiarioId,
      code: error.code,
      message: error.message,
    })
    return NextResponse.json({ error: "Error al pagar comisiones" }, { status: 500 })
  }
  return NextResponse.json(data)
}

export async function annulCommissionPayout(a: {
  organizationId: string
  userId: string
  pagoId: string
  motivo: string
}): Promise<NextResponse> {
  const { data, error } = await supabaseAdmin.rpc("anular_pago_comisiones", {
    p_organization_id: a.organizationId,
    p_usuario_id: a.userId,
    p_pago_id: a.pagoId,
    p_motivo: a.motivo,
  })
  if (error) {
    const mapped = commissionRpcError(error)
    if (mapped) return NextResponse.json({ error: mapped.error }, { status: mapped.status })
    console.error("[comisiones] anular_pago_comisiones failed", {
      organizationId: a.organizationId,
      pagoId: a.pagoId,
      code: error.code,
      message: error.message,
    })
    return NextResponse.json({ error: "Error al anular el pago" }, { status: 500 })
  }
  return NextResponse.json(data)
}
