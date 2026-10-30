import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { traerTodas } from "@/lib/supabase-paginar"
import { round2 } from "@/lib/precios"
import type { CommissionDocType, CommissionRole, CommissionRow } from "./types"

export interface CommissionSummary {
  beneficiarioId: string
  originales: number
  base: number
  documentoTotal: number
  monto: number
  pendiente: number
}

export interface CommissionRowsQuery {
  organizationId: string
  roles: CommissionRole[]
  beneficiarioId?: string | null
  desde?: string | null
  hasta?: string | null
  estado?: "pendiente" | "pagada" | "all"
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

export function toCommissionRow(raw: Record<string, any>): CommissionRow {
  return {
    clave: raw.clave,
    sucursalId: raw.sucursal_id ?? null,
    documentoTipo: raw.documento_tipo ?? null,
    documentoId: raw.documento_id ?? null,
    beneficiarioId: raw.beneficiario_id,
    rol: raw.rol,
    tipo: raw.tipo,
    ajusteRef: raw.ajuste_ref ?? null,
    base: num(raw.base),
    porcentaje: num(raw.porcentaje),
    monto: Number(raw.monto),
    fechaDevengo: raw.fecha_devengo ?? null,
    devengada: Boolean(raw.devengada),
    pagoId: raw.pago_id ?? null,
    fechaPago: raw.fecha_pago ?? null,
    pagado: Boolean(raw.pagado),
    pendiente: Number(raw.pendiente),
    documentoCodigo: raw.documento_codigo ?? null,
    documentoNumero: num(raw.documento_numero),
    documentoDetalle: raw.documento_detalle ?? null,
    documentoEstado: raw.documento_estado ?? null,
    documentoTotal: num(raw.documento_total),
    documentoCostoRepuestos: num(raw.documento_costo_repuestos),
  }
}

export async function readCommissionRows(q: CommissionRowsQuery): Promise<CommissionRow[]> {
  const { data, error } = await traerTodas<Record<string, any>>(() => {
    let query = supabaseAdmin
      .from("v_comisiones_devengadas")
      .select("*")
      .eq("organization_id", q.organizationId)
      .in("rol", q.roles)
      .or("monto.neq.0,pagado.eq.true")
    if (q.beneficiarioId) query = query.eq("beneficiario_id", q.beneficiarioId)
    if (q.desde) query = query.gte("fecha_devengo", q.desde)
    if (q.hasta) query = query.lte("fecha_devengo", q.hasta)
    if (q.estado === "pendiente") query = query.eq("pagado", false)
    if (q.estado === "pagada") query = query.eq("pagado", true)
    return query
      .order("fecha_devengo", { ascending: false, nullsFirst: false })
      .order("clave", { ascending: true })
  })
  if (error) throw new Error(`readCommissionRows failed: ${(error as { message?: string }).message ?? "unknown error"}`)
  return data.map(toCommissionRow)
}

export async function readDocumentCommissionRows(
  organizationId: string,
  documentoTipo: CommissionDocType,
  documentoId: string,
): Promise<CommissionRow[]> {
  const { data, error } = await traerTodas<Record<string, any>>(() =>
    supabaseAdmin
      .from("v_comisiones_filas")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("documento_tipo", documentoTipo)
      .eq("documento_id", documentoId)
      .order("clave", { ascending: true }),
  )
  if (error) throw new Error(`readDocumentCommissionRows failed: ${(error as { message?: string }).message ?? "unknown error"}`)
  return data.map(toCommissionRow)
}

export function summarizeByBeneficiary(rows: CommissionRow[]): CommissionSummary[] {
  const acc = new Map<string, CommissionSummary>()
  for (const r of rows) {
    const s = acc.get(r.beneficiarioId) ?? { beneficiarioId: r.beneficiarioId, originales: 0, base: 0, documentoTotal: 0, monto: 0, pendiente: 0 }
    if (r.tipo === "ORIGINAL") {
      s.originales += 1
      s.base += r.base ?? 0
      s.documentoTotal += r.documentoTotal ?? 0
    }
    s.monto += r.monto
    s.pendiente += r.pendiente
    acc.set(r.beneficiarioId, s)
  }
  return [...acc.values()].map((s) => ({ ...s, base: round2(s.base), documentoTotal: round2(s.documentoTotal), monto: round2(s.monto), pendiente: round2(s.pendiente) }))
}
