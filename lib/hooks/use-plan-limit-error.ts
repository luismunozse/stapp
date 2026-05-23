"use client"

/**
 * use-plan-limit-error
 *
 * Hook + utilities para detectar errores de límite de plan (HTTP 403 con
 * code=PLAN_LIMIT_EXCEEDED y upgradeAction estructurado) y disparar el flow
 * de upgrade contextual.
 *
 * Pattern de uso (cliente):
 *
 *   const planLimit = usePlanLimitError()
 *   const res = await fetch(...)
 *   if (!res.ok) {
 *     const handled = await planLimit.handle(res)
 *     if (handled.shouldUpgrade) {
 *       setUpgradeModalOpen(true)
 *       return
 *     }
 *     alert(handled.message)
 *   }
 *
 * Compatible con cualquier error shape que incluya:
 *   { code: "PLAN_LIMIT_EXCEEDED", upgradeAction, error?, message?, limitType?, current?, limit? }
 */

import { useCallback, useState } from "react"

export type UpgradeActionHint =
  | "upgrade_free_to_profesional"
  | "activate_trial"
  | null

export interface PlanLimitErrorPayload {
  code?: string
  error?: string
  message?: string
  limitType?: string
  current?: number | null
  limit?: number | null
  upgradeAction?: UpgradeActionHint
}

export interface HandledPlanLimitError {
  /** true si el error es PLAN_LIMIT_EXCEEDED y el frontend debería abrir el modal de upgrade */
  shouldUpgrade: boolean
  /** Mensaje listo para mostrar al usuario (del backend o un fallback) */
  message: string
  /** Hint estructurada del backend; útil para decidir CTA exacto */
  upgradeAction: UpgradeActionHint
  /** Payload crudo por si el caller quiere usar limitType/current/limit */
  payload: PlanLimitErrorPayload | null
}

/**
 * Intenta parsear el body de una Response / error como PLAN_LIMIT_EXCEEDED.
 * Devuelve `null` si no aplica (no es plan-limit).
 */
export async function parsePlanLimitError(
  input: Response | { status?: number; body?: unknown } | unknown
): Promise<PlanLimitErrorPayload | null> {
  let status: number | undefined
  let body: PlanLimitErrorPayload | null = null

  if (input instanceof Response) {
    status = input.status
    try {
      body = (await input.clone().json()) as PlanLimitErrorPayload
    } catch {
      body = null
    }
  } else if (input && typeof input === "object") {
    const obj = input as { status?: number; body?: PlanLimitErrorPayload }
    status = obj.status
    body = obj.body ?? (input as PlanLimitErrorPayload)
  }

  if (!body) return null
  if (status !== undefined && status !== 403) return null
  if (body.code !== "PLAN_LIMIT_EXCEEDED") return null

  return body
}

const DEFAULT_MSG =
  "Llegaste al límite de tu plan. Actualizá a Profesional para continuar."

export function usePlanLimitError() {
  const [lastError, setLastError] = useState<HandledPlanLimitError | null>(null)

  const handle = useCallback(
    async (input: Response | unknown): Promise<HandledPlanLimitError> => {
      const payload = await parsePlanLimitError(input)

      if (!payload) {
        // No es plan-limit — caller maneja como error normal
        const fallback: HandledPlanLimitError = {
          shouldUpgrade: false,
          message: "",
          upgradeAction: null,
          payload: null,
        }
        setLastError(fallback)
        return fallback
      }

      const result: HandledPlanLimitError = {
        shouldUpgrade: true,
        message: payload.error || payload.message || DEFAULT_MSG,
        upgradeAction: payload.upgradeAction ?? "upgrade_free_to_profesional",
        payload,
      }
      setLastError(result)
      return result
    },
    []
  )

  const reset = useCallback(() => setLastError(null), [])

  return { handle, lastError, reset }
}
