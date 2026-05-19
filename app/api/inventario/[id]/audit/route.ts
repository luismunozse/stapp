import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { getEntityHistory } from "@/lib/audit"

// GET /api/inventario/[id]/audit
// Historial de cambios auditables (precio, categoría, proveedor, etc).
// No incluye cambios de stock — esos viven en movimientos_inventario.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id } = await params

    // Verificar pertenencia (incluye archivados — el historial debe sobrevivir)
    const { data: item } = await supabaseAdmin
      .from("inventario")
      .select("id")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .maybeSingle()

    if (!item) {
      return NextResponse.json({ error: "Item no encontrado" }, { status: 404 })
    }

    const logs = await getEntityHistory(organizationId!, "inventario", id)

    return NextResponse.json({
      data: (logs || []).map((l: any) => ({
        id: l.id,
        action: l.action,
        description: l.description,
        changes: l.changes,
        user: l.users ? { id: l.users.id, nombre: l.users.nombre, email: l.users.email } : null,
        ipAddress: l.ip_address,
        createdAt: l.created_at,
      })),
    })
  } catch (err) {
    console.error("Error fetching audit history:", err)
    return NextResponse.json({ error: "Error al obtener historial" }, { status: 500 })
  }
}
