import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { getAuditLogs } from "@/lib/audit"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params

    const logs = await getAuditLogs(organizationId!, {
      entity: "cotizaciones",
      entityId: id,
      limit: 50,
    })

    return NextResponse.json(logs || [])
  } catch (error) {
    console.error("Error fetching cotizacion history:", error)
    return NextResponse.json(
      { error: "Error al obtener historial" },
      { status: 500 }
    )
  }
}
