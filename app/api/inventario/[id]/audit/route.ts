import { NextResponse } from "next/server"
import { requireAuth, hasInventarioAccess, resolveVendedoresHabilitados } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { getEntityHistory, generateDescription } from "@/lib/audit"

// Campos de AUDITED_FIELDS (ver app/api/inventario/[id]/route.ts) que exponen
// costo de compra. El audit log guarda before/after crudos, así que el valor
// vigente sale del último UPDATE — el mismo número que /api/inventario/[id]
// ya le niega al rol.
const COST_FIELDS = ["precio_compra"]

type AuditChanges = { before?: Record<string, unknown>; after?: Record<string, unknown> }

// Saca los campos de costo de ambos lados del diff. CREATE trae solo `after`,
// DELETE solo `before`.
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

// Campos que siguen difiriendo DESPUÉS del filtro. Es la misma comparación que
// hace generateDescription, y decide si al UPDATE le queda algo que contar.
function changedFieldsAfterStrip(changes: AuditChanges | null): string[] {
  const before = changes?.before
  const after = changes?.after
  if (!before || !after) return []
  return Object.keys(after).filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])
  )
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

    const row = (l: any, description: string, changes: AuditChanges | null) => ({
      id: l.id,
      action: l.action,
      description,
      changes,
      user: l.users ? { id: l.users.id, nombre: l.users.nombre, email: l.users.email } : null,
      ipAddress: l.ip_address,
      createdAt: l.created_at,
    })

    // Filtrar `changes` no alcanzaba: `description` se generó con el diff
    // COMPLETO y generateDescription empuja el label del campo para los
    // numéricos, así que un UPDATE que tocó solo el costo quedó guardado como
    // "Cambió precio_compra en producto #ab12cd". audit-historial.tsx pinta
    // log.description sin condición — el guard de fieldsChanged.length esconde
    // las filas del diff, no la entrada — y el rol sin acceso leía un renglón
    // anunciando que el precio de compra cambió, con el diff vacío abajo. No
    // se filtraba el valor, pero sí la edición.
    //
    // Dos reglas, para los dos casos:
    //
    // - UPDATE que después del filtro no cambió NADA: era un cambio de costo y
    //   nada más. Se saca la entrada entera. Es lo que el comentario viejo
    //   afirmaba que ya pasaba, y no pasaba.
    // - UPDATE mixto: la descripción se RE-genera sobre el diff ya filtrado,
    //   así nombra los campos que el rol sí puede ver y ninguno de los que se
    //   sacaron.
    //
    // CREATE y DELETE conservan su descripción: nombran el item, no los campos
    // (ver generateDescription), así que no delatan nada.
    const data = (logs || []).flatMap((l: any) => {
      if (canViewCost) return [row(l, l.description, l.changes)]

      const changes = stripCostFields(l.changes)
      const esUpdateConDiff = l.action === "UPDATE" && l.changes?.before && l.changes?.after
      if (!esUpdateConDiff) return [row(l, l.description, changes)]

      if (changedFieldsAfterStrip(changes).length === 0) return []
      return [row(l, generateDescription("UPDATE", "inventario", id, changes ?? undefined), changes)]
    })

    return NextResponse.json({ data })
  } catch (err) {
    console.error("Error fetching audit history:", err)
    return NextResponse.json({ error: "Error al obtener historial" }, { status: 500 })
  }
}
