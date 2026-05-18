import { NextResponse } from "next/server"
import { checkPlanLimit } from "@/lib/subscriptions"

export type LimitType = "ordenes" | "tecnicos" | "clientes" | "vendedores" | "storage"

// Forma del error que raisean los triggers / RPC cuando se excede el limite
// del plan. Mensaje: "PLAN_LIMIT_EXCEEDED:<tipo>:<current>:<limit>"
const PLAN_LIMIT_ERROR_RE = /PLAN_LIMIT_EXCEEDED:([a-z]+):(\d+):(\d+)/

interface SupabaseLikeError {
  message?: string
  code?: string
  details?: string | null
  hint?: string | null
}

// Detecta si un error de supabase / postgres viene de un trigger nuestro de
// enforce de limite. Cubre tanto error.message (formato literal) como el
// caso en que el driver lo envuelve en details/hint.
export function isPlanLimitError(error: SupabaseLikeError | null | undefined): boolean {
  if (!error) return false
  const haystack = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`
  return PLAN_LIMIT_ERROR_RE.test(haystack)
}

// Construye la respuesta 403 standard a partir del error del trigger.
// Parsea limitType / current / limit del mensaje. Si falla el parseo, retorna
// un 403 generico igualmente para no exponer un 500.
export function planLimitErrorResponse(error: SupabaseLikeError): NextResponse {
  const haystack = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`
  const match = haystack.match(PLAN_LIMIT_ERROR_RE)

  const limitType = match?.[1] ?? "recursos"
  const current = match?.[2] ? Number(match[2]) : null
  const limit = match?.[3] ? Number(match[3]) : null

  return NextResponse.json(
    {
      error: limit
        ? `Has alcanzado el límite de ${limit} ${limitType} de tu plan. Actualizá a Profesional para continuar.`
        : "Has alcanzado el límite de tu plan.",
      code: "PLAN_LIMIT_EXCEEDED",
      limitType,
      current,
      limit,
    },
    { status: 403 }
  )
}

// Middleware para verificar límites del plan antes de crear recursos
export async function enforcePlanLimit(
  organizationId: string,
  limitType: LimitType
): Promise<NextResponse | null> {
  const result = await checkPlanLimit(organizationId, limitType)

  if (!result.allowed) {
    return NextResponse.json(
      {
        error: result.message || "Has alcanzado el límite de tu plan",
        code: "PLAN_LIMIT_EXCEEDED",
        limitType,
        current: result.current,
        limit: result.limit,
      },
      { status: 403 }
    )
  }

  return null // Permitir la operación
}

// Mensajes de error genéricos por tipo de límite.
// Se mantienen genéricos ("tu plan") porque ahora hay varios planes.
// El mensaje dinámico con nombre del plan destino se construye en checkPlanLimit.
export const LIMIT_MESSAGES = {
  ordenes: {
    title: "Límite de órdenes alcanzado",
    description: "Has alcanzado el límite mensual de órdenes de tu plan.",
    action: "Actualizá tu plan para crear órdenes ilimitadas.",
  },
  tecnicos: {
    title: "Límite de técnicos alcanzado",
    description: "Has alcanzado el límite de técnicos de tu plan.",
    action: "Actualizá tu plan para agregar técnicos ilimitados.",
  },
  clientes: {
    title: "Límite de clientes alcanzado",
    description: "Has alcanzado el límite de clientes de tu plan.",
    action: "Actualizá tu plan para agregar clientes ilimitados.",
  },
  vendedores: {
    title: "Límite de vendedores alcanzado",
    description: "Has alcanzado el límite de vendedores de tu plan.",
    action: "Actualizá tu plan para agregar vendedores ilimitados.",
  },
  storage: {
    title: "Límite de almacenamiento alcanzado",
    description: "Has alcanzado el límite de almacenamiento de tu plan.",
    action: "Actualizá tu plan para obtener más espacio de almacenamiento.",
  },
}
