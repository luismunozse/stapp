import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import {
  annulBodySchema,
  annulCommissionPayout,
  payBodySchema,
  payCommissions,
} from "@/lib/commissions/payouts"

async function readJson(request: Request): Promise<unknown | undefined> {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}

const INVALID_JSON = () => NextResponse.json({ error: "El cuerpo del pedido no es válido" }, { status: 400 })

export async function POST(request: Request) {
  const { error, organizationId, userId } = await requireAdmin()
  if (error) return error

  const json = await readJson(request)
  if (json === undefined) return INVALID_JSON()
  const parsed = payBodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  return payCommissions({ organizationId: organizationId!, userId: userId!, ...parsed.data })
}

export async function DELETE(request: Request) {
  const { error, organizationId, userId } = await requireAdmin()
  if (error) return error

  const json = await readJson(request)
  if (json === undefined) return INVALID_JSON()
  const parsed = annulBodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  return annulCommissionPayout({ organizationId: organizationId!, userId: userId!, ...parsed.data })
}
