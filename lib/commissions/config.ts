// Client-safe: no server imports. The shop's repair-commission rules (table comisiones_config
// plus the organizations flag 257) as the settings screen and the config route share them.
import { z } from "zod"
import { round2 } from "@/lib/precios"
import type { CommissionBaseKind } from "./types"

export type OrderAccrualRule = "ENTREGA_Y_COBRO" | "ENTREGA" | "COBRO"

export interface CommissionConfig {
  ordenDevengo: OrderAccrualRule
  tecnicoBase: CommissionBaseKind
  recepcionBase: CommissionBaseKind
  recepcionPorcentajeDefault: number
  reingresoComisiona: boolean
  sinReparacionComisiona: boolean
}

// Must equal the column defaults of comisiones_config (380) and the COALESCE fallbacks of 381.
export const COMMISSION_CONFIG_DEFAULTS: Omit<CommissionConfig, "sinReparacionComisiona"> = {
  ordenDevengo: "ENTREGA_Y_COBRO",
  tecnicoBase: "MANO_DE_OBRA",
  recepcionBase: "MONTO_ORDEN",
  recepcionPorcentajeDefault: 0,
  reingresoComisiona: false,
}

const RATE_MESSAGE = "El porcentaje de recepción debe estar entre 0 y 100"

export const commissionConfigSchema: z.ZodType<CommissionConfig> = z.object({
  ordenDevengo: z.enum(["ENTREGA_Y_COBRO", "ENTREGA", "COBRO"]),
  tecnicoBase: z.enum(["MANO_DE_OBRA", "MONTO_ORDEN"]),
  recepcionBase: z.enum(["MANO_DE_OBRA", "MONTO_ORDEN"]),
  recepcionPorcentajeDefault: z.number().min(0, RATE_MESSAGE).max(100, RATE_MESSAGE).transform(round2),
  reingresoComisiona: z.boolean(),
  sinReparacionComisiona: z.boolean(),
}) as unknown as z.ZodType<CommissionConfig>

export const ORDER_ACCRUAL_OPTIONS: ReadonlyArray<{ value: OrderAccrualRule; label: string; implica: string }> = [
  {
    value: "ENTREGA_Y_COBRO",
    label: "Al entregar la orden y tenerla cobrada por completo",
    implica: "Una orden entregada con saldo pendiente no genera comisión hasta que se cobra todo.",
  },
  {
    value: "ENTREGA",
    label: "Al entregar la orden",
    implica: "Se genera al entregar, aunque quede saldo por cobrar.",
  },
  {
    value: "COBRO",
    label: "Al tener la orden cobrada por completo",
    implica: "Se genera al cobrar todo, aunque el equipo siga en el taller.",
  },
]

export const BASE_OPTIONS: ReadonlyArray<{ value: CommissionBaseKind; label: string; implica: string }> = [
  {
    value: "MANO_DE_OBRA",
    label: "Mano de obra",
    implica: "Monto de la orden menos el costo de los repuestos.",
  },
  {
    value: "MONTO_ORDEN",
    label: "Monto de la orden",
    implica: "Todo lo que se cobra por la orden, repuestos incluidos.",
  },
]
