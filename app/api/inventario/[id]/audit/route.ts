import { NextResponse } from "next/server"
import { requireAuth, hasInventarioAccess, resolveVendedoresHabilitados } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { getEntityHistory } from "@/lib/audit"

// Campos de AUDITED_FIELDS (ver app/api/inventario/[id]/route.ts) que exponen
// costo de compra. El audit log guarda before/after crudos, así que el valor
// vigente sale del último UPDATE — el mismo número que /api/inventario/[id]
// ya le niega al rol.
const COST_FIELDS = ["precio_compra"]

type AuditChanges = { before?: Record<string, unknown>; after?: Record<string, unknown> }

// Saca los campos de costo de ambos lados del diff. CREATE trae solo `after`,
// DELETE solo `before`. Si el UPDATE tocó únicamente el costo, la entrada queda
// sin filas y la UI ya no la pinta (guard de fieldsChanged.length).
function stripCostFields(changes: AuditChanges | null): AuditChanges | null {
  if (!changes || typeof changes !== "object") return changes
  const out: AuditChanges = { ...changes }
  for (const side of ["before", "after"] as const) {
    const snapshot = out[side]
    if (!snapshot || typeof snapshot !== "object") continue
    const clone = { ...snapshot }
    for (const field of COST_FIELDS) delete clone[field]
    out[side] = clone
  }
  return out
}

// GET /api/inventario/[id]/audit
// Historial de cambios auditables (precio, categoría, proveedor, etc).
// No incluye cambios de stock — esos viven en movimientos_inventario.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, role } = await requireAuth()
    if (error) return error

    const vendedoresHabilitados = role === "VENDEDOR"
      ? await resolveVendedoresHabilitados(organizationId!)
      : false
    const canViewCost = hasInventarioAccess(role, vendedoresHabilitados)

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
        changes: canViewCost ? l.changes : stripCostFields(l.changes),
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
