import { NextResponse } from "next/server"
import { checkPlanLimit } from "@/lib/subscriptions"

export type LimitType = "ordenes" | "tecnicos" | "clientes" | "vendedores" | "storage"

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

// Mensajes de error para cada tipo de límite
export const LIMIT_MESSAGES = {
  ordenes: {
    title: "Límite de órdenes alcanzado",
    description: "Has alcanzado el límite mensual de órdenes de tu plan Free.",
    action: "Actualiza a Premium para crear órdenes ilimitadas.",
  },
  tecnicos: {
    title: "Límite de técnicos alcanzado",
    description: "Has alcanzado el límite de técnicos de tu plan Free.",
    action: "Actualiza a Premium para agregar técnicos ilimitados.",
  },
  clientes: {
    title: "Límite de clientes alcanzado",
    description: "Has alcanzado el límite de clientes de tu plan Free.",
    action: "Actualiza a Premium para agregar clientes ilimitados.",
  },
  vendedores: {
    title: "Límite de vendedores alcanzado",
    description: "Has alcanzado el límite de vendedores de tu plan Free.",
    action: "Actualiza a Premium para agregar vendedores ilimitados.",
  },
  storage: {
    title: "Límite de almacenamiento alcanzado",
    description: "Has alcanzado el límite de almacenamiento de tu plan.",
    action: "Actualiza a Premium para obtener más espacio de almacenamiento.",
  },
}
