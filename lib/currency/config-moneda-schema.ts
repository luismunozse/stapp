import { z } from "zod"

/**
 * Body of PUT /api/configuracion/moneda. Structural only: whether the source is offered for
 * the org's country and whether the rate is valid are checked in the route (they need the org
 * and `validarTipoCambio`).
 */
export const configMonedaSchema = z.object({
  habilitada: z.boolean(),
  monedaExtranjera: z.enum(["USD", "EUR"]),
  fuente: z.enum(["MANUAL", "OFICIAL", "BLUE", "MEP"]),
  tipoCambioManual: z.union([z.number(), z.string(), z.null()]).optional(),
  redondeoConversion: z.union([z.literal(0), z.literal(1), z.literal(10), z.literal(100)]),
})

export type ConfigMonedaInput = z.infer<typeof configMonedaSchema>
