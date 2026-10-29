import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { getAuditLogs } from "@/lib/audit"
import { cotizacionEnAlcance, resolverAlcanceOrdenesPorId } from "@/lib/ordenes/alcance-lectura"

// The typed client infers an embedded to-one relation as an array; the row carries one order.
type ConAlcance = Parameters<typeof cotizacionEnAlcance>[1]

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role, session } = await requireAuth()
    if (error) return error

    const { id } = await params

    // The history follows the quote's branch scope. Deleted quotes keep their
    // history readable, so there is no `deleted_at` filter here.
    const { data: cotizacion, error: fetchError } = await supabaseAdmin
      .from("cotizaciones")
      .select("id, orden_id, ordenes_servicio!cotizaciones_orden_id_fkey (id, sucursal_id, tecnico_id)")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    const alcance = await resolverAlcanceOrdenesPorId({
      role,
      userId,
      userSucursalId: session!.user.sucursalId ?? null,
    })

    if (fetchError || !cotizacion || !cotizacionEnAlcance(alcance, cotizacion as ConAlcance)) {
      return NextResponse.json(
        { error: "Cotización no encontrada" },
        { status: 404 }
      )
    }

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
